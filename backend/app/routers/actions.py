from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from database import get_connection
from schemas import ApplyActionRequest, AppliedAction, CurrentUser
from routers.auth import get_current_user

router = APIRouter(tags=["actions"])

VALID_ACTION_TYPES = {"markdown", "transfer", "donate", "monitor"}


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
    # Confirm the item actually exists and belongs to this store before logging
    # an action against it.
    exists = con.execute(
        "SELECT 1 FROM risk_scores WHERE store = ? AND item_id = ?", [store, req.item_id]
    ).fetchone()
    if exists is None:
        raise HTTPException(status_code=404, detail=f"No item '{req.item_id}' at store '{store}'")

    row = con.execute("""
        INSERT INTO applied_actions (store, item_id, action_type, discount_pct, applied_by)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id, store, item_id, action_type, discount_pct, applied_by, applied_at, status
    """, [store, req.item_id, req.action_type, req.discount_pct, current_user.username]).fetchone()

    cols = ["id", "store", "item_id", "action_type", "discount_pct", "applied_by", "applied_at", "status"]
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
    # flagging as a simplification.
    target_store = (store or current_user.store).upper()
    rows = con.execute("""
        SELECT id, store, item_id, action_type, discount_pct, applied_by, applied_at, status
        FROM applied_actions WHERE store = ? ORDER BY applied_at DESC
    """, [target_store]).fetchall()
    cols = ["id", "store", "item_id", "action_type", "discount_pct", "applied_by", "applied_at", "status"]
    out = []
    for r in rows:
        d = dict(zip(cols, r))
        d["applied_at"] = str(d["applied_at"])
        out.append(AppliedAction(**d))
    return out
