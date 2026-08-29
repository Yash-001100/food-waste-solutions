"""
Train a global LightGBM demand-forecasting model across all FOODS store-item
series, evaluate against a naive baseline, and save the model + metrics.
"""
import json
import gc
import numpy as np
import pandas as pd
import lightgbm as lgb
from pathlib import Path
from sklearn.metrics import mean_absolute_error, mean_squared_error

PROC = Path(__file__).resolve().parents[1] / "data" / "processed"
MODEL_DIR = Path(__file__).resolve().parents[1] / "backend" / "app" / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

FEATURES = ["item_id", "dept_id", "store_id", "state_id", "wday", "month", "year",
            "snap", "lag_7", "lag_28", "roll_mean_7", "roll_mean_28",
            "sell_price", "price_ratio", "is_weekend", "has_event"]
CAT_FEATURES = ["item_id", "dept_id", "store_id", "state_id"]
TARGET = "qty"
VALID_DAYS = 28

def load_all():
    files = sorted((PROC / "features").glob("feat_*.parquet"))
    frames = [pd.read_parquet(f) for f in files]
    df = pd.concat(frames, ignore_index=True)
    del frames
    gc.collect()
    for c in CAT_FEATURES:
        df[c] = df[c].astype("category")
    return df

def main():
    print("Loading features...")
    df = load_all()
    print(f"  {len(df):,} rows")

    cutoff = df["date"].max() - pd.Timedelta(days=VALID_DAYS)
    train = df[df["date"] <= cutoff]
    valid = df[df["date"] > cutoff]
    print(f"  train: {len(train):,} rows | valid: {len(valid):,} rows (last {VALID_DAYS} days)")

    train_set = lgb.Dataset(train[FEATURES], label=train[TARGET], categorical_feature=CAT_FEATURES, free_raw_data=False)
    valid_set = lgb.Dataset(valid[FEATURES], label=valid[TARGET], categorical_feature=CAT_FEATURES, reference=train_set, free_raw_data=False)

    params = {
        "objective": "tweedie",
        "tweedie_variance_power": 1.1,
        "metric": "rmse",
        "learning_rate": 0.05,
        "num_leaves": 128,
        "min_data_in_leaf": 100,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "verbose": -1,
        "num_threads": 2,
    }

    print("Training...")
    model = lgb.train(
        params, train_set, num_boost_round=500,
        valid_sets=[valid_set], valid_names=["valid"],
        callbacks=[lgb.early_stopping(30), lgb.log_evaluation(50)],
    )

    preds = model.predict(valid[FEATURES], num_iteration=model.best_iteration)
    preds = np.clip(preds, 0, None)
    y_true = valid[TARGET].values

    mae = mean_absolute_error(y_true, preds)
    rmse = mean_squared_error(y_true, preds) ** 0.5

    # naive baseline: predict = same as 7 days ago
    naive_preds = valid["lag_7"].fillna(0).values
    naive_mae = mean_absolute_error(y_true, naive_preds)
    naive_rmse = mean_squared_error(y_true, naive_preds) ** 0.5

    metrics = {
        "model_mae": round(float(mae), 4),
        "model_rmse": round(float(rmse), 4),
        "naive_lag7_mae": round(float(naive_mae), 4),
        "naive_lag7_rmse": round(float(naive_rmse), 4),
        "mae_improvement_pct": round(100 * (naive_mae - mae) / naive_mae, 1),
        "rmse_improvement_pct": round(100 * (naive_rmse - rmse) / naive_rmse, 1),
        "best_iteration": model.best_iteration,
        "n_train_rows": len(train),
        "n_valid_rows": len(valid),
        "valid_days": VALID_DAYS,
    }
    print(json.dumps(metrics, indent=2))

    model.save_model(str(MODEL_DIR / "demand_model.txt"))
    with open(MODEL_DIR / "metrics.json", "w") as fh:
        json.dump(metrics, fh, indent=2)

    importance = pd.DataFrame({
        "feature": FEATURES,
        "gain": model.feature_importance(importance_type="gain"),
    }).sort_values("gain", ascending=False)
    importance.to_csv(MODEL_DIR / "feature_importance.csv", index=False)
    print(importance)

if __name__ == "__main__":
    main()
