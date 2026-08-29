"""
Build the modeling dataset for the Food Waste Solutions project.

Real data (M5 Forecasting - Accuracy, Kaggle): daily unit sales, store-level
sell prices, and the calendar (weekday/month/year/events/SNAP flags).

This script filters to the FOODS category (our grocery/perishable proxy),
reshapes the wide day-columns into a long store-item-day table, and attaches
real prices from sell_prices.csv. No synthetic data is introduced here -
that (shelf life / expiry) is added in the next script, on top of this real
sales+price history.
"""
import pandas as pd
import numpy as np
from pathlib import Path

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
OUT = Path(__file__).resolve().parents[1] / "data" / "processed"
OUT.mkdir(parents=True, exist_ok=True)

print("Loading calendar...")
calendar = pd.read_csv(RAW / "calendar.csv", parse_dates=["date"])
calendar["d"] = calendar["d"].astype(str)

print("Loading sales_train_validation (FOODS only)...")
sales = pd.read_csv(RAW / "sales_train_validation.csv")
sales = sales[sales["cat_id"] == "FOODS"].copy()
print(f"  {len(sales):,} FOODS item-store series")

id_cols = ["item_id", "dept_id", "cat_id", "store_id", "state_id"]
for c in id_cols:
    sales[c] = sales[c].astype("category")

day_cols = [c for c in sales.columns if c.startswith("d_")]
print(f"  {len(day_cols)} day columns -> melting to long format")

print("Loading sell_prices...")
prices = pd.read_csv(RAW / "sell_prices.csv")
for c in ["store_id", "item_id"]:
    prices[c] = prices[c].astype("category")

stores = sales["store_id"].cat.categories.tolist()
print(f"Processing {len(stores)} stores separately to keep memory in check...")

cal_small = calendar[["d", "date", "wm_yr_wk", "weekday", "wday", "month", "year",
                       "event_name_1", "event_type_1", "event_name_2", "event_type_2",
                       "snap_CA", "snap_TX", "snap_WI"]]

for i, store in enumerate(stores, 1):
    out_path = OUT / f"foods_long_{store}.parquet"
    if out_path.exists():
        print(f"  [{i}/{len(stores)}] {store} -> already exists, skipping")
        continue

    s = sales[sales["store_id"] == store]
    long_df = s.melt(id_vars=id_cols + ["id"], value_vars=day_cols,
                      var_name="d", value_name="qty")
    long_df["qty"] = long_df["qty"].astype("int32")

    long_df = long_df.merge(cal_small, on="d", how="left")

    p = prices[prices["store_id"] == store]
    long_df = long_df.merge(
        p[["item_id", "wm_yr_wk", "sell_price"]],
        on=["item_id", "wm_yr_wk"], how="left"
    )

    # SNAP flag for this store's state
    state = s["state_id"].iloc[0]
    long_df["snap"] = long_df[f"snap_{state}"]
    long_df = long_df.drop(columns=["snap_CA", "snap_TX", "snap_WI"])

    long_df.to_parquet(out_path, index=False)
    print(f"  [{i}/{len(stores)}] {store} -> {len(long_df):,} rows -> {out_path.name}")

print("Done.")
