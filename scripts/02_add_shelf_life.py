"""
Attach a synthetic shelf-life (days-to-expiry-at-restock) to each FOODS item.

M5 has no expiry/perishability data (no public grocery dataset does, at SKU
level). This assigns a realistic, disclosed-as-synthetic shelf-life tier to
each item, seeded for reproducibility. It is intentionally NOT derived from
M5's dept_id (FOODS_1/2/3) - those departments aren't labelled by real
perishability, so pretending they were would be a false precision. Instead
this draws from a realistic overall mix of shelf-life tiers seen in a grocery
store (highly perishable through shelf-stable), independent of dept.
"""
import pandas as pd
import numpy as np
from pathlib import Path

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
OUT = Path(__file__).resolve().parents[1] / "data" / "processed"

rng = np.random.default_rng(seed=42)

sales = pd.read_csv(RAW / "sales_train_validation.csv", usecols=["item_id", "dept_id", "cat_id"])
items = sales[sales["cat_id"] == "FOODS"].drop_duplicates("item_id")[["item_id", "dept_id"]].reset_index(drop=True)

TIERS = [
    ("fresh",  3,   7,  0.15),
    ("short",  8,   21, 0.35),
    ("medium", 22,  60, 0.35),
    ("long",   61, 180, 0.15),
]
tier_names = [t[0] for t in TIERS]
tier_weights = [t[3] for t in TIERS]
tier_ranges = {t[0]: (t[1], t[2]) for t in TIERS}

items["shelf_life_tier"] = rng.choice(tier_names, size=len(items), p=tier_weights)
items["shelf_life_days"] = items["shelf_life_tier"].apply(
    lambda t: int(rng.integers(tier_ranges[t][0], tier_ranges[t][1] + 1))
)

out_path = OUT / "item_shelf_life.parquet"
items.to_parquet(out_path, index=False)
print(f"{len(items)} items -> {out_path.name}")
print(items["shelf_life_tier"].value_counts())
print(items.groupby("shelf_life_tier")["shelf_life_days"].agg(["min", "max", "mean"]).round(1))
