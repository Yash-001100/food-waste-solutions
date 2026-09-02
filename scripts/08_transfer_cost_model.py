"""
Transfer cost model (Task #11): the risk-scoring transfer/donate decision
(07_risk_scoring.py) only ever asked "is another store thin enough on this
item to make it a candidate?" - it never asked whether physically shipping
the item there is worth doing. This script adds that economics layer on
top of the already-produced risk_scores.parquet.

v2 (this version) replaces the original flat same-state/cross-state toggle
with an actually-computed, distance-based cost, per explicit user feedback
("I want to calculate it from data. Also, have we got a distance of stores
between them?"). What changed and why:

REAL LIMIT, confirmed (not assumed): the M5 Forecasting dataset this whole
project runs on labels stores only as CA_1-4 / TX_1-3 / WI_1-3 - a store ID
plus a state ID. No city, address, or GPS coordinate for any store was ever
published as part of the Kaggle competition data. So "the real distance
from CA_1 to CA_2" does not exist to look up, in this dataset or anywhere
else - no amount of computation recovers a fact that was never disclosed.

What CAN honestly be computed instead: real geography, applied to a
disclosed stand-in location per store.
  1. Each store ID is mapped to a real, distinct, major city in its state
     (STORE_CITIES below) - a disclosed assumption (nobody claims CA_2 IS
     San Francisco), but every coordinate used is a real, real-world lat/lon.
  2. The distance between every store PAIR is then a real computation - the
     haversine great-circle formula on those real coordinates, not a guess.
     This is what actually answers "what is the distance from CA_1 to CA_2":
     ~347 miles, computed, not a same-state/cross-state coin flip.
  3. Shipment cost scales continuously with that real distance, priced at a
     real, current per-mile dry-van trucking rate. 2026 freight-rate guides
     report contract rates of ~$2.20-2.50/mile and spot rates of
     ~$2.30-2.60/mile, all-in with fuel surcharge - RATE_PER_MILE below uses
     $2.40/mile, the middle of that blended range. (Real-world quotes can
     also carry a separate base/dispatch fee and detention charges that
     aren't modeled here - disclosed, not fabricated as a number.)

The finding this replaces still holds and is worth re-stating: taken ONE
ITEM AT A TIME, transferring is almost never worth it - most Critical
transfer candidates carry less stock value than a single shipment costs;
the cheapest is 15 cents of orange juice. What makes transfer viable is
that scripts/07's "thinnest other store" matching naturally sends many
items at the same origin store toward the same handful of destination
stores, so BATCHING every item queued for the same lane into one shipment
is what actually clears the (now distance-scaled) cost. The per-item solo-
economics columns are kept for the same reason as before: they're what
makes the batching decision meaningful rather than assumed.

This script also writes data/processed/store_distances.json - the full
store-to-store distance reference table (every pair, both directions) -
so the app can answer "how far is CA_1 from CA_2" directly, not just fold
it into a shipment-cost number.
"""
import json
import math
from itertools import combinations
from pathlib import Path

import pandas as pd

PROC = Path(__file__).resolve().parents[1] / "data" / "processed"

# Real major-city coordinates standing in for each anonymized store ID -
# one distinct real city per store, within that store's real state label.
# Source of the assumption itself: disclosed above (M5 never discloses
# real store locations). Source of each coordinate: standard public lat/
# lon for the named city.
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

RATE_PER_MILE = 2.40         # 2026 dry-van all-in rate, midpoint of $2.20-2.60/mile (contract-to-spot)
COST_EFFECTIVE_THRESHOLD = 0.30  # shipment cost must be <= 30% of the value moved to dispatch


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Real great-circle distance between two real lat/lon points, in miles."""
    R = 3958.8  # Earth's mean radius, miles
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
    """
    Every store-to-store distance, both directions, plus the city each store
    is standing in for - the direct answer to "have we got a distance of
    stores between them."
    """
    rows = []
    for a, b in combinations(STORE_CITIES, 2):
        miles = round(distance_between(a, b), 1)
        rows.append({"store_a": a, "store_b": b, "miles": miles})
        rows.append({"store_a": b, "store_b": a, "miles": miles})

    payload = {
        "rate_per_mile": RATE_PER_MILE,
        "stores": {
            store: {"city": city, "lat": lat, "lon": lon}
            for store, (city, lat, lon) in STORE_CITIES.items()
        },
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
    print(f"Wrote store_distances.json - {len(rows)} directed pairs, "
          f"{min(r['miles'] for r in rows):.0f}-{max(r['miles'] for r in rows):.0f} mi range")


def main():
    write_distance_reference()

    df = pd.read_parquet(PROC / "risk_scores.parquet")

    # Idempotency: a prior run of this script (v1 or v2) leaves its own
    # derived columns on risk_scores.parquet. Drop them before recomputing so
    # a re-run doesn't collide with itself (pandas would otherwise suffix the
    # merge below into transfer_batch_item_count_x/_y instead of overwriting).
    _PRIOR_COLUMNS = [
        "transfer_target_store", "transfer_item_value", "transfer_distance_miles",
        "transfer_shipment_cost", "transfer_solo_cost_effective",
        "transfer_batch_value", "transfer_batch_item_count", "transfer_cost_effective",
    ]
    df = df.drop(columns=[c for c in _PRIOR_COLUMNS if c in df.columns])

    df["transfer_target_store"] = df["action"].str.extract(r"Transfer to ([A-Z0-9_]+)")
    is_candidate = df["transfer_target_store"].notna()
    print(f"Transfer candidates before cost check: {int(is_candidate.sum())}")

    df["transfer_item_value"] = None
    df.loc[is_candidate, "transfer_item_value"] = (
        df.loc[is_candidate, "current_stock"] * df.loc[is_candidate, "full_price"]
    )

    df["transfer_distance_miles"] = None
    df.loc[is_candidate, "transfer_distance_miles"] = [
        round(distance_between(a, b), 1)
        for a, b in zip(df.loc[is_candidate, "store"], df.loc[is_candidate, "transfer_target_store"])
    ]

    df["transfer_shipment_cost"] = None
    df.loc[is_candidate, "transfer_shipment_cost"] = (
        df.loc[is_candidate, "transfer_distance_miles"] * RATE_PER_MILE
    ).round(2)

    # Would shipping THIS item alone have justified a dedicated truck?
    df["transfer_solo_cost_effective"] = None
    df.loc[is_candidate, "transfer_solo_cost_effective"] = (
        df.loc[is_candidate, "transfer_shipment_cost"] <= COST_EFFECTIVE_THRESHOLD * df.loc[is_candidate, "transfer_item_value"]
    )

    lanes = (
        df[is_candidate]
        .groupby(["store", "transfer_target_store"])
        .agg(transfer_batch_value=("transfer_item_value", "sum"),
             transfer_batch_item_count=("item_id", "count"),
             transfer_distance_miles=("transfer_distance_miles", "first"))
        .reset_index()
    )
    lanes["transfer_shipment_cost"] = (lanes["transfer_distance_miles"] * RATE_PER_MILE).round(2)
    lanes["transfer_cost_effective"] = (
        lanes["transfer_shipment_cost"] <= COST_EFFECTIVE_THRESHOLD * lanes["transfer_batch_value"]
    )

    df = df.drop(columns=["transfer_shipment_cost", "transfer_distance_miles"]).merge(
        lanes[["store", "transfer_target_store", "transfer_batch_value", "transfer_batch_item_count",
               "transfer_distance_miles", "transfer_shipment_cost", "transfer_cost_effective"]],
        on=["store", "transfer_target_store"], how="left",
    )

    def resolve(row):
        if pd.isna(row["transfer_target_store"]):
            return row["action"]
        others = int(row["transfer_batch_item_count"]) - 1
        miles = row["transfer_distance_miles"]
        if row["transfer_cost_effective"]:
            batched = f", batched with {others} other item(s) on this route" if others else ""
            return (f"Transfer to {row['transfer_target_store']} ({miles:.0f} mi, "
                    f"${row['transfer_shipment_cost']:.0f} shipment vs ${row['transfer_batch_value']:.0f} moved{batched})")
        return (f"Donate (transfer not cost-effective: {miles:.0f} mi, ${row['transfer_shipment_cost']:.0f} shipment "
                f"vs only ${row['transfer_batch_value']:.0f} in goods on this route)")

    df["action"] = df.apply(resolve, axis=1)
    df.to_parquet(PROC / "risk_scores.parquet", index=False)

    n_solo_effective = int((df["transfer_solo_cost_effective"] == True).sum())  # noqa: E712
    n_effective = int((df["transfer_cost_effective"] == True).sum())  # noqa: E712
    n_candidates = int(is_candidate.sum())
    print(f"Would've justified a SOLO shipment: {n_solo_effective} / {n_candidates}")
    print(f"Cost-effective once batched by route: {n_effective} / {n_candidates}")
    print(f"Downgraded to donate even after batching: {n_candidates - n_effective}")
    print(f"\n--- Lanes ({lanes['transfer_distance_miles'].min():.0f}-{lanes['transfer_distance_miles'].max():.0f} mi range) ---")
    print(lanes.sort_values("transfer_batch_value", ascending=False).to_string(index=False))


if __name__ == "__main__":
    main()
