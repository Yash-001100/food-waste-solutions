"""
The discount timing/amount optimizer - the heart of the original idea.

Given a store-item's baseline daily demand, that store's real (or governed
pooled-fallback) price elasticity, days remaining until expiry, and current
stock on hand, this answers two related but distinct questions:

1. REVENUE-MAXIZING discount: the discount level that maximizes projected
   revenue over the remaining shelf life, treating unsold stock as a total
   loss (0 revenue) but not modelling cost-of-goods explicitly.
2. WASTE-MINIMIZING discount: the smallest discount that clears >= a target
   sell-through fraction (default 95%) of current stock before expiry.

These two objectives can disagree - maximizing revenue sometimes means
accepting some waste rather than discounting deep enough to clear everything.
Both are reported so the disagreement itself is visible, rather than picking
one silently.

Demand response to a discount is modelled as a constant-elasticity curve:
    demand_multiplier = price_ratio ** elasticity      (price_ratio = 1 - discount)
This is the standard log-log economic model, calibrated on this store's REAL
price elasticity (see 05_price_elasticity.py) - but extrapolated beyond the
shallow discount range actually observed in the data for deep discounts, a
disclosed modelling assumption (see README).
"""
from dataclasses import dataclass, field
from typing import List

CANDIDATE_DISCOUNTS_PCT = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]

# Same thresholds as scripts/07_risk_scoring.py's score_row/action_for.
# Duplicated here rather than imported, on purpose - scripts/ is an offline
# batch tool, not part of this runtime package (this module's own
# recommend_discount mirrors, rather than imports, scripts/06's methodology
# for the same reason). Needed here so inventory.py can recompute a
# store-item's risk tier live, on the SAME formula, after a new stock
# receipt changes its stock level.
RISK_LOW_THRESH = 90.0
RISK_MEDIUM_THRESH = 70.0


def score_row(do_nothing_pct: float, reachable: bool) -> str:
    if not reachable:
        return "Critical"
    if do_nothing_pct >= RISK_LOW_THRESH:
        return "Low"
    if do_nothing_pct >= RISK_MEDIUM_THRESH:
        return "Medium"
    return "High"


def action_for(risk: str, waste_min_discount_pct: int) -> str:
    return {
        "Low": "Monitor",
        "Medium": f"Small markdown ({waste_min_discount_pct}% off)",
        "High": f"Deep markdown ({waste_min_discount_pct}% off)",
        "Critical": "Transfer or donate",
    }[risk]


def demand_multiplier(discount_pct: float, elasticity: float) -> float:
    price_ratio = 1 - discount_pct / 100
    if price_ratio <= 0:
        price_ratio = 0.01
    return price_ratio ** elasticity


def simulate_sellthrough(daily_baseline_demand: float, elasticity: float,
                          discount_pct: float, days_remaining: int, stock: float):
    """Day-by-day depletion simulation at a fixed discount level."""
    mult = demand_multiplier(discount_pct, elasticity)
    daily_demand = daily_baseline_demand * mult
    remaining = stock
    sold = 0.0
    for _ in range(max(days_remaining, 0)):
        take = min(remaining, daily_demand)
        sold += take
        remaining -= take
        if remaining <= 0:
            break
    return sold, stock - remaining, remaining


@dataclass
class OptimizationResult:
    revenue_max_discount_pct: int
    revenue_max_revenue: float
    revenue_max_sellthrough_pct: float
    waste_min_discount_pct: int
    waste_min_sellthrough_pct: float
    do_nothing_revenue: float
    do_nothing_sellthrough_pct: float
    reachable_target: bool
    candidates: List[dict] = field(default_factory=list)


def recommend_discount(daily_baseline_demand: float, elasticity: float,
                        days_remaining: int, stock: float, full_price: float,
                        target_sellthrough: float = 0.95) -> OptimizationResult:
    if stock <= 0 or days_remaining < 0:
        stock = max(stock, 0.0)

    candidates = []
    best_revenue = -1.0
    best_revenue_discount = 0
    waste_min_discount = None

    for d in CANDIDATE_DISCOUNTS_PCT:
        sold, _, _ = simulate_sellthrough(daily_baseline_demand, elasticity, d, days_remaining, stock)
        sellthrough_pct = (sold / stock * 100) if stock > 0 else 100.0
        revenue = sold * full_price * (1 - d / 100)
        candidates.append({"discount_pct": d, "units_sold": round(sold, 2),
                            "sellthrough_pct": round(sellthrough_pct, 1),
                            "revenue": round(revenue, 2)})
        if revenue > best_revenue:
            best_revenue = revenue
            best_revenue_discount = d
        if waste_min_discount is None and sellthrough_pct >= target_sellthrough * 100:
            waste_min_discount = d

    reachable = waste_min_discount is not None
    if waste_min_discount is None:
        waste_min_discount = CANDIDATE_DISCOUNTS_PCT[-1]  # deepest available; still won't fully clear

    do_nothing = next(c for c in candidates if c["discount_pct"] == 0)
    rev_max = next(c for c in candidates if c["discount_pct"] == best_revenue_discount)
    waste_min = next(c for c in candidates if c["discount_pct"] == waste_min_discount)

    return OptimizationResult(
        revenue_max_discount_pct=best_revenue_discount,
        revenue_max_revenue=rev_max["revenue"],
        revenue_max_sellthrough_pct=rev_max["sellthrough_pct"],
        waste_min_discount_pct=waste_min_discount,
        waste_min_sellthrough_pct=waste_min["sellthrough_pct"],
        do_nothing_revenue=do_nothing["revenue"],
        do_nothing_sellthrough_pct=do_nothing["sellthrough_pct"],
        reachable_target=reachable,
        candidates=candidates,
    )


def build_countdown_schedule(daily_baseline_demand: float, elasticity: float,
                              shelf_life_days: int, stock: float, full_price: float,
                              target_sellthrough: float = 0.95,
                              policy: str = "waste_min") -> List[dict]:
    """
    A DYNAMIC day-by-day simulation, not a static what-if: starts with the
    full stock on day 1, re-decides the discount fresh each day from
    whatever stock actually remains (recomputed via recommend_discount on the
    live remaining stock/days), applies that day's real demand at that
    discount, depletes stock, and moves on. This is what makes the "optimal
    moment" claim real - the discount only rises when the remaining days no
    longer support clearing the ACTUAL remaining stock at 0%, not before.

    `policy` picks which of the optimizer's two recommendations drives the
    day-to-day discount actually applied: "waste_min" (chase the sell-through
    target) or "revenue_max" (chase revenue, may accept some waste).
    """
    schedule = []
    remaining_stock = stock
    for days_left in range(shelf_life_days, -1, -1):
        result = recommend_discount(daily_baseline_demand, elasticity, days_left,
                                     remaining_stock, full_price, target_sellthrough)
        applied_discount = (result.waste_min_discount_pct if policy == "waste_min"
                             else result.revenue_max_discount_pct)
        mult = demand_multiplier(applied_discount, elasticity)
        today_demand = daily_baseline_demand * mult
        sold_today = min(remaining_stock, today_demand)
        remaining_stock -= sold_today

        schedule.append({
            "days_remaining": days_left,
            "stock_at_start_of_day": round(remaining_stock + sold_today, 1),
            "applied_discount_pct": applied_discount,
            "units_sold_today": round(sold_today, 1),
            "stock_remaining": round(remaining_stock, 1),
            "waste_min_discount_pct": result.waste_min_discount_pct,
            "revenue_max_discount_pct": result.revenue_max_discount_pct,
            "reachable_target": result.reachable_target,
        })
        if remaining_stock <= 0:
            break
    return schedule
