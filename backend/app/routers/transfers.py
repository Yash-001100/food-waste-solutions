"""
Store-to-store stock transfers: an internal, "EDI-style" execution of a real
transfer_allocations candidate the model already computed (scripts/07 + 08),
not a free-form "move N units of anything anywhere" feature. See
schemas.py's docstring above ShipTransferRequest and app/inventory.py's
module docstring for how this ledger feeds current_stock/risk everywhere
else in the app.

Deliberately two real steps, not one click - mirroring the real ASN vs.
dock-scan gap discussed for how a retailer actually receives stock:

  ship    - the origin store marks a real recommended lane as physically
            sent. Stock leaves the origin immediately (inventory.py already
            reflects this the moment the row exists, any non-cancelled
            status). qty is NEVER taken from the request - it's looked up
            server-side from the real transfer_allocations row, so a client
            can't ship a number that was never actually recommended.
  confirm - the destination store marks it as physically checked in. Only
            then does the destination's stock reflect it. A transfer that's
            been shipped but not yet confirmed is money/stock in limbo on
            paper - exactly like a real in-transit shipment.

Scope, disclosed: this only executes lanes the model's own transfer_allocations
already identified for THIS specific (origin, item, destination) triple - see
ship_transfer's 404. There's no way to pick an arbitrary item/store/quantity
from this API, by design (see the project's honesty principle: every number
here is real, not typed in by a person).
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from database import get_connection
from routers.auth import get_current_user
from schemas import ConfirmTransferRequest, CurrentUser, ShipTransferRequest, StockTransfer

router = APIRouter(prefix="/transfers", tags=["transfers"])

_TRANSFER_ROW_SQL = """
    SELECT st.id, st.item_id, r.product_name, r.barcode, r.full_price,
           st.origin_store, st.destination_store, st.qty, st.status,
           st.shipped_by, st.shipped_at, st.received_by, st.received_at,
           st.qty_confirmed, a.distance_miles, a.shipment_cost
    FROM stock_transfers st
    LEFT JOIN risk_scores r ON r.store = st.origin_store AND r.item_id = st.item_id
    LEFT JOIN transfer_allocations a
        ON a.origin_store = st.origin_store AND a.destination_store = st.destination_store
        AND a.item_id = st.item_id
"""


def _to_stock_transfer(row) -> StockTransfer:
    (id_, item_id, product_name, barcode, full_price, origin_store, destination_store, qty, status,
     shipped_by, shipped_at, received_by, received_at, qty_confirmed, distance_miles, shipment_cost) = row
    # item_value is recomputed from this transfer's own shipped qty x the
    # item's real full_price, rather than trusted from transfer_allocations
    # directly - that keeps it correct even once a later pipeline run
    # retires the exact lane this transfer came from (distance_miles/
    # shipment_cost have no such substitute, so those stay None in that case).
    item_value = round(qty * full_price, 2) if full_price is not None else None
    return StockTransfer(
        id=id_, item_id=item_id, product_name=product_name or item_id, barcode=barcode,
        origin_store=origin_store, destination_store=destination_store, qty=qty,
        status=status, shipped_by=shipped_by, shipped_at=str(shipped_at),
        received_by=received_by, received_at=str(received_at) if received_at else None,
        qty_confirmed=qty_confirmed,
        full_price=full_price, item_value=item_value,
        distance_miles=round(distance_miles, 1) if distance_miles is not None else None,
        shipment_cost=shipment_cost,
    )


def _get_transfer(con, transfer_id: int) -> StockTransfer:
    row = con.execute(f"{_TRANSFER_ROW_SQL} WHERE st.id = ?", [transfer_id]).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"No transfer with id {transfer_id}")
    return _to_stock_transfer(row)


@router.post("/ship", response_model=StockTransfer)
def ship_transfer(body: ShipTransferRequest, current_user: CurrentUser = Depends(get_current_user)):
    origin_store = current_user.store
    destination_store = body.destination_store.upper()
    con = get_connection()

    allocation = con.execute("""
        SELECT qty_transferred FROM transfer_allocations
        WHERE origin_store = ? AND item_id = ? AND destination_store = ?
    """, [origin_store, body.item_id, destination_store]).fetchone()
    if allocation is None:
        raise HTTPException(
            status_code=404,
            detail=f"The model hasn't recommended transferring '{body.item_id}' from {origin_store} "
                   f"to {destination_store} - nothing to ship",
        )

    existing = con.execute("""
        SELECT id FROM stock_transfers
        WHERE origin_store = ? AND item_id = ? AND destination_store = ? AND status != 'cancelled'
    """, [origin_store, body.item_id, destination_store]).fetchone()
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"This lane has already been shipped (transfer #{existing[0]})",
        )

    qty = allocation[0]  # server-side truth, never trust a client-supplied quantity
    new_id = con.execute("""
        INSERT INTO stock_transfers (item_id, origin_store, destination_store, qty, shipped_by)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id
    """, [body.item_id, origin_store, destination_store, qty, current_user.username]).fetchone()[0]

    return _get_transfer(con, new_id)


@router.post("/{transfer_id}/confirm", response_model=StockTransfer)
def confirm_transfer(
    transfer_id: int,
    body: ConfirmTransferRequest | None = None,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    The RECADV step: the destination reports what it actually checked in,
    which real EDI expects can come in short of what the DESADV (our ship)
    said was coming - damage or loss in transit is a real, disclosed
    possibility here, not swept under the rug. Omitting qty_confirmed (or
    posting no body at all) confirms the full shipped qty, so a normal,
    no-discrepancy receipt needs nothing extra from the caller.
    """
    con = get_connection()
    transfer = _get_transfer(con, transfer_id)
    if current_user.store != transfer.destination_store:
        raise HTTPException(status_code=403,
                             detail=f"Only {transfer.destination_store} can confirm receipt of this transfer")
    if transfer.status != "in_transit":
        raise HTTPException(status_code=409, detail=f"This transfer is already '{transfer.status}', not in transit")

    qty_confirmed = body.qty_confirmed if body and body.qty_confirmed is not None else transfer.qty
    if qty_confirmed < 0 or qty_confirmed > transfer.qty:
        raise HTTPException(
            status_code=400,
            detail=f"qty_confirmed must be between 0 and the shipped quantity ({transfer.qty})",
        )

    con.execute("""
        UPDATE stock_transfers
        SET status = 'received', received_by = ?, received_at = current_timestamp, qty_confirmed = ?
        WHERE id = ?
    """, [current_user.username, qty_confirmed, transfer_id])
    return _get_transfer(con, transfer_id)


@router.post("/{transfer_id}/cancel", response_model=StockTransfer)
def cancel_transfer(transfer_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Origin-only, and only before the destination has confirmed - once
    something's been checked in on the other end, the honest record is a
    completed transfer, not an erased one (same non-destructive philosophy
    as applied_actions' revert: this flips status, it never deletes a row).
    """
    con = get_connection()
    transfer = _get_transfer(con, transfer_id)
    if current_user.store != transfer.origin_store:
        raise HTTPException(status_code=403, detail=f"Only {transfer.origin_store} can cancel this transfer")
    if transfer.status != "in_transit":
        raise HTTPException(status_code=409, detail=f"This transfer is already '{transfer.status}', can't cancel it")

    con.execute("UPDATE stock_transfers SET status = 'cancelled' WHERE id = ?", [transfer_id])
    return _get_transfer(con, transfer_id)


@router.get("/incoming", response_model=list[StockTransfer])
def list_incoming(store: str, status: str | None = Query(None, description="Filter by status, e.g. 'in_transit'")):
    """
    Transfers headed TO this store - what the Receive Stock page's "incoming
    from other stores" section shows, so an associate can confirm what's
    actually arrived rather than this store's stock silently updating itself.
    Defaults to every status (so a store can also see its own receiving
    history); pass status=in_transit for just what's still pending confirmation.
    """
    store = store.upper()
    con = get_connection()
    sql = f"{_TRANSFER_ROW_SQL} WHERE st.destination_store = ?"
    params = [store]
    if status:
        sql += " AND st.status = ?"
        params.append(status)
    sql += " ORDER BY st.shipped_at DESC"
    rows = con.execute(sql, params).fetchall()
    return [_to_stock_transfer(r) for r in rows]


@router.get("/outgoing", response_model=list[StockTransfer])
def list_outgoing(store: str, status: str | None = Query(None, description="Filter by status, e.g. 'in_transit'")):
    """
    Transfers this store has shipped OUT, any status - lets the Transfers
    page show a recommended lane's real status (not shipped yet / in transit
    / received / cancelled) instead of only ever showing the recommendation.
    """
    store = store.upper()
    con = get_connection()
    sql = f"{_TRANSFER_ROW_SQL} WHERE st.origin_store = ?"
    params = [store]
    if status:
        sql += " AND st.status = ?"
        params.append(status)
    sql += " ORDER BY st.shipped_at DESC"
    rows = con.execute(sql, params).fetchall()
    return [_to_stock_transfer(r) for r in rows]


# Registered last (after the /incoming and /outgoing literal routes above) so
# it can't shadow them - FastAPI/Starlette matches routes in registration
# order, and "/transfers/{transfer_id}" would otherwise swallow a request to
# "/transfers/incoming" before that literal route ever got a chance to run.
@router.get("/{transfer_id}", response_model=StockTransfer)
def get_transfer(transfer_id: int):
    """
    One transfer's full detail, by id - backs the printable receipt page
    (frontend: /transfers/[transferId]) that either the shipping or
    receiving store can open. No auth here, same as every other GET in this
    app - viewing is public; only ship/confirm/cancel above are gated to the
    right store's login.
    """
    con = get_connection()
    return _get_transfer(con, transfer_id)
