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
from inventory import get_receipts_by_item, recompute_for_receipt
from routers.auth import get_current_user
from schemas import CurrentUser, ReceiveStockResponse, RejectedReceiptRow, StockReceipt

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

    # risk_score_now needs the same live recompute as everywhere else - one
    # small query per distinct item on this page, not per row (an item can
    # have several receipts logged over time).
    item_ids = {r[2] for r in rows}
    risk_now: dict[str, str] = {}
    if item_ids:
        placeholders = ", ".join("?" for _ in item_ids)
        base_rows = con.execute(f"""
            SELECT r.item_id, r.current_stock, r.full_price, r.shelf_life_days,
                   d.baseline_daily_demand, d.elasticity_used
            FROM risk_scores r
            JOIN discount_recommendations d USING (store, item_id)
            WHERE r.store = ? AND r.item_id IN ({placeholders})
        """, [store, *item_ids]).fetchall()
        receipts_by_item = get_receipts_by_item(con, store)  # every item_id here has >0 by construction
        for item_id, current_stock, full_price, shelf_life_days, baseline_daily_demand, elasticity_used in base_rows:
            risk_now[item_id] = recompute_for_receipt(
                current_stock, full_price, shelf_life_days, baseline_daily_demand, elasticity_used,
                receipts_by_item[item_id],
            )["risk_score"]

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
