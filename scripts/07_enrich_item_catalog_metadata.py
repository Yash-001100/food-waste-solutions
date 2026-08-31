"""
Add store-operations metadata to item_catalog.parquet: category, vendor,
batch lot, and shelf location.

Why this exists: the frontend's item detail page wants a few "real store"
fields the M5-derived pipeline never produced (M5 only gives us dept_id,
shelf_life, product_name, and a barcode we generated). Rather than leaving
those fields blank or fabricating a fake precision claim, this script is a
single, disclosed, idempotent enrichment step that:

  - derives `category` directly from the existing `dept_id` column (FOODS_1/
    2/3 -> "Foods 1/2/3") - this is real data, just relabeled for display,
    NOT an invented taxonomy. The M5 dataset doesn't publish what FOODS_1/2/3
    actually mean, so we don't pretend to know either (no "Dairy", "Bakery",
    etc. - that would be fabricated precision).
  - deterministically generates `vendor`, `batch_lot`, and `shelf_location`
    per item_id, seeded from the item_id itself so re-running this script is
    idempotent (same item always gets the same fake vendor/lot/aisle) rather
    than re-randomizing on every run.

These three are clearly-synthetic operational flavor for portfolio-demo
realism - the README/case study should say so plainly if asked, the same
way seed_users.py discloses its demo login scheme.
"""
import hashlib
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data" / "processed" / "item_catalog.parquet"

VENDORS = [
    "Golden Valley Foods",
    "Riverside Farms Co.",
    "Sunrise Distributors",
    "Heritage Grocers Supply",
    "Blue Ridge Provisions",
    "Pacific Coast Wholesale",
    "Meadowbrook Creamery",
    "Ironwood Bakers Collective",
]

# Cooler/freezer for perishable tiers, dry-goods aisle numbering for the rest -
# the one place this leans on real data (shelf_life_tier) rather than a coin flip.
AISLE_BY_DEPT = {"FOODS_1": (1, 3), "FOODS_2": (4, 6), "FOODS_3": (7, 9)}


def _stable_int(item_id: str, salt: str, mod: int) -> int:
    """Deterministic pseudo-random int in [0, mod) from item_id, so re-runs are idempotent."""
    h = hashlib.sha256(f"{salt}:{item_id}".encode()).hexdigest()
    return int(h[:8], 16) % mod


def enrich(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["category"] = df["dept_id"].str.replace("FOODS_", "Foods ", regex=False)

    df["vendor"] = df["item_id"].apply(lambda i: VENDORS[_stable_int(i, "vendor", len(VENDORS))])

    df["batch_lot"] = df["item_id"].apply(
        lambda i: f"B-{_stable_int(i, 'lot', 900) + 100}-{chr(65 + _stable_int(i, 'lot_suffix', 6))}"
    )

    def _shelf_location(row):
        lo, hi = AISLE_BY_DEPT[row["dept_id"]]
        aisle = lo + _stable_int(row["item_id"], "aisle", hi - lo + 1)
        section = "Cooler" if row["shelf_life_tier"] in ("fresh", "short") else "Dry Aisle"
        bay = _stable_int(row["item_id"], "bay", 12) + 1
        return f"Aisle {aisle}, {section} Bay {bay}"

    df["shelf_location"] = df.apply(_shelf_location, axis=1)
    return df


def main():
    df = pd.read_parquet(CATALOG_PATH)
    before_cols = set(df.columns)
    df = enrich(df)
    new_cols = set(df.columns) - before_cols
    df.to_parquet(CATALOG_PATH, index=False)
    print(f"Enriched {CATALOG_PATH} with columns: {sorted(new_cols)}")
    print(df[["item_id", "category", "vendor", "batch_lot", "shelf_location"]].head(5).to_string())


if __name__ == "__main__":
    main()
