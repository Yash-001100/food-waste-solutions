"""
Stock receipts: a real "a shipment came in" event, logged by an associate
uploading a CSV (routers/inventory.py) instead of typing every item's new
stock into a form by hand. Recorded as an append-only ledger (stock_receipts
in database.py) - the same non-destructive philosophy as applied_actions -
rather than rewriting risk_scores.parquet directly.

Everywhere this app reports a store-item's current_stock, it is really
"the pipeline's baseline stock (risk_scores.current_stock) + everything
received since." Because a receipt genuinely changes how much stock has to
sell through before it expires, risk_score/action/do_nothing_sellthrough_pct
/reachable_target/discount recommendations all get recomputed for that item
too, live, using the exact same optimizer this whole app already uses
elsewhere (recommend_discount + score_row/action_for) - not a second,
parallel methodology. In practice this often makes an item's risk go UP
after a receipt, not down: ordering more of something that was already
slow-moving is exactly the situation this project exists to catch.

Deliberately out of scope: transfer_allocations (the nationwide same-state
transfer matching in scripts/07) does NOT re-run live against receipts -
that matching is a batch/pipeline concept, and re-solving it per request
across all 10 stores is a different-sized problem than reflecting one
store's own updated stock. A freshly-Critical item from a receipt will
correctly show up as Critical on the risk board and store summary; it will
only get real transfer candidates on the next pipeline run. This boundary
is disclosed in the Receive Stock page.
"""
from typing import Optional

from optimizer import recommend_discount, score_row, action_for


def get_receipts_by_item(con, store: str) -> dict[str, float]:
    """Total quantity received per item_id at this store, across all time."""
    rows = con.execute(
        "SELECT item_id, sum(qty_received) FROM stock_receipts WHERE store = ? GROUP BY item_id",
        [store],
    ).fetchall()
    return {item_id: qty for item_id, qty in rows}


def recompute_for_receipt(current_stock: float, full_price: float, shelf_life_days: int,
                           baseline_daily_demand: float, elasticity_used: float,
                           received_qty: float) -> dict:
    """
    Given a store-item's real base numbers plus how much has been received
    since, returns the full set of recomputed stock-dependent fields at the
    new stock level - current_stock, do_nothing_sellthrough_pct,
    reachable_target, waste_min_discount_pct, revenue_max_discount_pct,
    risk_score, action.
    """
    new_stock = current_stock + received_qty
    result = recommend_discount(baseline_daily_demand, elasticity_used, shelf_life_days,
                                 new_stock, full_price)
    risk = score_row(result.do_nothing_sellthrough_pct, result.reachable_target)
    return {
        "current_stock": round(new_stock, 2),
        "do_nothing_sellthrough_pct": result.do_nothing_sellthrough_pct,
        "reachable_target": result.reachable_target,
        "waste_min_discount_pct": result.waste_min_discount_pct,
        "revenue_max_discount_pct": result.revenue_max_discount_pct,
        "risk_score": risk,
        "action": action_for(risk, result.waste_min_discount_pct),
    }


def compute_receipt_overrides(con, store: Optional[str] = None) -> dict[tuple[str, str], dict]:
    """
    One entry per (store, item_id) that has at least one logged receipt,
    with BOTH the old (pipeline-baseline) and new (receipt-adjusted) risk
    fields - everything routers/stores.py needs to patch its store-level
    aggregate counts without re-scanning every item at that store. Scoped to
    one store when given (store detail/risk board), otherwise every store
    (the network-wide /stores summary) - cost scales with the number of
    receipts logged, not the number of items at a store.
    """
    where = "WHERE sr.store = ?" if store else ""
    params = [store] if store else []
    rows = con.execute(f"""
        SELECT r.store, r.item_id, r.current_stock, r.full_price, r.shelf_life_days,
               r.risk_score, r.do_nothing_sellthrough_pct,
               d.baseline_daily_demand, d.elasticity_used,
               sum(sr.qty_received) AS received
        FROM stock_receipts sr
        JOIN risk_scores r ON r.store = sr.store AND r.item_id = sr.item_id
        JOIN discount_recommendations d ON d.store = sr.store AND d.item_id = sr.item_id
        {where}
        GROUP BY r.store, r.item_id, r.current_stock, r.full_price, r.shelf_life_days,
                 r.risk_score, r.do_nothing_sellthrough_pct, d.baseline_daily_demand, d.elasticity_used
    """, params).fetchall()

    overrides = {}
    for (store_, item_id, current_stock, full_price, shelf_life_days,
         old_risk_score, old_do_nothing_pct, baseline_daily_demand, elasticity_used, received) in rows:
        new_fields = recompute_for_receipt(
            current_stock, full_price, shelf_life_days, baseline_daily_demand, elasticity_used, received,
        )
        overrides[(store_, item_id)] = {
            **new_fields,
            "full_price": full_price,
            "old_current_stock": current_stock,
            "old_risk_score": old_risk_score,
            "old_do_nothing_sellthrough_pct": old_do_nothing_pct,
            "received": received,
        }
    return overrides
