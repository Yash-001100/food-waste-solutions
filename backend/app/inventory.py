"""
Real events that change a store-item's stock without ever rewriting
risk_scores.parquet directly - the same non-destructive philosophy as
applied_actions, just for stock itself instead of an action log. Two
sources feed this, both append-only ledgers (database.py):

  stock_receipts  - a supplier shipment an associate logs by uploading a
                    CSV (routers/inventory.py), always a straight addition.
  stock_transfers - a store-to-store move of a real, already-recommended
                    transfer_allocations candidate (routers/transfers.py),
                    executed in two steps: it leaves the origin the moment
                    it's shipped (a real subtraction there, immediately),
                    but only counts as arrived at the destination once
                    that store confirms it (a real addition there, but not
                    before) - mirroring the real gap between an ASN and a
                    dock scan, not an instant teleport of stock.

Everywhere this app reports a store-item's current_stock, it is really
"the pipeline's baseline stock (risk_scores.current_stock) + the net of
every receipt/shipped-out/confirmed-in event since." Because that genuinely
changes how much stock has to sell through before it expires,
risk_score/action/do_nothing_sellthrough_pct/reachable_target/discount
recommendations all get recomputed for that item too, live, using the
exact same optimizer this whole app already uses elsewhere
(recommend_discount + score_row/action_for) - not a second, parallel
methodology. In practice a receipt or an inbound transfer often makes an
item's risk go UP, not down: ordering or receiving more of something
already slow-moving is exactly the situation this project exists to catch.

Deliberately out of scope: transfer_allocations itself (the nationwide
same-state matching in scripts/07) does NOT re-run live against these
events - that matching is a batch/pipeline concept, and re-solving it per
request across all 10 stores is a different-sized problem than reflecting
one store's own updated stock. A freshly-Critical item shows up correctly
on the risk board and store summary right away; it only gets a real new
transfer candidate on the next pipeline run. This boundary is disclosed on
the Receive Stock page.
"""
from typing import Optional

from optimizer import recommend_discount, score_row, action_for


def get_receipts_by_item(con, store: str) -> dict[str, float]:
    """Total quantity received via supplier CSV per item_id at this store, across all time."""
    rows = con.execute(
        "SELECT item_id, sum(qty_received) FROM stock_receipts WHERE store = ? GROUP BY item_id",
        [store],
    ).fetchall()
    return {item_id: qty for item_id, qty in rows}


def get_stock_adjustments_by_item(con, store: str) -> dict[str, float]:
    """
    Net real stock change per item_id at this store since the pipeline's
    baseline, combining all three real events that can move it:
      + supplier receipts (stock_receipts)
      - stock shipped OUT of this store in a transfer (leaves immediately,
        any non-cancelled status - see routers/transfers.py's ship_transfer)
      + stock confirmed received INTO this store via a transfer (only once
        status = 'received' - an in_transit inbound transfer does not
        count yet, same as a real ASN isn't inventory until it's scanned in).
        Credits the store-reported qty_confirmed, not the shipped qty, so a
        shortfall the destination flagged at confirm time (damage/loss in
        transit) is real shrinkage rather than silently landing anyway.
    Zero-net items are dropped so callers can cheaply skip everything else.
    """
    adjustments: dict[str, float] = {}
    for item_id, qty in get_receipts_by_item(con, store).items():
        adjustments[item_id] = adjustments.get(item_id, 0.0) + qty
    for item_id, qty in con.execute("""
        SELECT item_id, sum(qty) FROM stock_transfers
        WHERE origin_store = ? AND status != 'cancelled' GROUP BY item_id
    """, [store]).fetchall():
        adjustments[item_id] = adjustments.get(item_id, 0.0) - qty
    for item_id, qty in con.execute("""
        SELECT item_id, sum(coalesce(qty_confirmed, qty)) FROM stock_transfers
        WHERE destination_store = ? AND status = 'received' GROUP BY item_id
    """, [store]).fetchall():
        adjustments[item_id] = adjustments.get(item_id, 0.0) + qty
    return {item_id: qty for item_id, qty in adjustments.items() if qty != 0}


def recompute_for_stock_change(current_stock: float, full_price: float, shelf_life_days: int,
                                baseline_daily_demand: float, elasticity_used: float,
                                net_adjustment: float) -> dict:
    """
    Given a store-item's real base numbers plus its net stock change since
    baseline (positive: received more; negative: shipped some out), returns
    the full set of recomputed stock-dependent fields at the new stock
    level - current_stock, do_nothing_sellthrough_pct, reachable_target,
    waste_min_discount_pct, revenue_max_discount_pct, risk_score, action.
    recommend_discount already clamps a negative stock to 0, so a store
    that (in a demo edge case) shows more shipped out than it had on hand
    never produces a nonsensical negative stock here.
    """
    new_stock = current_stock + net_adjustment
    result = recommend_discount(baseline_daily_demand, elasticity_used, shelf_life_days,
                                 new_stock, full_price)
    risk = score_row(result.do_nothing_sellthrough_pct, result.reachable_target)
    return {
        "current_stock": round(max(new_stock, 0.0), 2),
        "do_nothing_sellthrough_pct": result.do_nothing_sellthrough_pct,
        "reachable_target": result.reachable_target,
        "waste_min_discount_pct": result.waste_min_discount_pct,
        "revenue_max_discount_pct": result.revenue_max_discount_pct,
        "risk_score": risk,
        "action": action_for(risk, result.waste_min_discount_pct),
    }


def _stores_with_adjustments(con) -> list[str]:
    rows = con.execute("""
        SELECT store FROM stock_receipts
        UNION SELECT origin_store FROM stock_transfers WHERE status != 'cancelled'
        UNION SELECT destination_store FROM stock_transfers WHERE status = 'received'
    """).fetchall()
    return [r[0] for r in rows]


def compute_stock_overrides(con, store: Optional[str] = None) -> dict[tuple[str, str], dict]:
    """
    One entry per (store, item_id) with a nonzero net stock change from any
    source (see get_stock_adjustments_by_item), with BOTH the old
    (pipeline-baseline) and new (adjusted) risk fields - everything
    routers/stores.py needs to patch its store-level aggregate counts
    without re-scanning every item at that store. Scoped to one store when
    given (store detail/risk board), otherwise every store (the
    network-wide /stores summary and /stores/map). Cost scales with the
    number of stores that actually have a logged event, not with how many
    items exist at each.
    """
    stores_to_check = [store] if store else _stores_with_adjustments(con)
    overrides = {}
    for s in stores_to_check:
        adjustments = get_stock_adjustments_by_item(con, s)
        if not adjustments:
            continue
        item_ids = list(adjustments.keys())
        placeholders = ", ".join("?" for _ in item_ids)
        rows = con.execute(f"""
            SELECT r.item_id, r.current_stock, r.full_price, r.shelf_life_days,
                   r.risk_score, r.do_nothing_sellthrough_pct,
                   d.baseline_daily_demand, d.elasticity_used
            FROM risk_scores r
            JOIN discount_recommendations d USING (store, item_id)
            WHERE r.store = ? AND r.item_id IN ({placeholders})
        """, [s, *item_ids]).fetchall()
        for (item_id, current_stock, full_price, shelf_life_days,
             old_risk_score, old_do_nothing_pct, baseline_daily_demand, elasticity_used) in rows:
            adjustment = adjustments[item_id]
            new_fields = recompute_for_stock_change(
                current_stock, full_price, shelf_life_days, baseline_daily_demand, elasticity_used, adjustment,
            )
            overrides[(s, item_id)] = {
                **new_fields,
                "full_price": full_price,
                "old_current_stock": current_stock,
                "old_risk_score": old_risk_score,
                "old_do_nothing_sellthrough_pct": old_do_nothing_pct,
                "net_adjustment": adjustment,
            }
    return overrides
