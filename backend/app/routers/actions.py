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
    # The real write-off: disposing writes off the full retail value of the
    # stock, recovering nothing. Not persisted as its own column - full_price
    # is static in this dataset, so it's cheap to recompute the same way on
    # every read (see action_history/action_history_summary/outcomes) rather
    # than adding a migration for it.
    value_lost = round(stock * full_price, 2) if req.action_type == "dispose" else None

    row = con.execute("""
        INSERT INTO applied_actions (store, item_id, action_type, discount_pct, applied_by, value_saved, stock_at_action)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id, store, item_id, action_type, discount_pct, applied_by, applied_at, status, value_saved
    """, [store, req.item_id, req.action_type, req.discount_pct, current_user.username, value_saved, stock]).fetchone()

    cols = ["id", "store", "item_id", "action_type", "discount_pct", "applied_by", "applied_at", "status", "value_saved"]
    result = dict(zip(cols, row))
    result["applied_at"] = str(result["applied_at"])
    result["value_lost"] = value_lost
    return AppliedAction(**result)


@router.post("/actions/{action_id}/revert", response_model=AppliedAction)
def revert_action(action_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Undo a mistaken action - "I disposed the wrong item" is the case this
    exists for. Actions are never actually wired to inventory (applying one
    only inserts an audit row; it doesn't touch risk_scores.current_stock),
    so there's no real-world state to roll back - reverting just flips the
    row's status to 'reverted' rather than deleting it, so the mistake and
    its correction both stay visible in the history instead of disappearing.
    Reverted rows are excluded from the history summary's totals (they
    didn't happen, financially), but the row itself is permanent - this is
    an audit log, not a shopping cart.
    """
    con = get_connection()
    row = con.execute(
        "SELECT store, status FROM applied_actions WHERE id = ?", [action_id]
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"No action with id {action_id}")
    store, status = row
    if store != current_user.store:
        raise HTTPException(status_code=403,
                             detail=f"You're logged in for {current_user.store}, not {store}")
    if status == "reverted":
        raise HTTPException(status_code=409, detail="This action was already reverted")

    updated = con.execute("""
        UPDATE applied_actions SET status = 'reverted' WHERE id = ?
        RETURNING id, store, item_id, action_type, discount_pct, applied_by, applied_at, status, value_saved
    """, [action_id]).fetchone()
    cols = ["id", "store", "item_id", "action_type", "discount_pct", "applied_by", "applied_at", "status", "value_saved"]
    result = dict(zip(cols, updated))
    result["applied_at"] = str(result["applied_at"])
    # Reverted actions drop out of every total, "lost" included - see the
    # revert docstring above.
    result["value_lost"] = None
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
        SELECT aa.id, aa.store, aa.item_id, aa.action_type, aa.discount_pct, aa.applied_by,
               aa.applied_at, aa.status, aa.value_saved,
               CASE WHEN aa.action_type = 'dispose' THEN round(aa.stock_at_action * rs.full_price, 2) END AS value_lost
        FROM applied_actions aa
        LEFT JOIN risk_scores rs ON rs.store = aa.store AND rs.item_id = aa.item_id
        WHERE aa.store = ? ORDER BY aa.applied_at DESC
    """, [target_store]).fetchall()
    cols = ["id", "store", "item_id", "action_type", "discount_pct", "applied_by", "applied_at", "status",
            "value_saved", "value_lost"]
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
    """
    Rollup stats for the action-history page: total value saved, count, and
    the most common action type. Reverted actions are excluded from all
    three - they were undone, so they shouldn't count toward "value saved"
    or "actions taken" even though the row itself stays in the log below.
    """
    con = get_connection()
    target_store = (store or current_user.store).upper()
    total_row = con.execute("""
        SELECT count(*), coalesce(sum(aa.value_saved), 0.0),
               coalesce(sum(CASE WHEN aa.action_type = 'dispose' THEN aa.stock_at_action * rs.full_price ELSE 0 END), 0.0)
        FROM applied_actions aa
        LEFT JOIN risk_scores rs ON rs.store = aa.store AND rs.item_id = aa.item_id
        WHERE aa.store = ? AND aa.status != 'reverted'
    """, [target_store]).fetchone()
    top_row = con.execute("""
        SELECT action_type FROM applied_actions WHERE store = ? AND status != 'reverted'
        GROUP BY action_type ORDER BY count(*) DESC LIMIT 1
    """, [target_store]).fetchone()
    return ActionHistorySummary(
        actions_taken=total_row[0],
        total_value_saved=round(total_row[1], 2),
        total_value_lost=round(total_row[2], 2),
        top_action_type=top_row[0] if top_row else None,
    )
