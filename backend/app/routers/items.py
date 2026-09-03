from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query

from database import get_connection
from schemas import ItemSummary, ItemDetail, ScheduleDay
from optimizer import build_countdown_schedule
from inventory import get_stock_adjustments_by_item, recompute_for_stock_change

router = APIRouter(tags=["items"])

VALID_RISK = {"Low", "Medium", "High", "Critical"}
RISK_ORDER = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}

ITEM_SUMMARY_COLS = [
    "store", "item_id", "product_name", "barcode", "shelf_life_tier", "shelf_life_days",
    "current_stock", "full_price", "risk_score", "action", "do_nothing_sellthrough_pct",
    "waste_min_discount_pct", "revenue_max_discount_pct", "reachable_target",
]
# category comes from a LEFT JOIN, not the risk_scores table itself, so it's
# selected separately (aliased "r." for the base columns) rather than folded
# into ITEM_SUMMARY_COLS, which get_item's join below also relies on as a
# plain risk_scores column list.
ITEM_SUMMARY_COLS_R = [f"r.{c}" for c in ITEM_SUMMARY_COLS]


@router.get("/stores/{store}/items", response_model=List[ItemSummary])
def list_items(store: str, risk: Optional[str] = Query(None, description="Filter by risk tier: Low/Medium/High/Critical")):
    store = store.upper()
    if risk is not None and risk.capitalize() not in VALID_RISK:
        raise HTTPException(status_code=400, detail=f"risk must be one of {sorted(VALID_RISK)}")

    con = get_connection()
    # Always pull every item for the store (not filtered by risk in SQL) and
    # always join discount_recommendations - a stock receipt or transfer can
    # change an item's risk tier (see inventory.py), so filtering against
    # the STALE risk_scores.risk_score column would hide/show the wrong rows
    # for any item with a logged event. Cheap at this data scale (a few
    # hundred to ~1,500 rows per store) to filter/sort in Python instead.
    cols_sql = ", ".join(ITEM_SUMMARY_COLS_R) + ", c.category, d.baseline_daily_demand, d.elasticity_used"
    rows = con.execute(f"""
        SELECT {cols_sql}
        FROM risk_scores r
        JOIN discount_recommendations d USING (store, item_id)
        LEFT JOIN item_catalog c USING (item_id)
        WHERE r.store = ?
    """, [store]).fetchall()

    extra_cols = ITEM_SUMMARY_COLS + ["category", "baseline_daily_demand", "elasticity_used"]
    items = [dict(zip(extra_cols, r)) for r in rows]

    adjustments = get_stock_adjustments_by_item(con, store)
    if adjustments:
        for item in items:
            adjustment = adjustments.get(item["item_id"])
            if adjustment:
                item.update(recompute_for_stock_change(
                    item["current_stock"], item["full_price"], item["shelf_life_days"],
                    item["baseline_daily_demand"], item["elasticity_used"], adjustment,
                ))
                item["stock_adjustment"] = adjustment

    if risk:
        items = [i for i in items if i["risk_score"] == risk.capitalize()]
    items.sort(key=lambda i: (RISK_ORDER[i["risk_score"]], i["do_nothing_sellthrough_pct"]))

    out_cols = ITEM_SUMMARY_COLS + ["category", "stock_adjustment"]
    return [ItemSummary(**{k: i.get(k) for k in out_cols}) for i in items]


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

    # Same live stock-adjustment overlay as list_items above - a store's
    # item detail page and its risk board must always agree on
    # current_stock/risk_score for the same item.
    adjustment = get_stock_adjustments_by_item(con, store).get(item_id)
    if adjustment:
        data.update(recompute_for_stock_change(
            data["current_stock"], data["full_price"], data["shelf_life_days"],
            data["baseline_daily_demand"], data["elasticity_used"], adjustment,
        ))
        data["stock_adjustment"] = adjustment

    # Live countdown schedule, computed fresh from the optimizer rather than
    # only for the two pre-baked examples - cheap enough (a few hundred
    # iterations at most) to run per request. Uses current_stock AFTER the
    # adjustment overlay above, so a freshly-restocked or partly-shipped
    # item's schedule reflects what's actually on the shelf now.
    schedule = build_countdown_schedule(
        data["baseline_daily_demand"], data["elasticity_used"], data["shelf_life_days"],
        data["current_stock"], data["full_price"],
    )
    data["schedule"] = [ScheduleDay(**s) for s in schedule]
    return ItemDetail(**data)
