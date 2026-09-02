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

Second fix, per user feedback: the matching above originally searched for
the thinnest store ACROSS ALL 10 STORES NATIONWIDE, which routinely paired
a California store with a Wisconsin one 1,700+ miles away. That's not just
an expensive shipment - for perishable, close-to-expiry stock specifically,
it can be physically pointless: a multi-day cross-country haul can burn
through a meaningful share of an item's shelf life before it ever reaches
the shelf it was transferred to. So the search is scoped to same-state
candidates only (state recovered from the store ID prefix).

Third fix (this version), also per user feedback: the matching above sent
the origin's ENTIRE current_stock to whichever store was thinnest, without
ever checking whether that destination could actually sell through that
much. Checked against this exact data: doing that would leave 88.9% of
destinations holding MORE than a full shelf-life's worth of stock (order
factor > 1.0) after receiving a transfer, and 67% meaningfully overstocked
(> 1.5) - i.e. it would routinely just relocate the waste problem instead
of solving it. Fixed by capping each destination's share at how much would
bring IT UP TO (not past) a normal stock position - order factor 1.0, the
same "ordered exactly enough" baseline the synthetic stock-factor model
itself is centered on (see 06_discount_optimizer.py's seeded_stock_factor,
drawn from 0.6-1.5). If the thinnest candidate can't take all of an
origin's surplus, the remainder is offered to the next-thinnest same-state
candidate, and so on, until either the surplus is fully placed or every
eligible same-state store is filled to capacity - at which point whatever
is left over is donated (there's genuinely nowhere left to send it).
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
STOCK_FILL_TARGET = 1.0  # a destination is only ever topped up to this order factor, never past it - see docstring


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


def allocate_transfers_for_group(group: pd.DataFrame) -> list[dict]:
    """
    One (item_id, state) group - 2-4 stores. Returns a list of allocations
    {origin_store, item_id, product_name, barcode, full_price,
     destination_store, qty_transferred, value_transferred}, splitting each
    Critical origin's surplus across as many same-state, genuinely-thin
    destinations as it takes to place it (each capped at STOCK_FILL_TARGET),
    most-overstocked origin served first, thinnest destination filled first.
    """
    origins = group[group["risk_score"] == "Critical"].sort_values("order_factor", ascending=False)
    if origins.empty:
        return []
    origin_stores = set(origins["store"])

    factor_by_store = dict(zip(group["store"], group["order_factor"]))
    capacity = {}
    for _, row in group.iterrows():
        if row["store"] in origin_stores or row["order_factor"] >= TRANSFER_FACTOR_THRESHOLD:
            continue
        cap = max(0.0, STOCK_FILL_TARGET * row["baseline_daily_demand"] * row["shelf_life_days"] - row["current_stock"])
        if cap > 1e-9:
            capacity[row["store"]] = cap

    allocations = []
    for _, orow in origins.iterrows():
        remaining = orow["current_stock"]
        if remaining <= 0:
            continue
        eligible = sorted(
            (s for s in capacity if capacity[s] > 1e-9 and (orow["order_factor"] - factor_by_store[s]) >= MIN_FACTOR_GAP),
            key=lambda s: factor_by_store[s],
        )
        for dest in eligible:
            if remaining <= 0:
                break
            take = min(remaining, capacity[dest])
            if take <= 1e-9:
                continue
            allocations.append({
                "origin_store": orow["store"], "item_id": orow["item_id"],
                "product_name": orow["product_name"], "barcode": orow["barcode"],
                "full_price": orow["full_price"],
                "destination_store": dest,
                "qty_transferred": round(float(take), 2),
                "value_transferred": round(float(take) * orow["full_price"], 2),
            })
            capacity[dest] -= take
            remaining -= take
    return allocations


def main():
    df = pd.read_parquet(PROC / "discount_recommendations.parquet")
    df["days_of_cover"] = df["current_stock"] / df["baseline_daily_demand"]
    df["state"] = df["store"].str.split("_").str[0]

    df["risk_score"] = [
        score_row(p, r) for p, r in zip(df["do_nothing_sellthrough_pct"], df["reachable_target"])
    ]
    df["action"] = [
        action_for(r, d) for r, d in zip(df["risk_score"], df["waste_min_discount_pct"])
    ]

    # --- Transfer-vs-donate resolution for Critical items ---
    df["order_factor"] = df["current_stock"] / (df["baseline_daily_demand"] * df["shelf_life_days"])

    all_allocations: list[dict] = []
    for _, group in df.groupby(["item_id", "state"]):
        all_allocations.extend(allocate_transfers_for_group(group))
    allocations = pd.DataFrame(all_allocations, columns=[
        "origin_store", "item_id", "product_name", "barcode", "full_price",
        "destination_store", "qty_transferred", "value_transferred",
    ])
    allocations.to_parquet(PROC / "transfer_allocations.parquet", index=False)

    if len(allocations):
        placed = allocations.groupby(["origin_store", "item_id"])["qty_transferred"].sum()
    else:
        placed = pd.Series(dtype=float)
    df = df.merge(placed.rename("placed_qty"), left_on=["store", "item_id"], right_index=True, how="left")
    df["placed_qty"] = df["placed_qty"].fillna(0.0)
    df["leftover_qty"] = (df["current_stock"] - df["placed_qty"]).clip(lower=0)

    alloc_by_origin_item = {k: v for k, v in allocations.groupby(["origin_store", "item_id"])} if len(allocations) else {}

    def resolve_transfer(row):
        if row["risk_score"] != "Critical":
            return row["action"]
        allocs = alloc_by_origin_item.get((row["store"], row["item_id"]))
        if allocs is None or allocs.empty:
            return "Donate (no same-state store running low enough on this item)"
        parts = ", ".join(f"{d} ({q:.0f}u)" for d, q in zip(allocs["destination_store"], allocs["qty_transferred"]))
        msg = f"Transfer to {parts}"
        if row["leftover_qty"] > 0.5:
            msg += f"; donate remaining {row['leftover_qty']:.0f} units (no more same-state room)"
        return msg

    df["action"] = df.apply(resolve_transfer, axis=1)

    keep_cols = ["store", "item_id", "product_name", "barcode", "shelf_life_tier",
                 "shelf_life_days", "current_stock", "baseline_daily_demand", "days_of_cover",
                 "full_price", "do_nothing_sellthrough_pct", "waste_min_discount_pct",
                 "revenue_max_discount_pct", "reachable_target", "risk_score", "action"]
    out = df[keep_cols].copy()
    out.to_parquet(PROC / "risk_scores.parquet", index=False)
    print(f"Saved {len(out):,} risk-scored store-items -> risk_scores.parquet")
    print(f"Saved {len(allocations):,} transfer allocations -> transfer_allocations.parquet "
          f"(pre cost-effectiveness check - see 08_transfer_cost_model.py)\n")

    print("--- Risk tier distribution ---")
    counts = out["risk_score"].value_counts().reindex(["Low", "Medium", "High", "Critical"])
    for tier, n in counts.items():
        print(f"  {tier:>8}: {n:>6,} ({n / len(out) * 100:5.1f}%)")

    print("\n--- Critical items: how they resolved (before cost-effectiveness check) ---")
    critical = out[out["risk_score"] == "Critical"]
    fully_placed = critical["action"].str.startswith("Transfer") & ~critical["action"].str.contains("donate remaining")
    partially_placed = critical["action"].str.contains("donate remaining")
    donate_only = critical["action"].str.startswith("Donate")
    print(f"  Fully transferred:      {fully_placed.sum():,} / {len(critical):,}")
    print(f"  Partially transferred:  {partially_placed.sum():,} / {len(critical):,} (rest donated - no more same-state room)")
    print(f"  Donate only (no taker): {donate_only.sum():,} / {len(critical):,}")
    if len(allocations):
        per_item_dest_count = allocations.groupby(["origin_store", "item_id"])["destination_store"].nunique()
        print(f"  Avg destinations per transferred item: {per_item_dest_count.mean():.2f} "
              f"(max {per_item_dest_count.max()})")

    with open(PROC / "risk_scoring_examples.json", "w") as f:
        json.dump({}, f)


if __name__ == "__main__":
    main()
