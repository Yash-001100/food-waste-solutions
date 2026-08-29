import json
import numpy as np
import pandas as pd
import lightgbm as lgb
from pathlib import Path
from sklearn.metrics import r2_score

PROC = Path(__file__).resolve().parents[1] / "data" / "processed"
MODEL_DIR = Path(__file__).resolve().parents[1] / "backend" / "app" / "models"

FEATURES = ["item_id", "dept_id", "store_id", "state_id", "wday", "month", "year",
            "snap", "lag_7", "lag_28", "roll_mean_7", "roll_mean_28",
            "sell_price", "price_ratio", "is_weekend", "has_event"]
CAT_FEATURES = ["item_id", "dept_id", "store_id", "state_id"]
VALID_DAYS = 28

files = sorted((PROC / "features").glob("feat_*.parquet"))
df = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
for c in CAT_FEATURES:
    df[c] = df[c].astype("category")

cutoff = df["date"].max() - pd.Timedelta(days=VALID_DAYS)
valid = df[df["date"] > cutoff]

model = lgb.Booster(model_file=str(MODEL_DIR / "demand_model.txt"))
preds = np.clip(model.predict(valid[FEATURES]), 0, None)
y_true = valid["qty"].values

r2 = r2_score(y_true, preds)

# MAPE only makes sense where actual > 0 (avoid divide-by-zero on days with 0 sales)
nonzero = y_true > 0
mape = float(np.mean(np.abs((y_true[nonzero] - preds[nonzero]) / y_true[nonzero])) * 100)

# WMAPE (weighted MAPE) - standard for intermittent retail demand, handles zeros fine
wmape = float(np.sum(np.abs(y_true - preds)) / np.sum(y_true) * 100)

naive = valid["lag_7"].fillna(0).values
naive_r2 = r2_score(y_true, naive)
naive_wmape = float(np.sum(np.abs(y_true - naive)) / np.sum(y_true) * 100)

extra = {
    "r2": round(float(r2), 4),
    "naive_r2": round(float(naive_r2), 4),
    "mape_pct_nonzero_days": round(mape, 1),
    "wmape_pct": round(wmape, 1),
    "naive_wmape_pct": round(naive_wmape, 1),
    "pct_of_days_with_zero_sales": round(float((~nonzero).mean() * 100), 1),
}
print(json.dumps(extra, indent=2))

with open(MODEL_DIR / "metrics.json") as fh:
    metrics = json.load(fh)
metrics.update(extra)
with open(MODEL_DIR / "metrics.json", "w") as fh:
    json.dump(metrics, fh, indent=2)
