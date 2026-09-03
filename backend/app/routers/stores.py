import json

from fastapi import APIRouter, HTTPException
from typing import List

from database import get_connection, PROC
from schemas import StoreSummary
from inventory import compute_receipt_overrides

router = APIRouter(tags=["stores"])


def _patch_store_counts(counts: dict, overrides_for_store: list) -> dict:
    """
    Adjusts a store's low/medium/high/critical counts and
    potential_revenue_at_risk for every item that's had a real stock
    receipt logged (see inventory.py) - the base SQL aggregate below still
    reflects the pipeline's original risk tiers, so each override moves one
    item from its old tier/revenue contribution to its recomputed one,
    rather than re-scanning every item at the store.
    """
    counts = dict(counts)
    for ov in overrides_for_store:
        old_key, new_key = ov["old_risk_score"].lower(), ov["risk_score"].lower()
        if old_key != new_key:
            counts[old_key] -= 1
            counts[new_key] += 1
        old_contrib = (ov["full_price"] * ov["old_current_stock"] * (1 - ov["old_do_nothing_sellthrough_pct"] / 100.0)
                       if ov["old_risk_score"] in ("High", "Critical") else 0.0)
        new_contrib = (ov["full_price"] * ov["current_stock"] * (1 - ov["do_nothing_sellthrough_pct"] / 100.0)
                       if ov["risk_score"] in ("High", "Critical") else 0.0)
        counts["potential_revenue_at_risk"] = round(counts["potential_revenue_at_risk"] + (new_contrib - old_contrib), 2)
    return counts

STORES = ["CA_1", "CA_2", "CA_3", "CA_4", "TX_1", "TX_2", "TX_3", "WI_1", "WI_2", "WI_3"]

# Disclosed assumption (like RATE_PER_MILE in scripts/08): an average line-haul
# speed for a loaded refrigerated truck, including stops - not live GPS/traffic
# data (this project has none), just a reasonable way to turn a real distance
# into a real-ish transit estimate.
AVG_TRUCK_SPEED_MPH = 52

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
    by_store = {r[0]: dict(zip(cols, r)) for r in rows}

    overrides_by_store: dict[str, list] = {}
    for (store_, _item_id), ov in compute_receipt_overrides(con).items():
        overrides_by_store.setdefault(store_, []).append(ov)
    for store_, overrides in overrides_by_store.items():
        if store_ in by_store:
            by_store[store_] = _patch_store_counts(by_store[store_], overrides)

    return [StoreSummary(**by_store[s]) for s in sorted(by_store)]


@router.get("/stores/map")
def store_map():
    """
    Every store's position and every currently active transfer route, for a
    network-wide map view. Positions are the same disclosed stand-in cities
    used throughout (scripts/08_transfer_cost_model.py) - real coordinates
    for a real city, not the store's actual (never-disclosed) location.
    Routes come straight from transfer_allocations, so a line only appears
    here if that lane is real: matched by 07_risk_scoring.py AND already
    cleared the cost-effectiveness check in 08 - never a hypothetical route.

    Registered ABOVE /stores/{store} deliberately - FastAPI matches routes
    in registration order, and "map" would otherwise be swallowed as a
    {store} path parameter value.
    """
    data = _load_distances()
    con = get_connection()
    critical_counts = dict(con.execute(
        "SELECT store, count(*) FROM risk_scores WHERE risk_score = 'Critical' GROUP BY store"
    ).fetchall())
    # A real stock receipt (see inventory.py) can push an item into or out of
    # Critical - patch the base counts the same way the store summary does,
    # so a store's marker size on the map agrees with its own overview page.
    for (store_, _item_id), ov in compute_receipt_overrides(con).items():
        if ov["old_risk_score"] == ov["risk_score"]:
            continue
        if ov["old_risk_score"] == "Critical":
            critical_counts[store_] = critical_counts.get(store_, 0) - 1
        if ov["risk_score"] == "Critical":
            critical_counts[store_] = critical_counts.get(store_, 0) + 1

    lane_rows = con.execute("""
        SELECT origin_store, destination_store,
               count(*) AS item_count,
               round(sum(value_transferred), 2) AS batch_value,
               avg(distance_miles) AS distance_miles,
               avg(shipment_cost) AS shipment_cost
        FROM transfer_allocations
        GROUP BY origin_store, destination_store
    """).fetchall()
    lanes = [
        {
            "origin_store": o, "destination_store": d,
            "item_count": int(n), "batch_value": v,
            "distance_miles": round(dist, 1), "shipment_cost": round(cost, 2),
            "transit_minutes": round(dist / AVG_TRUCK_SPEED_MPH * 60),
        }
        for o, d, n, v, dist, cost in lane_rows
    ]
    # Real status, not a fabricated "capacity %" - a store either is or isn't
    # actually sending/receiving stock in a currently active, cost-effective
    # lane right now (see scripts/08_transfer_cost_model.py).
    sending_stores = {l["origin_store"] for l in lanes}
    receiving_stores = {l["destination_store"] for l in lanes}

    stores = [
        {
            "store": s,
            "state": s.split("_")[0],
            "city": info["city"],
            "lat": info["lat"],
            "lon": info["lon"],
            "critical_items": critical_counts.get(s, 0),
            "sending_now": s in sending_stores,
            "receiving_now": s in receiving_stores,
        }
        for s, info in data["stores"].items()
    ]

    return {"stores": stores, "lanes": lanes, "rate_per_mile": data["rate_per_mile"], "avg_truck_speed_mph": AVG_TRUCK_SPEED_MPH}


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
    counts = dict(zip(cols, row))
    counts = _patch_store_counts(counts, list(compute_receipt_overrides(con, store=store).values()))
    return StoreSummary(**counts)


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
                "estimated_transit_minutes": round(row["miles"] / AVG_TRUCK_SPEED_MPH * 60),
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
    This store's transfer allocations - one row per (item, destination store)
    pair (scripts/07_risk_scoring.py + 08_transfer_cost_model.py). A single
    Critical item can appear more than once here if its surplus was split
    across multiple same-state destinations, each capped at how much it can
    genuinely absorb (never just "dump everything on the thinnest store" -
    see 07's docstring for why that was a real problem: it left 88.9% of
    destinations more overstocked than they started).

    An earlier version of this endpoint tried to add a "needs N units"
    stockout-style number, the way a generic retail transfer feature would.
    That doesn't fit what this system actually measures: days_of_cover across
    the dataset runs 10-50+ days at the median (see risk_scores.parquet) -
    stores essentially never run out of physical units. The risk this whole
    project detects is shelf-life/spoilage risk, not stockout risk. What IS
    real and used here instead: qty_transferred is capped by the destination's
    own order factor (current_stock vs. baseline_daily_demand x shelf_life),
    the same real signal the matching logic itself uses to decide "thin
    enough to bother with" in the first place - not a fabricated need number.
    """
    store = store.upper()
    con = get_connection()
    rows = con.execute("""
        SELECT
            a.item_id, a.product_name, a.barcode, a.full_price,
            a.qty_transferred, a.value_transferred, a.solo_cost_effective,
            a.destination_store, a.distance_miles, a.shipment_cost,
            a.batch_value, a.batch_item_count,
            r.current_stock AS origin_current_stock,
            r2.current_stock AS transfer_to_current_stock,
            d2.baseline_daily_demand AS transfer_to_daily_demand
        FROM transfer_allocations a
        JOIN risk_scores r ON r.store = a.origin_store AND r.item_id = a.item_id
        LEFT JOIN risk_scores r2 ON r2.store = a.destination_store AND r2.item_id = a.item_id
        LEFT JOIN discount_recommendations d2 ON d2.store = a.destination_store AND d2.item_id = a.item_id
        WHERE a.origin_store = ?
        ORDER BY a.value_transferred DESC
    """, [store]).fetchall()

    cols = ["item_id", "product_name", "barcode", "full_price",
            "qty_transferred", "value_transferred", "solo_cost_effective",
            "destination_store", "distance_miles", "shipment_cost",
            "batch_value", "batch_item_count",
            "origin_current_stock", "transfer_to_current_stock", "transfer_to_daily_demand"]
    out = [dict(zip(cols, r)) for r in rows]

    # How much of this item's total surplus is left over at the origin after
    # ALL its (possibly multiple) destinations are accounted for - shown once
    # per item, not per allocation row, so a 2-destination item doesn't look
    # like it has two different leftover amounts.
    placed_by_item: dict[str, float] = {}
    for row in out:
        placed_by_item[row["item_id"]] = placed_by_item.get(row["item_id"], 0.0) + row["qty_transferred"]

    return [
        {
            "item_id": r["item_id"], "product_name": r["product_name"], "barcode": r["barcode"],
            "full_price": r["full_price"],
            "current_stock": round(r["origin_current_stock"], 1),
            "qty_transferred": round(r["qty_transferred"], 1),
            "leftover_qty": round(max(0.0, r["origin_current_stock"] - placed_by_item[r["item_id"]]), 1),
            "transfer_to_store": r["destination_store"],
            "transfer_to_current_stock": round(r["transfer_to_current_stock"], 1) if r["transfer_to_current_stock"] is not None else None,
            "transfer_to_daily_demand": round(r["transfer_to_daily_demand"], 1) if r["transfer_to_daily_demand"] is not None else None,
            "transfer_distance_miles": round(r["distance_miles"], 1),
            # Shipment economics (Task #11) - see scripts/08_transfer_cost_model.py.
            # This allocation's own value is almost never enough to justify a
            # dedicated truck by itself; it only becomes worth moving once
            # batched with every other allocation queued for the same route.
            "transfer_item_value": round(r["value_transferred"], 2),
            "transfer_solo_cost_effective": r["solo_cost_effective"],
            "transfer_shipment_cost": r["shipment_cost"],
            "transfer_batch_value": round(r["batch_value"], 2),
            "transfer_batch_item_count": int(r["batch_item_count"]),
        }
        for r in out
    ]
