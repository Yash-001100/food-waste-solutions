from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query

from database import get_connection
from schemas import ItemSummary, ItemDetail, ScheduleDay
from optimizer import build_countdown_schedule

router = APIRouter(tags=["items"])

VALID_RISK = {"Low", "Medium", "High", "Critical"}

ITEM_SUMMARY_COLS = [
    "store", "item_id", "product_name", "barcode", "shelf_life_tier", "shelf_life_days",
    "current_stock", "full_price", "risk_score", "action", "do_nothing_sellthrough_pct",
    "waste_min_discount_pct", "revenue_max_discount_pct", "reachable_target",
]


@router.get("/stores/{store}/items", response_model=List[ItemSummary])
def list_items(store: str, risk: Optional[str] = Query(None, description="Filter by risk tier: Low/Medium/High/Critical")):
    store = store.upper()
    if risk is not None and risk.capitalize() not in VALID_RISK:
        raise HTTPException(status_code=400, detail=f"risk must be one of {sorted(VALID_RISK)}")

    con = get_connection()
    cols_sql = ", ".join(ITEM_SUMMARY_COLS)
    if risk:
        rows = con.execute(
            f"SELECT {cols_sql} FROM risk_scores WHERE store = ? AND risk_score = ? "
            f"ORDER BY do_nothing_sellthrough_pct ASC",
            [store, risk.capitalize()],
        ).fetchall()
    else:
        rows = con.execute(
            f"SELECT {cols_sql} FROM risk_scores WHERE store = ? "
            f"ORDER BY CASE risk_score WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 "
            f"WHEN 'Medium' THEN 2 ELSE 3 END, do_nothing_sellthrough_pct ASC",
            [store],
        ).fetchall()
    return [ItemSummary(**dict(zip(ITEM_SUMMARY_COLS, r))) for r in rows]


@router.get("/items/{store}/{item_id}", response_model=ItemDetail)
def get_item(store: str, item_id: str):
    store = store.upper()
    con = get_connection()

    row = con.execute(f"""
        SELECT r.{', r.'.join(ITEM_SUMMARY_COLS)}, d.baseline_daily_demand, d.elasticity_used,
               c.category, c.vendor, c.batch_lot, c.shelf_location
        FROM risk_scores r
        JOIN discount_recommendations d USING (store, item_id)
        LEFT JOIN item_catalog c USING (item_id)
        WHERE r.store = ? AND r.item_id = ?
    """, [store, item_id]).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"No item '{item_id}' at store '{store}'")

    data = dict(zip(
        ITEM_SUMMARY_COLS + ["baseline_daily_demand", "elasticity_used",
                              "category", "vendor", "batch_lot", "shelf_location"],
        row,
    ))

    # Live countdown schedule, computed fresh from the optimizer rather than
    # only for the two pre-baked examples - cheap enough (a few hundred
    # iterations at most) to run per request.
    schedule = build_countdown_schedule(
        data["baseline_daily_demand"], data["elasticity_used"], data["shelf_life_days"],
        data["current_stock"], data["full_price"],
    )
    data["schedule"] = [ScheduleDay(**s) for s in schedule]
    return ItemDetail(**data)
