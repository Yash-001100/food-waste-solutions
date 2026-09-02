"""
Transfer cost model (Task #11): prices the transfer allocations that
07_risk_scoring.py already decided on (who ships how many units of what to
whom), and downgrades any route that isn't worth dispatching a truck for.

v3 (this version) operates directly on scripts/07's transfer_allocations.parquet
- one row per (origin store, item, destination store, quantity) - instead of
regex-parsing a summary string, because 07 now splits a single item's surplus
across MULTIPLE destinations (per user feedback: a destination should only
ever receive as much as it can genuinely use, so leftover often has to be
offered to a second or third same-state store). Parsing that back out of a
free-text "action" string would be fragile; reading the allocations table
directly is not.

What's real vs a disclosed stand-in (unchanged from v2, see git history for
the fuller writeup): the M5 dataset never discloses a store's real city, so
each store maps to a real, distinct major city in its (real) state; distance
is the real haversine great-circle distance between those real coordinates;
shipment cost is that distance x a real, current 2026 dry-van rate
($2.40/mi, the middle of the $2.20-2.60/mi range 2026 freight-rate guides
report).

Economics are evaluated per LANE (origin store -> destination store), not
per item: every allocation riding the same lane shares one shipment, so the
fixed cost is checked against everything moving on that lane combined. A
lane that doesn't clear COST_EFFECTIVE_THRESHOLD has ALL of its allocations
dropped - those units revert to "donate" rather than being re-offered to a
different destination (a disclosed simplification: re-routing a dropped
allocation to yet another store would compound the already-multi-destination
logic further, for a case that turns out to be rare in this data - see the
printed summary).
"""
import math
from pathlib import Path

import pandas as pd

PROC = Path(__file__).resolve().parents[1] / "data" / "processed"

STORE_CITIES = {
    "CA_1": ("Los Angeles, CA", 34.0522, -118.2437),
    "CA_2": ("San Francisco, CA", 37.7749, -122.4194),
    "CA_3": ("Sacramento, CA", 38.5816, -121.4944),
    "CA_4": ("San Diego, CA", 32.7157, -117.1611),
    "TX_1": ("Houston, TX", 29.7604, -95.3698),
    "TX_2": ("Dallas, TX", 32.7767, -96.7970),
    "TX_3": ("San Antonio, TX", 29.4241, -98.4936),
    "WI_1": ("Milwaukee, WI", 43.0389, -87.9065),
    "WI_2": ("Madison, WI", 43.0731, -89.4012),
    "WI_3": ("Green Bay, WI", 44.5133, -88.0133),
}

RATE_PER_MILE = 2.40
COST_EFFECTIVE_THRESHOLD = 0.30


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 3958.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def distance_between(store_a: str, store_b: str) -> float:
    _, lat_a, lon_a = STORE_CITIES[store_a]
    _, lat_b, lon_b = STORE_CITIES[store_b]
    return haversine_miles(lat_a, lon_a, lat_b, lon_b)


def write_distance_reference():
    from itertools import combinations
    import json
    rows = []
    for a, b in combinations(STORE_CITIES, 2):
        miles = round(distance_between(a, b), 1)
        rows.append({"store_a": a, "store_b": b, "miles": miles})
        rows.append({"store_a": b, "store_b": a, "miles": miles})
    payload = {
        "rate_per_mile": RATE_PER_MILE,
        "stores": {s: {"city": c, "lat": lat, "lon": lon} for s, (c, lat, lon) in STORE_CITIES.items()},
        "distances": sorted(rows, key=lambda r: (r["store_a"], r["miles"])),
        "source_note": (
            "M5 discloses only a state label per store (no city/address/GPS), so each "
            "store is mapped to a real, distinct major city in its state as a disclosed "
            "stand-in; distances are the real haversine great-circle distance between "
            "those real coordinates."
        ),
    }
    with open(PROC / "store_distances.json", "w") as f:
        json.dump(payload, f, indent=2)
    print(f"Wrote store_distances.json - {len(rows)} directed pairs")


def main():
    write_distance_reference()

    alloc = pd.read_parquet(PROC / "transfer_allocations.parquet")
    print(f"Transfer allocations before cost check: {len(alloc)}")

    alloc["distance_miles"] = [
        round(distance_between(o, d), 1) for o, d in zip(alloc["origin_store"], alloc["destination_store"])
    ]
    # Would THIS allocation alone have justified a dedicated truck?
    alloc["solo_shipment_cost"] = (alloc["distance_miles"] * RATE_PER_MILE).round(2)
    alloc["solo_cost_effective"] = alloc["solo_shipment_cost"] <= COST_EFFECTIVE_THRESHOLD * alloc["value_transferred"]

    lanes = (
        alloc.groupby(["origin_store", "destination_store"])
        .agg(batch_value=("value_transferred", "sum"),
             batch_item_count=("item_id", "count"),
             distance_miles=("distance_miles", "first"))
        .reset_index()
    )
    lanes["shipment_cost"] = (lanes["distance_miles"] * RATE_PER_MILE).round(2)
    lanes["cost_effective"] = lanes["shipment_cost"] <= COST_EFFECTIVE_THRESHOLD * lanes["batch_value"]

    alloc = alloc.merge(
        lanes[["origin_store", "destination_store", "batch_value", "batch_item_count", "shipment_cost", "cost_effective"]],
        on=["origin_store", "destination_store"], how="left",
    )

    kept = alloc[alloc["cost_effective"]].copy()
    dropped = alloc[~alloc["cost_effective"]].copy()
    kept.to_parquet(PROC / "transfer_allocations.parquet", index=False)

    # --- Rewrite risk_scores.parquet's action text using only the KEPT allocations ---
    risk = pd.read_parquet(PROC / "risk_scores.parquet")
    kept_by_item = {k: v for k, v in kept.groupby(["origin_store", "item_id"])} if len(kept) else {}
    had_any_alloc = set(zip(alloc["origin_store"], alloc["item_id"]))
    had_dropped = set(zip(dropped["origin_store"], dropped["item_id"])) if len(dropped) else set()

    def resolve_final(row):
        if row["risk_score"] != "Critical":
            return row["action"]
        key = (row["store"], row["item_id"])
        placed_here = kept_by_item.get(key)
        if placed_here is None or placed_here.empty:
            if key in had_dropped:
                return "Donate (transfer route not cost-effective for this item)"
            return "Donate (no same-state store running low enough on this item)"
        parts = ", ".join(
            f"{d} ({q:.0f}u, {m:.0f} mi)"
            for d, q, m in zip(placed_here["destination_store"], placed_here["qty_transferred"], placed_here["distance_miles"])
        )
        placed_qty = placed_here["qty_transferred"].sum()
        leftover = max(0.0, row["current_stock"] - placed_qty)
        msg = f"Transfer to {parts}"
        if leftover > 0.5:
            reason = "route not cost-effective" if key in had_dropped else "no more same-state room"
            msg += f"; donate remaining {leftover:.0f} units ({reason})"
        return msg

    risk["action"] = risk.apply(resolve_final, axis=1)
    risk.to_parquet(PROC / "risk_scores.parquet", index=False)

    print(f"Cost-effective allocations kept: {len(kept)} / {len(alloc)}")
    print(f"Allocations downgraded to donate (route not cost-effective): {len(dropped)}")
    print(f"Would've justified a SOLO shipment: {int(alloc['solo_cost_effective'].sum())} / {len(alloc)}")
    print(f"\n--- Lanes ({lanes['distance_miles'].min():.0f}-{lanes['distance_miles'].max():.0f} mi range) ---")
    print(lanes.sort_values("batch_value", ascending=False).to_string(index=False))


if __name__ == "__main__":
    main()
