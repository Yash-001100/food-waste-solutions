import json

from fastapi import APIRouter, HTTPException
from typing import List

from database import get_connection, PROC
from schemas import StoreSummary

router = APIRouter(tags=["stores"])

STORES = ["CA_1", "CA_2", "CA_3", "CA_4", "TX_1", "TX_2", "TX_3", "WI_1", "WI_2", "WI_3"]

_DISTANCES_PATH = PROC / "store_distances.json"
_distances_cache = None


def _load_distances() -> dict:
    """
    Real store-to-store distances (scripts/08_transfer_cost_model.py): each
    store is mapped to a real, distinct major city in its (real) state, and
    distance is the real haversine great-circle distance between those real
    coordinates - see that script's docstring for exactly what's real vs a
    disclosed stand-in.
    """
    global _distances_cache
    if _distances_cache is None:
        with open(_DISTANCES_PATH) as f:
            _distances_cache = json.load(f)
    return _distances_cache


@router.get("/stores", response_model=List[StoreSummary])
def list_stores():
    con = get_connection()
    rows = con.execute("""
        SELECT
            store,
            count(*) AS total_items,
            sum(CASE WHEN risk_score = 'Low' THEN 1 ELSE 0 END) AS low,
            sum(CASE WHEN risk_score = 'Medium' THEN 1 ELSE 0 END) AS medium,
            sum(CASE WHEN risk_score = 'High' THEN 1 ELSE 0 END) AS high,
            sum(CASE WHEN risk_score = 'Critical' THEN 1 ELSE 0 END) AS critical,
            -- $ value of stock projected to go unsold if nothing is done,
            -- for the tiers where that's actually a live risk (High/Critical)
            round(sum(CASE WHEN risk_score IN ('High', 'Critical')
                THEN full_price * current_stock * (1 - do_nothing_sellthrough_pct / 100.0)
                ELSE 0 END), 2) AS potential_revenue_at_risk
        FROM risk_scores
        GROUP BY store
        ORDER BY store
    """).fetchall()
    cols = ["store", "total_items", "low", "medium", "high", "critical", "potential_revenue_at_risk"]
    return [StoreSummary(**dict(zip(cols, r))) for r in rows]


@router.get("/stores/{store}", response_model=StoreSummary)
def get_store(store: str):
    store = store.upper()
    if store not in STORES:
        raise HTTPException(status_code=404, detail=f"Unknown store '{store}'")
    con = get_connection()
    row = con.execute("""
        SELECT
            store, count(*),
            sum(CASE WHEN risk_score = 'Low' THEN 1 ELSE 0 END),
            sum(CASE WHEN risk_score = 'Medium' THEN 1 ELSE 0 END),
            sum(CASE WHEN risk_score = 'High' THEN 1 ELSE 0 END),
            sum(CASE WHEN risk_score = 'Critical' THEN 1 ELSE 0 END),
            round(sum(CASE WHEN risk_score IN ('High', 'Critical')
                THEN full_price * current_stock * (1 - do_nothing_sellthrough_pct / 100.0)
                ELSE 0 END), 2)
        FROM risk_scores WHERE store = ? GROUP BY store
    """, [store]).fetchone()
    cols = ["store", "total_items", "low", "medium", "high", "critical", "potential_revenue_at_risk"]
    return StoreSummary(**dict(zip(cols, row)))


@router.get("/stores/{store}/distances")
def store_distances(store: str):
    """
    Real distance from this store to every other store, nearest first - the
    direct answer to "what is the distance of store CA_1 to CA_2 and
    similar to other stores." See scripts/08_transfer_cost_model.py for what
    each distance is actually computed from.
    """
    store = store.upper()
    if store not in STORES:
        raise HTTPException(status_code=404, detail=f"Unknown store '{store}'")
    data = _load_distances()
    if store not in data["stores"]:
        raise HTTPException(status_code=404, detail=f"No distance data for '{store}'")

    others = sorted(
        (
            {
                "store": row["store_b"],
                "city": data["stores"][row["store_b"]]["city"],
                "miles": row["miles"],
                "estimated_shipment_cost": round(row["miles"] * data["rate_per_mile"], 2),
            }
            for row in data["distances"]
            if row["store_a"] == store
        ),
        key=lambda r: r["miles"],
    )
    return {
        "store": store,
        "city": data["stores"][store]["city"],
        "rate_per_mile": data["rate_per_mile"],
        "distances": others,
    }


@router.get("/stores/{store}/transfers")
def list_transfers(store: str):
    """
    Critical items at this store with a resolved transfer target elsewhere.

    An earlier version of this endpoint tried to add a "needs N units"
    stockout-style number, the way a generic retail transfer feature would.
    That doesn't fit what this system actually measures: days_of_cover across
    the dataset runs 10-50+ days at the median (see risk_scores.parquet) -
    stores essentially never run out of physical units. The risk this whole
    project detects is shelf-life/spoilage risk, not stockout risk, so a
    "needed_qty" framed as replenishment need would be a fabricated number
    dressed up as real: computing it honestly (days-of-cover math on the
    sister store's own demand) returned needed=1 unit for 86% of rows in a
    spot check, because the target stores are never actually low on hand -
    that's the tell that the underlying "running low" is a relative
    order/demand-factor comparison, not an absolute stock shortage.

    What's real and worth surfacing instead: the sister store's own current
    stock and daily demand for the same item, so a reader can see for
    themselves that the store is comparatively higher-velocity for this item
    (a better home for it before it expires here) - without a fabricated
    "needs X units" urgency claim layered on top.
    """
    store = store.upper()
    con = get_connection()
    rows = con.execute("""
        SELECT
            r.item_id, r.product_name, r.barcode, r.current_stock, r.full_price,
            r.action, r.transfer_target_store,
            r2.current_stock AS transfer_to_current_stock,
            d2.baseline_daily_demand AS transfer_to_daily_demand,
            r.transfer_item_value, r.transfer_solo_cost_effective, r.transfer_shipment_cost,
            r.transfer_batch_value, r.transfer_batch_item_count, r.transfer_distance_miles
        FROM risk_scores r
        LEFT JOIN risk_scores r2
            ON r2.store = r.transfer_target_store AND r2.item_id = r.item_id
        LEFT JOIN discount_recommendations d2
            ON d2.store = r.transfer_target_store AND d2.item_id = r.item_id
        WHERE r.store = ? AND r.risk_score = 'Critical' AND r.action LIKE 'Transfer to%'
        ORDER BY r.current_stock DESC
    """, [store]).fetchall()

    return [
        {
            "item_id": item_id, "product_name": product_name, "barcode": barcode,
            "current_stock": current_stock, "full_price": full_price,
            "transfer_detail": action,
            "transfer_to_store": to_store,
            "transfer_to_current_stock": round(to_stock, 1) if to_stock is not None else None,
            "transfer_to_daily_demand": round(to_demand, 1) if to_demand is not None else None,
            # Shipment economics (Task #11) - see scripts/08_transfer_cost_model.py.
            # This item's OWN stock value is almost never enough to justify a
            # dedicated truck on its own (transfer_solo_cost_effective is False
            # for the vast majority of rows); it only becomes worth moving once
            # batched with every other item queued for the same destination.
            "transfer_item_value": round(item_value, 2) if item_value is not None else None,
            "transfer_solo_cost_effective": solo_ok,
            "transfer_shipment_cost": shipment_cost,
            "transfer_batch_value": round(batch_value, 2) if batch_value is not None else None,
            "transfer_batch_item_count": int(batch_n) if batch_n is not None else None,
            "transfer_distance_miles": round(distance_mi, 1) if distance_mi is not None else None,
        }
        for (item_id, product_name, barcode, current_stock, full_price, action,
             to_store, to_stock, to_demand,
             item_value, solo_ok, shipment_cost, batch_value, batch_n, distance_mi) in rows
    ]
