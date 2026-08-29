"""
Feature engineering for the demand forecasting model.

Memory-conscious rewrite: processes one store at a time, writes its feature
file immediately, and frees memory before moving to the next. Uses a
365-day lookback window (plus a 35-day buffer for lag/rolling features) -
enough for weekly/monthly seasonality without blowing up memory on a
resource-constrained machine.
"""
import gc
import pandas as pd
import numpy as np
from pathlib import Path

PROC = Path(__file__).resolve().parents[1] / "data" / "processed"
LOOKBACK_DAYS = 365 + 35

KEEP_COLS = ["item_id", "dept_id", "store_id", "state_id", "date", "qty",
             "sell_price", "wday", "month", "year", "event_name_1", "snap"]

def build_store_features(store_path: Path) -> pd.DataFrame:
    df = pd.read_parquet(store_path, columns=KEEP_COLS)
    df["date"] = pd.to_datetime(df["date"])

    max_date = df["date"].max()
    cutoff = max_date - pd.Timedelta(days=LOOKBACK_DAYS)
    df = df[df["date"] >= cutoff]

    df = df.sort_values(["item_id", "date"]).reset_index(drop=True)
    df["qty"] = df["qty"].astype("float32")

    grp = df.groupby("item_id", observed=True, sort=False)["qty"]
    df["lag_7"] = grp.shift(7).astype("float32")
    df["lag_28"] = grp.shift(28).astype("float32")
    df["roll_mean_7"] = grp.transform(lambda s: s.shift(1).rolling(7).mean()).astype("float32")
    df["roll_mean_28"] = grp.transform(lambda s: s.shift(1).rolling(28).mean()).astype("float32")
    del grp
    gc.collect()

    df["sell_price"] = (
        df.groupby("item_id", observed=True, sort=False)["sell_price"]
        .transform(lambda s: s.ffill().bfill())
        .astype("float32")
    )
    roll_max_price = (
        df.groupby("item_id", observed=True, sort=False)["sell_price"]
        .transform(lambda s: s.rolling(90, min_periods=1).max())
    )
    df["price_ratio"] = (df["sell_price"] / roll_max_price).astype("float32")
    del roll_max_price
    gc.collect()

    df["is_weekend"] = df["wday"].isin([1, 2]).astype("int8")  # M5: wday 1,2 = Sat/Sun
    df["has_event"] = df["event_name_1"].notna().astype("int8")
    df = df.drop(columns=["event_name_1"])

    df = df.dropna(subset=["lag_28", "roll_mean_28"])
    for c in ["item_id", "dept_id", "store_id", "state_id"]:
        df[c] = df[c].astype("category")
    return df

def main():
    store_files = sorted(PROC.glob("foods_long_*.parquet"))
    out_dir = PROC / "features"
    out_dir.mkdir(exist_ok=True)
    for i, f in enumerate(store_files, 1):
        store = f.stem.replace("foods_long_", "")
        out_path = out_dir / f"feat_{store}.parquet"
        if out_path.exists():
            print(f"[{i}/{len(store_files)}] {store} -> exists, skipping")
            continue
        d = build_store_features(f)
        d.to_parquet(out_path, index=False)
        print(f"[{i}/{len(store_files)}] {store} -> {len(d):,} rows -> {out_path.name}")
        del d
        gc.collect()

if __name__ == "__main__":
    main()
