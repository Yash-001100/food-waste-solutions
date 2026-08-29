"""
Synthetic product catalog for FOODS items: a plausible product name + a
well-formed EAN-13 barcode per item_id.

Disclosed as synthetic (see README) - M5 item_ids are anonymized specifically
so the real Walmart catalog can't be reverse-engineered, and no public
grocery dataset ships real barcodes at this granularity. Names are generic
(no real brands) to avoid implying real products. Barcodes are structurally
valid (correct EAN-13 check digit) but not registered to any real GS1 prefix.

Names are drawn from the shelf-life tier already assigned in
02_add_shelf_life.py, so a "fresh" item gets a fresh-sounding name and a
"long" item gets a shelf-stable one - the two synthetic layers stay coherent
with each other.
"""
import hashlib
import numpy as np
import pandas as pd
from pathlib import Path

PROC = Path(__file__).resolve().parents[1] / "data" / "processed"

NAME_POOL = {
    "fresh": ["Chicken Breast Fillets", "Salmon Fillets", "Mixed Salad", "Fresh Strawberries",
              "Yoghurt Tub", "Sourdough Loaf", "Fresh Pasta", "Deli Ham", "Soft Cheese", "Fresh Prawns"],
    "short": ["Full Cream Milk", "Cheddar Cheese Block", "Multigrain Bread", "Free Range Eggs",
              "Butter", "Bacon Rashers", "Beef Sausages", "Hummus", "Fresh Orange Juice", "Tortillas"],
    "medium": ["Long-Life Yoghurt", "Frozen Mixed Vegetables", "Margarine", "Pasta Sauce Jar",
               "Frozen Bread Rolls", "Cured Salami", "Cheese Wheel", "Pickled Onions", "Berry Jam", "Frozen Berries"],
    "long": ["Canned Tomatoes", "Canned Black Beans", "Dried Spaghetti", "White Rice",
             "Breakfast Cereal", "Peanut Butter", "Cooking Oil", "Canned Tuna", "Water Crackers", "Instant Noodles"],
}
DESCRIPTORS = ["Fresh", "Farm", "Value", "Premium", "Classic", "Traditional", "Family Size", "Organic"]
SIZES = ["200g", "250g", "300g", "400g", "500g", "700g", "1kg", "1L", "1.5L", "2L", "6pk", "12pk"]

def seeded_rng(item_id: str) -> np.random.Generator:
    h = int(hashlib.sha256(item_id.encode()).hexdigest(), 16) % (2**32)
    return np.random.default_rng(h)

def ean13_from_seed(rng: np.random.Generator) -> str:
    digits = [str(rng.integers(0, 10)) for _ in range(12)]
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(digits))
    check = (10 - (total % 10)) % 10
    return "".join(digits) + str(check)

def make_name(rng: np.random.Generator, tier: str) -> str:
    noun = rng.choice(NAME_POOL[tier])
    descriptor = rng.choice(DESCRIPTORS)
    size = rng.choice(SIZES)
    return f"{descriptor} {noun} {size}"

def main():
    items = pd.read_parquet(PROC / "item_shelf_life.parquet")
    names, barcodes = [], []
    for _, row in items.iterrows():
        rng = seeded_rng(row["item_id"])
        names.append(make_name(rng, row["shelf_life_tier"]))
        barcodes.append(ean13_from_seed(rng))
    items["product_name"] = names
    items["barcode"] = barcodes

    out_path = PROC / "item_catalog.parquet"
    items.to_parquet(out_path, index=False)
    print(f"{len(items)} items -> {out_path.name}")
    print(items.sample(8, random_state=1)[["item_id", "shelf_life_tier", "product_name", "barcode"]].to_string(index=False))

if __name__ == "__main__":
    main()
