"""
Surplus risk score + recommended action, per store-item.

Turns the optimizer's output (Task #6) into the Low/Medium/High/Critical score
and monitor -> markdown -> transfer -> donate action from the original idea.

Risk tiers are derived entirely from numbers already computed in Task #6 - no
new synthetic assumptions are introduced here:

  - do_nothing_sellthrough_pct : what fraction of current stock sells through
    with NO intervention before the shelf-life countdown runs out. This is
    the core "how much trouble is this item in" signal.
  - reachable_target           : whether ANY discount up to 50% can still hit
    the 95% sell-through target. When this is False, discounting is not a
    viable lever at all for this item - no markdown level fixes it.

  LOW      do_nothing_sellthrough_pct >= 90%             -> Monitor
  MEDIUM   70% <= do_nothing_sellthrough_pct < 90%        -> Small markdown
           (and reachable)
  HIGH     do_nothing_sellthrough_pct < 70%, reachable    -> Deep markdown
  CRITICAL not reachable_target at all                    -> Transfer or donate

For CRITICAL items, discounting can't clear the stock, so the question
becomes whether another store is genuinely running low on the same item.

First attempt (kept here as a documented dead end, not silently fixed):
"days_of_cover" = current_stock / baseline_daily_demand looked like a real
signal, but it algebraically CANCELS - since current_stock was built as
(baseline_daily_demand * shelf_life_days * factor) per store, dividing back
by that same store's baseline_daily_demand just returns (shelf_life_days *
factor). Every store carries the same item's shelf_life_days, so the ratio
carries no real cross-store demand signal at all - it's pure noise from the
synthetic ordering factor. Running it produced 0 transfer matches out of
1,481 Critical items, which is what surfaced the bug.

Fix: recover that same per-store "ordering factor" directly
(factor = current_stock / (baseline_daily_demand * shelf_life_days)) and use
IT as the signal instead of a derived day-count. Values well below 1.0 mean
a store ordered notably less than its item needs to last a full shelf life -
a genuinely thin, "running low" position. A Critical store (chronically
overstocked) paired with another store sitting well below 1.0 on the same
item is a legitimate transfer candidate; if no other store is thin, donate.
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PROC = ROOT / "data" / "processed"

LOW_THRESH = 90.0
MEDIUM_THRESH = 70.0
TRANSFER_FACTOR_THRESHOLD = 0.75  # candidate store's synthetic order factor below this = genuinely thin (range is 0.6-1.5, midpoint 1.0 = "ordered exactly enough")
MIN_FACTOR_GAP = 0.3  # candidate must be meaningfully thinner than the overstocked store itself, not just "some store out of 10"


def score_row(do_nothing_pct: float, reachable: bool) -> str:
    if not reachable:
        return "Critical"
    if do_nothing_pct >= LOW_THRESH:
        return "Low"
    if do_nothing_pct >= MEDIUM_THRESH:
        return "Medium"
    return "High"


def action_for(risk: str, waste_min_discount_pct: int) -> str:
    return {
        "Low": "Monitor",
        "Medium": f"Small markdown ({waste_min_discount_pct}% off)",
        "High": f"Deep markdown ({waste_min_discount_pct}% off)",
        "Critical": "Transfer or donate",
    }[risk]


def main():
    df = pd.read_parquet(PROC / "discount_recommendations.parquet")
    df["days_of_cover"] = df["current_stock"] / df["baseline_daily_demand"]

    df["risk_score"] = [
        score_row(p, r) for p, r in zip(df["do_nothing_sellthrough_pct"], df["reachable_target"])
    ]
    df["action"] = [
        action_for(r, d) for r, d in zip(df["risk_score"], df["waste_min_discount_pct"])
    ]

    # --- Transfer-vs-donate resolution for Critical items ---
    # Recover each store's synthetic ordering factor directly (see docstring
    # for why days-of-cover doesn't work) and use it as the "running low" signal.
    df["order_factor"] = df["current_stock"] / (df["baseline_daily_demand"] * df["shelf_life_days"])

    def thinnest_other_store(group):
        idx = group["order_factor"].idxmin()
        return pd.Series({"thinnest_store": group.loc[idx, "store"],
                           "thinnest_factor": group.loc[idx, "order_factor"]})

    thinnest = df.groupby("item_id").apply(thinnest_other_store, include_groups=False)
    df = df.merge(thinnest, on="item_id", how="left")

    def resolve_transfer(row):
        if row["risk_score"] != "Critical":
            return row["action"]
        candidate_is_self = row["thinnest_store"] == row["store"]
        candidate_running_low = row["thinnest_factor"] < TRANSFER_FACTOR_THRESHOLD
        # Require a real gap between this (overstocked) store's own factor and
        # the candidate's, not just "some store out of 10 happened to be low" -
        # with 10 random draws per item, an absolute threshold alone is nearly
        # always satisfied by chance and doesn't mean much on its own.
        meaningful_gap = (row["order_factor"] - row["thinnest_factor"]) >= MIN_FACTOR_GAP
        if not candidate_is_self and candidate_running_low and meaningful_gap:
            return f"Transfer to {row['thinnest_store']} (running low, order factor {row['thinnest_factor']:.2f} vs {row['order_factor']:.2f} here)"
        return "Donate (no store running low enough on this item)"

    df["action"] = df.apply(resolve_transfer, axis=1)

    keep_cols = ["store", "item_id", "product_name", "barcode", "shelf_life_tier",
                 "shelf_life_days", "current_stock", "baseline_daily_demand", "days_of_cover",
                 "full_price", "do_nothing_sellthrough_pct", "waste_min_discount_pct",
                 "revenue_max_discount_pct", "reachable_target", "risk_score", "action"]
    out = df[keep_cols].copy()
    out.to_parquet(PROC / "risk_scores.parquet", index=False)
    print(f"Saved {len(out):,} risk-scored store-items -> risk_scores.parquet\n")

    print("--- Risk tier distribution ---")
    counts = out["risk_score"].value_counts().reindex(["Low", "Medium", "High", "Critical"])
    for tier, n in counts.items():
        print(f"  {tier:>8}: {n:>6,} ({n / len(out) * 100:5.1f}%)")

    print("\n--- Critical items: transfer vs donate ---")
    critical = out[out["risk_score"] == "Critical"]
    transferable = critical["action"].str.startswith("Transfer").sum()
    donate = critical["action"].str.startswith("Donate").sum()
    print(f"  Transfer candidates: {transferable:,} / {len(critical):,} ({transferable / len(critical) * 100:.1f}%)")
    print(f"  Donate (no taker):   {donate:,} / {len(critical):,} ({donate / len(critical) * 100:.1f}%)")

    # Example rows for the case study
    examples = {}
    for store, item_id in [("CA_2", "FOODS_3_329"), ("CA_1", "FOODS_3_037")]:
        match = out[(out.store == store) & (out.item_id == item_id)]
        if len(match):
            r = match.iloc[0]
            examples[f"{store}_{item_id}"] = r.to_dict()
            print(f"\n{store} / {item_id} ({r.product_name}): risk={r.risk_score}, action={r.action}")

    # A genuine transfer example, if one exists, for the dashboard
    transfer_example = critical[critical["action"].str.startswith("Transfer")].head(1)
    if len(transfer_example):
        r = transfer_example.iloc[0]
        examples[f"transfer_example_{r.store}_{r.item_id}"] = r.to_dict()
        print(f"\nTransfer example: {r.store} / {r.item_id} ({r.product_name}) -> {r.action}")

    with open(PROC / "risk_scoring_examples.json", "w") as f:
        json.dump(examples, f, indent=2, default=str)


if __name__ == "__main__":
    main()
