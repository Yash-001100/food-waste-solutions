"""
Estimate price elasticity of demand from REAL price variation in the M5
data - per store, so the result can feed the "store-specific" markdown
logic from the original idea.

Two outputs, both from real data:
1. A fixed-effects (within-item) log-log elasticity coefficient per store -
   the statistically estimated "% change in demand per % change in price".
2. A discretized discount-response table per store: for items normalized
   to their own average volume, how much more (or less) they sell in each
   real discount depth bucket observed in the data.

Important, disclosed limitation: M5's price changes are real but SHALLOW -
across this data, >95% of store-item-days are at full price, and observed
discounts rarely exceed ~10-15%. That's enough to estimate a real elasticity
coefficient, but using it to predict behavior at deep clearance discounts
(30-50%, the scenario in the original idea) means extrapolating a constant-
elasticity curve beyond the range actually observed - a standard economic
modeling assumption, not something this data directly proves. This gets
flagged again wherever the coefficient is used downstream.
"""
import json
import numpy as np
import pandas as pd
import statsmodels.api as sm
from pathlib import Path

PROC = Path(__file__).resolve().parents[1] / "data" / "processed"
OUT = PROC / "elasticity"
OUT.mkdir(exist_ok=True)

BUCKETS = [(1.0, 1.01, "full_price"), (0.98, 1.0, "0-2pct_off"),
           (0.95, 0.98, "2-5pct_off"), (0.90, 0.95, "5-10pct_off"),
           (0.0, 0.90, "10pct_plus_off")]

def demean(df, cols, by):
    return df[cols] - df.groupby(by, observed=True)[cols].transform("mean")

def fit_store_elasticity(df: pd.DataFrame) -> dict:
    d = df.dropna(subset=["price_ratio", "qty"]).copy()
    d = d[d["price_ratio"] > 0]
    d["log_qty"] = np.log1p(d["qty"])
    d["log_price_ratio"] = np.log(d["price_ratio"])

    dow_dummies = pd.get_dummies(d["wday"], prefix="wday", drop_first=True).astype(float)
    month_dummies = pd.get_dummies(d["month"], prefix="month", drop_first=True).astype(float)
    controls = pd.concat([d[["log_qty", "log_price_ratio", "snap", "has_event", "item_id"]],
                           dow_dummies, month_dummies], axis=1)
    controls["snap"] = controls["snap"].astype(float)
    controls["has_event"] = controls["has_event"].astype(float)

    x_cols = ["log_price_ratio", "snap", "has_event"] + list(dow_dummies.columns) + list(month_dummies.columns)
    demeaned = demean(controls, ["log_qty"] + x_cols, "item_id")

    X = sm.add_constant(demeaned[x_cols], has_constant="add")
    y = demeaned["log_qty"]
    model = sm.OLS(y, X).fit(cov_type="HC1")

    coef = model.params["log_price_ratio"]
    se = model.bse["log_price_ratio"]
    pval = model.pvalues["log_price_ratio"]

    return {
        "elasticity": round(float(coef), 4),
        "se": round(float(se), 4),
        "p_value": round(float(pval), 6),
        "n_obs": int(len(d)),
        "n_discounted_obs": int((d["price_ratio"] < 0.98).sum()),
        "r_squared": round(float(model.rsquared), 4),
    }

def discount_response_table(df: pd.DataFrame) -> pd.DataFrame:
    d = df.dropna(subset=["price_ratio", "qty"]).copy()
    item_mean = d.groupby("item_id", observed=True)["qty"].transform("mean").replace(0, np.nan)
    d["qty_norm"] = d["qty"] / item_mean

    rows = []
    for lo, hi, label in BUCKETS:
        mask = (d["price_ratio"] >= lo) & (d["price_ratio"] < hi) if label != "full_price" else (d["price_ratio"] >= lo)
        bucket = d[mask]
        rows.append({
            "bucket": label,
            "price_ratio_range": f"[{lo:.2f}, {hi:.2f})",
            "n_obs": len(bucket),
            "mean_qty_norm": round(float(bucket["qty_norm"].mean()), 4) if len(bucket) else None,
        })
    return pd.DataFrame(rows)

def main():
    store_files = sorted(PROC.glob("features/feat_*.parquet"))
    summary = {}
    for f in store_files:
        store = f.stem.replace("feat_", "")
        print(f"Processing {store}...")
        df = pd.read_parquet(f, columns=["item_id", "qty", "price_ratio", "wday", "month", "snap", "has_event"])

        elasticity = fit_store_elasticity(df)
        table = discount_response_table(df)
        table.to_csv(OUT / f"discount_response_{store}.csv", index=False)

        summary[store] = elasticity
        print(f"  elasticity={elasticity['elasticity']} (p={elasticity['p_value']}, n_discounted={elasticity['n_discounted_obs']})")

    with open(OUT / "elasticity_by_store.json", "w") as fh:
        json.dump(summary, fh, indent=2)
    print("\nSaved elasticity_by_store.json and per-store discount_response_*.csv")

if __name__ == "__main__":
    main()
