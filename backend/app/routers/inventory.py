"""
Receive Stock: lets a store associate log a real shipment - a CSV of
item_id + quantity received - instead of typing every item's new stock into
a form one at a time. See app/inventory.py for the append-only ledger this
writes to and how current_stock/risk fields get recomputed live from it
everywhere else in the app (risk board, item detail, store overview, map).

Scope, disclosed: this only restocks items the store ALREADY carries (its
own real risk_scores rows). A brand-new SKU this store has never sold has
no real baseline_daily_demand or elasticity to recommend anything from, so
rather than fabricate those numbers, receiving stock for an unknown item_id
is rejected with a clear reason instead of silently accepted.
"""
import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from database import get_connection
from inventory import get_stock_adjustments_by_item, recompute_for_stock_change
from routers.auth import get_current_user
from schemas import CurrentUser, ReceiveStockResponse, RejectedReceiptRow, StockReceipt, StockMovement

router = APIRouter(tags=["inventory"])

MAX_ROWS = 2000  # generous for a demo shipment manifest; guards against pasting the wrong file


@router.post("/stores/{store}/receive-stock", response_model=ReceiveStockResponse)
async def receive_stock(
    store: str,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    store = store.upper()
    if store != current_user.store:
        raise HTTPException(status_code=403,
                             detail=f"You're logged in for {current_user.store}, not {store}")
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file")

    raw_bytes = await file.read()
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Couldn't read this file as text - is it really a CSV?")

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(status_code=400, detail="The file has no header row - expected columns: item_id, qty")
    # Case/whitespace-tolerant header matching, and a couple of common
    # synonyms, since this is filled out by hand from whatever a shipment
    # manifest happens to call its columns.
    normalized = {(f or "").strip().lower(): f for f in reader.fieldnames}
    item_col = next((normalized[k] for k in ("item_id", "item", "sku") if k in normalized), None)
    qty_col = next((normalized[k] for k in ("qty", "quantity", "qty_received", "units") if k in normalized), None)
    if item_col is None or qty_col is None:
        raise HTTPException(
            status_code=400,
            detail=f"Couldn't find item_id/qty columns in the header: {reader.fieldnames}",
        )

    con = get_connection()
    valid_items = {r[0] for r in con.execute(
        "SELECT item_id FROM risk_scores WHERE store = ?", [store]
    ).fetchall()}

    accepted: list[tuple[str, float]] = []
    rejected: list[RejectedReceiptRow] = []
    for line_num, row in enumerate(reader, start=2):  # header is line 1
        if line_num - 1 > MAX_ROWS:
            rejected.append(RejectedReceiptRow(row=line_num, reason=f"Stopped after {MAX_ROWS} rows"))
            break
        item_id = (row.get(item_col) or "").strip()
        qty_raw = (row.get(qty_col) or "").strip()
        if not item_id and not qty_raw:
            continue  # a genuinely blank line - not worth reporting as an error
        if not item_id:
            rejected.append(RejectedReceiptRow(row=line_num, reason="Missing item_id"))
            continue
        if item_id not in valid_items:
            rejected.append(RejectedReceiptRow(row=line_num, item_id=item_id,
                                                reason=f"{store} doesn't carry this item"))
            continue
        try:
            qty = float(qty_raw)
        except ValueError:
            rejected.append(RejectedReceiptRow(row=line_num, item_id=item_id,
                                                reason=f"'{qty_raw}' isn't a number"))
            continue
        if qty <= 0:
            rejected.append(RejectedReceiptRow(row=line_num, item_id=item_id,
                                                reason="Quantity must be greater than 0"))
            continue
        accepted.append((item_id, qty))

    for item_id, qty in accepted:
        con.execute("""
            INSERT INTO stock_receipts (store, item_id, qty_received, received_by, source_filename)
            VALUES (?, ?, ?, ?, ?)
        """, [store, item_id, qty, current_user.username, file.filename])

    return ReceiveStockResponse(
        store=store,
        filename=file.filename,
        rows_accepted=len(accepted),
        rows_rejected=len(rejected),
        items_updated=len({item_id for item_id, _ in accepted}),
        rejected=rejected[:25],  # cap the payload; rows_rejected still reports the true total
    )


def _risk_now_for_items(con, store: str, item_ids: set[str]) -> dict[str, str]:
    """
    Live risk_score for a set of item_ids at this store, using the combined
    receipts+transfers overlay (see inventory.py) - not receipts alone, since
    an item shown in a receipts/movements history table may ALSO have been
    touched by a transfer since, and "risk now" has to mean the real current
    risk, not "risk if you only count this history table's own rows."
    """
    risk_now: dict[str, str] = {}
    if not item_ids:
        return risk_now
    placeholders = ", ".join("?" for _ in item_ids)
    base_rows = con.execute(f"""
        SELECT r.item_id, r.current_stock, r.full_price, r.shelf_life_days,
               d.baseline_daily_demand, d.elasticity_used
        FROM risk_scores r
        JOIN discount_recommendations d USING (store, item_id)
        WHERE r.store = ? AND r.item_id IN ({placeholders})
    """, [store, *item_ids]).fetchall()
    adjustments = get_stock_adjustments_by_item(con, store)
    for item_id, current_stock, full_price, shelf_life_days, baseline_daily_demand, elasticity_used in base_rows:
        adjustment = adjustments.get(item_id, 0.0)
        risk_now[item_id] = recompute_for_stock_change(
            current_stock, full_price, shelf_life_days, baseline_daily_demand, elasticity_used, adjustment,
        )["risk_score"]
    return risk_now


@router.get("/stores/{store}/receipts", response_model=list[StockReceipt])
def list_receipts(store: str, limit: int = 50):
    """
    Recent shipments logged at this store, most recent first - the receiving
    counterpart to /actions/history, so an associate can see what's already
    been recorded (and by whom) rather than uploading blind.
    """
    store = store.upper()
    con = get_connection()
    rows = con.execute("""
        SELECT sr.id, sr.store, sr.item_id, r.product_name, sr.qty_received,
               sr.received_by, sr.received_at, sr.source_filename
        FROM stock_receipts sr
        LEFT JOIN risk_scores r ON r.store = sr.store AND r.item_id = sr.item_id
        WHERE sr.store = ?
        ORDER BY sr.received_at DESC
        LIMIT ?
    """, [store, limit]).fetchall()

    risk_now = _risk_now_for_items(con, store, {r[2] for r in rows})

    out = []
    for id_, store_, item_id, product_name, qty_received, received_by, received_at, source_filename in rows:
        out.append(StockReceipt(
            id=id_, store=store_, item_id=item_id,
            product_name=product_name or item_id,
            qty_received=qty_received, received_by=received_by,
            received_at=str(received_at), source_filename=source_filename,
            risk_score_now=risk_now.get(item_id, "Low"),
        ))
    return out


@router.get("/stores/{store}/stock-movements", response_model=list[StockMovement])
def stock_movements(store: str, limit: int = 50):
    """
    A store's unified stock-movement history: every supplier receipt it has
    logged, every transfer it has shipped OUT (any status - a still-in-transit
    or even a cancelled shipment is still something that happened here), and
    every transfer it has confirmed received IN (status='received' only - a
    transfer still in transit toward this store belongs on the "incoming to
    confirm" list in routers/transfers.py, not in history yet, same as a real
    ASN isn't a receiving event until someone scans it in). Sorted newest
    first across all three sources combined, since to an associate this is
    one story of "what's moved through this store," not three separate lists.
    """
    store = store.upper()
    con = get_connection()

    receipt_rows = con.execute("""
        SELECT sr.id, sr.item_id, r.product_name, sr.qty_received, sr.source_filename,
               sr.received_by, sr.received_at
        FROM stock_receipts sr
        LEFT JOIN risk_scores r ON r.store = sr.store AND r.item_id = sr.item_id
        WHERE sr.store = ?
    """, [store]).fetchall()

    out_rows = con.execute("""
        SELECT st.id, st.item_id, r.product_name, st.qty, st.destination_store, st.status,
               st.shipped_by, st.shipped_at
        FROM stock_transfers st
        LEFT JOIN risk_scores r ON r.store = st.origin_store AND r.item_id = st.item_id
        WHERE st.origin_store = ?
    """, [store]).fetchall()

    in_rows = con.execute("""
        SELECT st.id, st.item_id, r.product_name, st.qty, st.origin_store, st.status,
               st.received_by, st.received_at
        FROM stock_transfers st
        LEFT JOIN risk_scores r ON r.store = st.destination_store AND r.item_id = st.item_id
        WHERE st.destination_store = ? AND st.status = 'received'
    """, [store]).fetchall()

    item_ids = {r[1] for r in receipt_rows} | {r[1] for r in out_rows} | {r[1] for r in in_rows}
    risk_now = _risk_now_for_items(con, store, item_ids)

    movements = []
    for id_, item_id, product_name, qty, source_filename, performed_by, performed_at in receipt_rows:
        movements.append(StockMovement(
            id=id_, kind="receipt", item_id=item_id, product_name=product_name or item_id,
            qty=qty, counterparty=source_filename, status="received",
            performed_by=performed_by, performed_at=str(performed_at),
            risk_score_now=risk_now.get(item_id, "Low"),
        ))
    for id_, item_id, product_name, qty, destination_store, status, shipped_by, shipped_at in out_rows:
        movements.append(StockMovement(
            id=id_, kind="transfer_out", item_id=item_id, product_name=product_name or item_id,
            qty=qty, counterparty=destination_store, status=status,
            performed_by=shipped_by, performed_at=str(shipped_at),
            risk_score_now=risk_now.get(item_id, "Low"),
        ))
    for id_, item_id, product_name, qty, origin_store, status, received_by, received_at in in_rows:
        movements.append(StockMovement(
            id=id_, kind="transfer_in", item_id=item_id, product_name=product_name or item_id,
            qty=qty, counterparty=origin_store, status=status,
            performed_by=received_by or "", performed_at=str(received_at),
            risk_score_now=risk_now.get(item_id, "Low"),
        ))

    movements.sort(key=lambda m: m.performed_at, reverse=True)
    return movements[:limit]
