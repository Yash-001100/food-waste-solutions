"""
Analytics & Insights (Task #10): real daily sales, real discount response,
the model's own risk/action distribution, and the store's actual applied-
action log. Everything here reads from data already produced by the
existing pipeline (scripts/01-07) - no new synthetic fields are introduced.
"""
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from database import get_connection, PROC
from routers.auth import get_current_user
from schemas import (
    CurrentUser,
    DiscountBucket,
    ElasticityResponse,
    OutcomesResponse,
    OutcomeSlice,
    RiskActionMix,
    SalesHistoryPoint,
    SalesHistoryResponse,
    TransactionLogRow,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])

STORES = ["CA_1", "CA_2", "CA_3", "CA_4", "TX_1", "TX_2", "TX_3", "WI_1", "WI_2", "WI_3"]

_ELASTICITY_PATH = PROC / "elasticity" / "elasticity_final.json"
_elasticity_cache: Optional[dict] = None


def _load_elasticity() -> dict:
    global _elasticity_cache
    if _elasticity_cache is None:
        with open(_ELASTICITY_PATH) as f:
            _elasticity_cache = json.load(f)
    return _elasticity_cache


@router.get("/sales-history/{store}/{item_id}", response_model=SalesHistoryResponse)
def sales_history(store: str, item_id: str, days: int = Query(90, ge=7, le=1913)):
    """
    Real day-by-day units sold + real store price for one item, straight
    from the M5 sales history (data/processed/foods_long_{store}.parquet) -
    the same real data the README's "Real: daily unit sales..." line refers
    to. discount_pct is computed against this app's own full_price (the
    same number shown on the item detail page), not the rolling 90-day
    reference price the elasticity regression uses internally - so it always
    matches what an associate already sees elsewhere in the dashboard.
    """
    store = store.upper()
    if store not in STORES:
        raise HTTPException(status_code=404, detail=f"Unknown store '{store}'")

    con = get_connection()
    item_row = con.execute(
        "SELECT product_name, full_price, baseline_daily_demand FROM risk_scores WHERE store = ? AND item_id = ?",
        [store, item_id],
    ).fetchone()
    if item_row is None:
        raise HTTPException(status_code=404, detail=f"No item '{item_id}' at store '{store}'")
    product_name, full_price, baseline_daily_demand = item_row

    rows = con.execute(
        """
        SELECT date, qty, sell_price FROM daily_sales
        WHERE store = ? AND item_id = ?
        ORDER BY date DESC
        LIMIT ?
        """,
        [store, item_id, days],
    ).fetchall()

    points = [
        SalesHistoryPoint(
            date=str(d.date()),
            qty=float(q),
            sell_price=float(p) if p is not None else None,
            discount_pct=round((1 - (p / full_price)) * 100, 1) if p else 0.0,
        )
        for d, q, p in reversed(rows)
    ]
    return SalesHistoryResponse(
        store=store,
        item_id=item_id,
        product_name=product_name,
        full_price=full_price,
        baseline_daily_demand=baseline_daily_demand,
        points=points,
    )


_BUCKET_ORDER = ["full_price", "0-2pct_off", "2-5pct_off", "5-10pct_off", "10pct_plus_off"]
_BUCKET_LABELS = {
    "full_price": "Full price",
    "0-2pct_off": "0-2% off",
    "2-5pct_off": "2-5% off",
    "5-10pct_off": "5-10% off",
    "10pct_plus_off": "10%+ off",
}


@router.get("/elasticity/{store}", response_model=ElasticityResponse)
def elasticity(store: str):
    """
    This store's real discount-response curve: for each real discount depth
    observed in the M5 data, how much more (or less) than usual this store's
    items actually sold (05_price_elasticity.py's discount_response_*.csv).
    Paired with the store-level elasticity coefficient the optimizer itself
    uses (elasticity_final.json) - some stores have too little real
    discounting to estimate their own coefficient reliably, in which case a
    pooled fallback is used, disclosed here via `source`.
    """
    store = store.upper()
    if store not in STORES:
        raise HTTPException(status_code=404, detail=f"Unknown store '{store}'")

    con = get_connection()
    rows = con.execute(
        "SELECT bucket, price_ratio_range, n_obs, mean_qty_norm FROM discount_response WHERE store = ?",
        [store],
    ).fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail=f"No elasticity data for '{store}'")
    by_bucket = {r[0]: r for r in rows}
    buckets = [
        DiscountBucket(
            bucket=b, label=_BUCKET_LABELS[b], price_ratio_range=by_bucket[b][1],
            n_obs=by_bucket[b][2], mean_qty_norm=by_bucket[b][3],
        )
        for b in _BUCKET_ORDER if b in by_bucket
    ]

    elasticity_data = _load_elasticity()
    store_info = elasticity_data["by_store"].get(store, {})
    return ElasticityResponse(
        store=store,
        elasticity_used=store_info.get("used_elasticity", elasticity_data["fallback_elasticity"]),
        source=store_info.get("source", "pooled_fallback"),
        buckets=buckets,
    )


@router.get("/risk-action-mix", response_model=List[RiskActionMix])
def risk_action_mix():
    """
    Cross-store view of the model's own output: how many items land in each
    risk tier, and which recommended action they get. Risk tier and action
    are deterministic from each other (see scripts/07_risk_scoring.py) - Low
    always means Monitor, Medium always means Small markdown, and so on -
    so this is one distribution shown two ways, not two independent facts.
    """
    con = get_connection()
    rows = con.execute(
        """
        SELECT store,
            sum(CASE WHEN risk_score = 'Low' THEN 1 ELSE 0 END) AS low,
            sum(CASE WHEN risk_score = 'Medium' THEN 1 ELSE 0 END) AS medium,
            sum(CASE WHEN risk_score = 'High' THEN 1 ELSE 0 END) AS high,
            sum(CASE WHEN risk_score = 'Critical' THEN 1 ELSE 0 END) AS critical,
            sum(CASE WHEN action = 'Monitor' THEN 1 ELSE 0 END) AS monitor,
            sum(CASE WHEN action LIKE 'Small markdown%' THEN 1 ELSE 0 END) AS small_markdown,
            sum(CASE WHEN action LIKE 'Deep markdown%' THEN 1 ELSE 0 END) AS deep_markdown,
            sum(CASE WHEN action LIKE 'Transfer%' THEN 1 ELSE 0 END) AS transfer,
            sum(CASE WHEN action LIKE 'Donate%' THEN 1 ELSE 0 END) AS donate
        FROM risk_scores
        GROUP BY store
        ORDER BY store
        """
    ).fetchall()
    cols = ["store", "low", "medium", "high", "critical", "monitor", "small_markdown", "deep_markdown", "transfer", "donate"]
    return [RiskActionMix(**dict(zip(cols, r))) for r in rows]


@router.get("/outcomes", response_model=OutcomesResponse)
def outcomes(store: Optional[str] = Query(None), current_user: CurrentUser = Depends(get_current_user)):
    """
    What actually happened, not what the model recommended: a breakdown of
    applied_actions (excluding reverted ones - they didn't happen). Markdown
    is split into Deep/Small using the SAME risk tier the item was in
    (High -> Deep, Medium -> Small) that scripts/07_risk_scoring.py uses for
    its own action label, joined live since risk_scores is static data.
    Pass no store to see every store's demo activity combined.
    """
    con = get_connection()
    where = "WHERE aa.status != 'reverted'"
    params: list = []
    if store:
        store = store.upper()
        if store not in STORES:
            raise HTTPException(status_code=404, detail=f"Unknown store '{store}'")
        where += " AND aa.store = ?"
        params.append(store)

    rows = con.execute(
        f"""
        SELECT
            CASE
                WHEN aa.action_type = 'donate' THEN 'Donated'
                WHEN aa.action_type = 'dispose' THEN 'Disposed'
                WHEN aa.action_type = 'transfer' THEN 'Transferred'
                WHEN aa.action_type = 'monitor' THEN 'Monitored'
                WHEN aa.action_type = 'markdown' AND rs.risk_score = 'High' THEN 'Deep markdown'
                WHEN aa.action_type = 'markdown' AND rs.risk_score = 'Medium' THEN 'Small markdown'
                WHEN aa.action_type = 'markdown' THEN 'Markdown'
                ELSE 'Other'
            END AS label,
            count(*) AS n,
            coalesce(sum(aa.value_saved), 0.0) AS value_saved,
            coalesce(sum(CASE WHEN aa.action_type = 'dispose' THEN aa.stock_at_action * rs.full_price ELSE 0 END), 0.0) AS value_lost
        FROM applied_actions aa
        LEFT JOIN risk_scores rs ON rs.store = aa.store AND rs.item_id = aa.item_id
        {where}
        GROUP BY 1
        ORDER BY n DESC
        """,
        params,
    ).fetchall()

    slices = [OutcomeSlice(label=r[0], count=r[1], value_saved=round(r[2], 2), value_lost=round(r[3], 2)) for r in rows]

    # "Lost in transit" - a real outcome that isn't an applied_action at all
    # (see routers/transfers.py's confirm_transfer): the destination reported
    # receiving less than what was shipped, and that shortfall never landed
    # anywhere - real shrinkage, the same total-loss category as Disposed.
    # Attributed to the destination store (the one that reported it), same
    # as a dispose/donate is attributed to whichever store clicked it.
    transit_where = "WHERE st.status = 'received' AND st.qty_confirmed IS NOT NULL AND st.qty_confirmed < st.qty"
    transit_params: list = []
    if store:
        transit_where += " AND st.destination_store = ?"
        transit_params.append(store)
    transit_row = con.execute(
        f"""
        SELECT count(*), coalesce(sum((st.qty - st.qty_confirmed) * r.full_price), 0.0)
        FROM stock_transfers st
        LEFT JOIN risk_scores r ON r.store = st.origin_store AND r.item_id = st.item_id
        {transit_where}
        """,
        transit_params,
    ).fetchone()
    if transit_row and transit_row[0] > 0:
        slices.append(OutcomeSlice(label="Lost in transit", count=transit_row[0], value_saved=0.0,
                                    value_lost=round(transit_row[1], 2)))

    total = sum(s.count for s in slices)
    return OutcomesResponse(store=store, total=total, slices=slices)


@router.get("/transaction-log", response_model=List[TransactionLogRow])
def transaction_log(
    store: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    The store's real applied-action log with product detail attached -
    every row is something an associate actually clicked "Apply"/"Donate"/
    "Dispose" on (or reverted) - plus a synthetic "transfer_loss" row for
    every confirmed transfer into this store that came in short (see
    routers/transfers.py's confirm_transfer), so a real shrinkage event
    shows up here even though no one "applied" it. `quantity` is the stock
    frozen at the moment of that action (see stock_at_action in
    database.py) for applied_actions rows, or the lost quantity itself for
    a transfer_loss row; it's null for applied_actions rows logged before
    that column existed.
    """
    con = get_connection()
    where = ""
    params: list = []
    if store:
        store = store.upper()
        if store not in STORES:
            raise HTTPException(status_code=404, detail=f"Unknown store '{store}'")
        where = "WHERE aa.store = ?"
        params.append(store)

    rows = con.execute(
        f"""
        SELECT aa.id, aa.store, aa.item_id, rs.product_name, aa.action_type, aa.discount_pct,
               aa.stock_at_action, rs.full_price, aa.value_saved,
               CASE WHEN aa.action_type = 'dispose' THEN round(aa.stock_at_action * rs.full_price, 2) END AS value_lost,
               aa.status, aa.applied_at
        FROM applied_actions aa
        LEFT JOIN risk_scores rs ON rs.store = aa.store AND rs.item_id = aa.item_id
        {where}
        ORDER BY aa.applied_at DESC
        LIMIT ?
        """,
        params + [limit],
    ).fetchall()

    cols = ["id", "store", "item_id", "product_name", "action_type", "discount_pct",
            "quantity", "full_price", "value_saved", "value_lost", "status", "applied_at"]
    out = []
    for r in rows:
        d = dict(zip(cols, r))
        d["applied_at"] = str(d["applied_at"])
        d["product_name"] = d["product_name"] or d["item_id"]
        out.append(TransactionLogRow(**d))

    transit_where = "WHERE st.status = 'received' AND st.qty_confirmed IS NOT NULL AND st.qty_confirmed < st.qty"
    transit_params: list = []
    if store:
        transit_where += " AND st.destination_store = ?"
        transit_params.append(store)
    transit_rows = con.execute(
        f"""
        SELECT st.id, st.destination_store, st.item_id, r.product_name,
               (st.qty - st.qty_confirmed) AS lost_qty, r.full_price, st.received_at
        FROM stock_transfers st
        LEFT JOIN risk_scores r ON r.store = st.origin_store AND r.item_id = st.item_id
        {transit_where}
        ORDER BY st.received_at DESC
        LIMIT ?
        """,
        transit_params + [limit],
    ).fetchall()
    for tid, dest_store, item_id, product_name, lost_qty, full_price, received_at in transit_rows:
        out.append(TransactionLogRow(
            # Negative id so it can never collide with a real applied_actions
            # id (a BIGINT sequence starting at 1) in the frontend's React
            # list keys - this row isn't an applied_action, it's derived.
            id=-tid, store=dest_store, item_id=item_id, product_name=product_name or item_id,
            action_type="transfer_loss", discount_pct=None, quantity=lost_qty, full_price=full_price,
            value_saved=None, value_lost=round(lost_qty * full_price, 2) if full_price is not None else None,
            status="received", applied_at=str(received_at),
        ))

    out.sort(key=lambda r: r.applied_at, reverse=True)
    return out[:limit]
