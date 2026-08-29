"""
Run the discount optimizer across every FOODS store-item combination, using:
- real baseline daily demand (last available 7-day rolling average per item-store)
- real full price (last known sell_price)
- real, governed price elasticity per store (elasticity_final.json)
- synthetic shelf life (item_shelf_life.parquet) - disclosed, no real expiry data exists
- synthetic current stock on hand - ALSO disclosed synthetic: M5 has no inventory/
  stock-on-hand data at all (only sales), so "how much is currently on the shelf"
  has to be simulated. Modelled as roughly (avg daily demand x shelf life x a
  random over/under-ordering factor), seeded per store-item for reproducibility.
"""
import hashlib
import json
import sys
import numpy as np
import pandas as pd
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "app"))
from optimizer import recommend_discount, build_countdown_schedule

ROOT = Path(__file__).resolve().parents[1]
PROC = ROOT / "data" / "processed"

with open(PROC / "elasticity" / "elasticity_final.json") as f:
    ELASTICITY = json.load(f)["by_store"]

catalog = pd.read_parquet(PROC / "item_catalog.parquet")  # item_id, dept_id, tier, days, name, barcode


def seeded_stock_factor(store: str, item_id: str) -> float:
    h = int(hashlib.sha256(f"{store}_{item_id}".encode()).hexdigest(), 16) % (2**32)
    rng = np.random.default_rng(h)
    return float(rng.uniform(0.6, 1.5))


def latest_snapshot(store: str) -> pd.DataFrame:
    df = pd.read_parquet(PROC / "features" / f"feat_{store}.parquet",
                          columns=["item_id", "date", "qty", "roll_mean_7", "sell_price"])
    latest_date = df["date"].max()
    snap = df[df["date"] == latest_date].copy()
    snap["store"] = store
    return snap[["store", "item_id", "roll_mean_7", "sell_price"]]


def main():
    stores = sorted(ELASTICITY.keys())
    all_rows = []

    for store in stores:
        elasticity = ELASTICITY[store]["used_elasticity"]
        snap = latest_snapshot(store)
        snap = snap.merge(catalog, on="item_id", how="left")
        snap = snap.dropna(subset=["roll_mean_7", "sell_price", "shelf_life_days"])

        for row in snap.itertuples():
            baseline_demand = max(float(row.roll_mean_7), 0.05)  # floor: avoid zero-demand division edge cases
            factor = seeded_stock_factor(store, row.item_id)
            stock = round(baseline_demand * row.shelf_life_days * factor, 1)
            days_remaining = row.shelf_life_days  # snapshot: item just restocked, full shelf life ahead

            result = recommend_discount(baseline_demand, elasticity, days_remaining,
                                         stock, float(row.sell_price))

            all_rows.append({
                "store": store, "item_id": row.item_id, "product_name": row.product_name,
                "barcode": row.barcode, "shelf_life_tier": row.shelf_life_tier,
                "shelf_life_days": row.shelf_life_days, "baseline_daily_demand": round(baseline_demand, 2),
                "current_stock": stock, "full_price": row.sell_price, "elasticity_used": elasticity,
                "revenue_max_discount_pct": result.revenue_max_discount_pct,
                "revenue_max_revenue": result.revenue_max_revenue,
                "revenue_max_sellthrough_pct": result.revenue_max_sellthrough_pct,
                "waste_min_discount_pct": result.waste_min_discount_pct,
                "waste_min_sellthrough_pct": result.waste_min_sellthrough_pct,
                "do_nothing_revenue": result.do_nothing_revenue,
                "do_nothing_sellthrough_pct": result.do_nothing_sellthrough_pct,
                "reachable_target": result.reachable_target,
            })
        print(f"{store}: {len(snap)} items processed")

    out = pd.DataFrame(all_rows)
    out.to_parquet(PROC / "discount_recommendations.parquet", index=False)
    print(f"\nSaved {len(out):,} store-item recommendations -> discount_recommendations.parquet")

    print("\n--- Summary ---")
    print(f"Items where waste-min target is unreachable even at 50% off: "
          f"{(~out['reachable_target']).sum()} / {len(out)} "
          f"({(~out['reachable_target']).mean()*100:.1f}%)")
    print(f"Mean recommended (revenue-max) discount: {out['revenue_max_discount_pct'].mean():.1f}%")
    print(f"Revenue lift vs doing nothing: "
          f"{(out['revenue_max_revenue'].sum() / out['do_nothing_revenue'].sum() - 1) * 100:.1f}%")
    disagree = (out['revenue_max_discount_pct'] != out['waste_min_discount_pct']).mean() * 100
    print(f"Revenue-max and waste-min objectives disagree on: {disagree:.1f}% of items")

    # Two contrasting example schedules for the case study / dashboard:
    #  - FOODS_3_329 @ CA_2: chronic overstock, weak elasticity -> even 50% off can't clear it
    #  - FOODS_3_037 @ CA_1: normal case, strong elasticity -> a modest discount clearly pays off
    examples = [("CA_2", "FOODS_3_329"), ("CA_1", "FOODS_3_037")]
    all_schedules = {}
    for store, item_id in examples:
        match = out[(out.store == store) & (out.item_id == item_id)]
        if not len(match):
            continue
        r = match.iloc[0]
        schedule = build_countdown_schedule(r.baseline_daily_demand, r.elasticity_used,
                                             r.shelf_life_days, r.current_stock, r.full_price)
        all_schedules[f"{store}_{item_id}"] = {
            "store": store, "item_id": item_id, "product_name": r.product_name,
            "shelf_life_days": int(r.shelf_life_days), "current_stock": r.current_stock,
            "baseline_daily_demand": r.baseline_daily_demand, "schedule": schedule,
        }
        print(f"\nDynamic schedule ({store} / {item_id} - {r.product_name}):")
        for s in schedule:
            print(f"  {s['days_remaining']:>3}d left -> applied {s['applied_discount_pct']}%, "
                  f"sold today {s['units_sold_today']}, stock left {s['stock_remaining']}, "
                  f"reachable={s['reachable_target']}")

    with open(PROC / "example_item_schedules.json", "w") as f:
        json.dump(all_schedules, f, indent=2)


if __name__ == "__main__":
    main()
