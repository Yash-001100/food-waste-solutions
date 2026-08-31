from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from database import get_connection
from schemas import ApplyActionRequest, AppliedAction, ActionHistorySummary, CurrentUser
from routers.auth import get_current_user
from optimizer import simulate_sellthrough

router = APIRouter(tags=["actions"])

VALID_ACTION_TYPES = {"markdown", "transfer", "donate", "dispose", "monitor"}


def _estimate_value_saved(action_type: str, discount_pct: Optional[int], stock: float,
                           full_price: float, shelf_life_days: int,
                           baseline_daily_demand: float, elasticity_used: float) -> float:
    """
    Estimated dollar impact of this action vs. doing nothing. Disclosed,
    approximate methodology per type - this is a portfolio-demo estimate, not
    an audited accounting figure:

      markdown - the optimizer's own day-by-day sell-through simulation, run
      once at 0% (do-nothing) and once at the chosen discount over the item's
      full shelf-life window (the same days_remaining approximation the
      countdown schedule uses, since there's no "received date" tracked).
      value_saved = revenue at the chosen discount minus do-nothing revenue.

      transfer - the full retail value of the stock moved (current_stock x
      full_price), i.e. treating a successful transfer as recovering the
      entire at-risk stock instead of losing it to waste.

      donate - half of full retail value, standing in for the tax-deduction /
      goodwill value of a donated write-off (not a cash sale).

      dispose / monitor - $0: no revenue is recovered by disposing of stock
      or by taking no action.
    """
    if action_type == "markdown" and discount_pct is not None:
        sold_at_discount, _, _ = simulate_sellthrough(
            baseline_daily_demand, elasticity_used, discount_pct, shelf_life_days, stock)
        sold_do_nothing, _, _ = simulate_sellthrough(
            baseline_daily_demand, elasticity_used, 0, shelf_life_days, stock)
        revenue_at_discount = sold_at_discount * full_price * (1 - discount_pct / 100)
        revenue_do_nothing = sold_do_nothing * full_price
        return round(max(revenue_at_discount - revenue_do_nothing, 0.0), 2)
    if action_type == "transfer":
        return round(stock * full_price, 2)
    if action_type == "donate":
        return round(stock * full_price * 0.5, 2)
    return 0.0


@router.post("/actions/apply", response_model=AppliedAction, status_code=201)
def apply_action(req: ApplyActionRequest, current_user: CurrentUser = Depends(get_current_user)):
    store = req.store.upper()
    if store != current_user.store:
        # A store associate can only apply actions for their own store - this
        # is the one authorization rule that actually matters here.
        raise HTTPException(status_code=403,
                             detail=f"You're logged in for {current_user.store}, not {store}")
    if req.action_type not in VALID_ACTION_TYPES:
        raise HTTPException(status_code=400, detail=f"action_type must be one of {sorted(VALID_ACTION_TYPES)}")

    con = get_connection()
    # Pull what's needed to estimate value_saved in the same query that
    # confirms the item actually exists at this store.
    item_row = con.execute("""
        SELECT r.current_stock, r.full_price, r.shelf_life_days,
               d.baseline_daily_demand, d.elasticity_used
        FROM risk_scores r
        JOIN discount_recommendations d USING (store, item_id)
        WHERE r.store = ? AND r.item_id = ?
    """, [store, req.item_id]).fetchone()
    if item_row is None:
        raise HTTPException(status_code=404, detail=f"No item '{req.item_id}' at store '{store}'")

    stock, full_price, shelf_life_days, baseline_daily_demand, elasticity_used = item_row
    value_saved = _estimate_value_saved(
        req.action_type, req.discount_pct, stock, full_price,
        shelf_life_days, baseline_daily_demand, elasticity_used,
    )

    row = con.execute("""
        INSERT INTO applied_actions (store, item_id, action_type, discount_pct, applied_by, value_saved)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id, store, item_id, action_type, discount_pct, applied_by, applied_at, status, value_saved
    """, [store, req.item_id, req.action_type, req.discount_pct, current_user.username, value_saved]).fetchone()

    cols = ["id", "store", "item_id", "action_type", "discount_pct", "applied_by", "applied_at", "status", "value_saved"]
    result = dict(zip(cols, row))
    result["applied_at"] = str(result["applied_at"])
    return AppliedAction(**result)


@router.get("/actions/history", response_model=List[AppliedAction])
def action_history(
    store: Optional[str] = Query(None, description="Filter by store"),
    current_user: CurrentUser = Depends(get_current_user),
):
    con = get_connection()
    # Any logged-in associate can see their own store's history by default;
    # explicitly requesting another store's history is allowed for the demo
    # (a real deployment would scope this to a manager role) but is worth
    # flagging as a simplification. Note this already shows every associate
    # who applied an action at the store, not just the current user - there's
    # just one demo login per store (see scripts/seed_users.py), so in
    # practice `applied_by` is always that store's single account.
    target_store = (store or current_user.store).upper()
    rows = con.execute("""
        SELECT id, store, item_id, action_type, discount_pct, applied_by, applied_at, status, value_saved
        FROM applied_actions WHERE store = ? ORDER BY applied_at DESC
    """, [target_store]).fetchall()
    cols = ["id", "store", "item_id", "action_type", "discount_pct", "applied_by", "applied_at", "status", "value_saved"]
    out = []
    for r in rows:
        d = dict(zip(cols, r))
        d["applied_at"] = str(d["applied_at"])
        out.append(AppliedAction(**d))
    return out


@router.get("/actions/history/summary", response_model=ActionHistorySummary)
def action_history_summary(
    store: Optional[str] = Query(None, description="Filter by store"),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Rollup stats for the action-history page: total value saved, count, and the most common action type."""
    con = get_connection()
    target_store = (store or current_user.store).upper()
    total_row = con.execute("""
        SELECT count(*), coalesce(sum(value_saved), 0.0)
        FROM applied_actions WHERE store = ?
    """, [target_store]).fetchone()
    top_row = con.execute("""
        SELECT action_type FROM applied_actions WHERE store = ?
        GROUP BY action_type ORDER BY count(*) DESC LIMIT 1
    """, [target_store]).fetchone()
    return ActionHistorySummary(
        actions_taken=total_row[0],
        total_value_saved=round(total_row[1], 2),
        top_action_type=top_row[0] if top_row else None,
    )
