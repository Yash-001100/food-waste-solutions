"""Pydantic response/request models for the API."""
from typing import List, Optional
from pydantic import BaseModel


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    store: str
    display_name: str


class CurrentUser(BaseModel):
    username: str
    store: str
    display_name: str


class StoreSummary(BaseModel):
    store: str
    total_items: int
    low: int
    medium: int
    high: int
    critical: int
    potential_revenue_at_risk: float  # sum of do_nothing revenue shortfall vs full-price sellthrough, for High+Critical items


class ItemSummary(BaseModel):
    store: str
    item_id: str
    product_name: str
    barcode: str
    shelf_life_tier: str
    shelf_life_days: int
    current_stock: float
    full_price: float
    risk_score: str
    action: str
    do_nothing_sellthrough_pct: float
    waste_min_discount_pct: int
    revenue_max_discount_pct: int
    reachable_target: bool
    # Real dept_id-derived category, included in the list endpoint too (not
    # just item detail) so a store-wide view like the risk treemap can label
    # tiles by department without a second round trip per item.
    category: Optional[str] = None
    # Set only when this item has a real logged supplier receipt and/or
    # store-to-store transfer (see inventory.py) - current_stock and every
    # stock-dependent field above already reflect it. Positive: net stock
    # added (received more than shipped out); negative: net stock shipped
    # away pending or after a transfer. Surfaced separately so the UI can
    # flag "this number includes a real event, not just the pipeline's
    # original baseline" instead of the change looking like a silent bump.
    stock_adjustment: Optional[float] = None


class ScheduleDay(BaseModel):
    days_remaining: int
    stock_at_start_of_day: float
    applied_discount_pct: int
    units_sold_today: float
    stock_remaining: float
    reachable_target: bool


class ItemDetail(ItemSummary):
    baseline_daily_demand: float
    elasticity_used: float
    schedule: List[ScheduleDay]
    # category is inherited from ItemSummary now; vendor/batch_lot/
    # shelf_location are disclosed synthetic enrichment (see
    # scripts/07_enrich_item_catalog_metadata.py) that only item detail
    # needs, since the M5-derived pipeline has no such fields itself.
    vendor: Optional[str] = None
    batch_lot: Optional[str] = None
    shelf_location: Optional[str] = None


class ApplyActionRequest(BaseModel):
    store: str
    item_id: str
    action_type: str  # "markdown" | "transfer" | "donate" | "dispose" | "monitor"
    discount_pct: Optional[int] = None


class AppliedAction(BaseModel):
    id: int
    store: str
    item_id: str
    action_type: str
    discount_pct: Optional[int]
    applied_by: str
    applied_at: str
    status: str
    # Estimated dollar impact of taking this action vs. doing nothing - see
    # actions.py's _estimate_value_saved for the (disclosed, approximate)
    # methodology per action type.
    value_saved: Optional[float] = None
    # Only set for action_type == "dispose": the real retail value written
    # off (stock_at_action x full_price, live-joined from risk_scores since
    # full_price doesn't change in this dataset). value_saved stays 0 for
    # dispose - nothing was recovered - so without this field a disposal
    # looked identical to a no-op in the UI. None for every other action
    # type and for pre-migration rows that have no stock_at_action snapshot.
    value_lost: Optional[float] = None


class ActionHistorySummary(BaseModel):
    total_value_saved: float
    actions_taken: int
    top_action_type: Optional[str] = None
    # Sum of value_lost above across this store's non-reverted dispose
    # actions - the write-off counterpart to total_value_saved.
    total_value_lost: float = 0.0


# --- Stock receipts: a real "a shipment came in" event an associate logs by
# uploading a CSV, instead of typing every item's new stock into a form by
# hand - see routers/inventory.py and inventory.py.


class RejectedReceiptRow(BaseModel):
    row: int  # 1-based line number in the uploaded file, header included
    item_id: Optional[str] = None
    reason: str


class ReceiveStockResponse(BaseModel):
    store: str
    filename: str
    rows_accepted: int
    rows_rejected: int
    items_updated: int
    rejected: List[RejectedReceiptRow]


class StockReceipt(BaseModel):
    id: int
    store: str
    item_id: str
    product_name: str
    qty_received: float
    received_by: str
    received_at: str
    source_filename: Optional[str] = None
    # What this receipt did to the item's risk tier, for a quick "so what
    # happened" read in the receipts history table - recomputed the same
    # way as everywhere else (inventory.py), not stored redundantly.
    risk_score_now: str


# --- Stock transfers: a real, store-initiated "EDI-style" move of an
# already-recommended transfer_allocations candidate between two stores,
# executed as two real steps (ship, then confirm) rather than one click -
# see routers/transfers.py.


class ShipTransferRequest(BaseModel):
    item_id: str
    destination_store: str


class ConfirmTransferRequest(BaseModel):
    """
    The destination's real goods-receipt count - the RECADV counterpart to
    the DESADV-like ship step, which can genuinely come in short (damage,
    loss in transit). Optional and defaults to the full shipped qty server-
    side (see routers/transfers.py's confirm_transfer) so confirming without
    filling this in still behaves like a normal full receipt.
    """
    qty_confirmed: Optional[float] = None


class StockTransfer(BaseModel):
    id: int
    item_id: str
    product_name: str
    barcode: Optional[str] = None
    origin_store: str
    destination_store: str
    qty: float
    status: str  # in_transit | received | cancelled
    shipped_by: str
    shipped_at: str
    received_by: Optional[str] = None
    received_at: Optional[str] = None
    # What the destination actually confirmed receiving, once confirmed -
    # can be less than qty (damage/loss in transit is real shrinkage, not
    # silently absorbed into the destination's stock). None while in_transit
    # or cancelled.
    qty_confirmed: Optional[float] = None
    # The item's real, unchanging full_price (risk_scores) and this
    # shipment's value at that price (qty x full_price) - computed here
    # from the shipped qty itself, so it stays correct even if the pipeline
    # later re-runs and this exact lane no longer appears in
    # transfer_allocations. Backs the $ line on the receipt view
    # (frontend: /transfers/[transferId]).
    full_price: Optional[float] = None
    item_value: Optional[float] = None
    # Real economics from transfer_allocations, carried along for display -
    # not recomputed here, just the same numbers the Transfers page already
    # showed before this was ever shipped. Optional because a pipeline
    # re-run can retire the exact lane this transfer came from.
    distance_miles: Optional[float] = None
    shipment_cost: Optional[float] = None


class StockMovement(BaseModel):
    """One row in a store's unified stock-movement history: a supplier
    receipt, a transfer this store sent out, or a transfer this store
    received - see routers/inventory.py's stock_movements endpoint."""
    id: int
    kind: str  # receipt | transfer_out | transfer_in
    item_id: str
    product_name: str
    qty: float
    counterparty: Optional[str] = None  # source filename (receipt) or the other store (transfer)
    status: str
    performed_by: str
    performed_at: str
    risk_score_now: str


# --- Analytics (Task #10): real M5 daily sales + discount-response data,
# plus rollups of the model's own risk/action output and the store's
# actually-applied action log. Nothing here is simulated - see
# routers/analytics.py for exactly which real files back each field.


class SalesHistoryPoint(BaseModel):
    date: str
    qty: float
    sell_price: Optional[float] = None
    discount_pct: float


class SalesHistoryResponse(BaseModel):
    store: str
    item_id: str
    product_name: str
    full_price: float
    baseline_daily_demand: float
    points: List[SalesHistoryPoint]


class DiscountBucket(BaseModel):
    bucket: str
    label: str
    price_ratio_range: str
    n_obs: int
    mean_qty_norm: Optional[float] = None


class ElasticityResponse(BaseModel):
    store: str
    elasticity_used: float
    source: str  # "store_specific" | "pooled_fallback"
    buckets: List[DiscountBucket]


class RiskActionMix(BaseModel):
    store: str
    low: int
    medium: int
    high: int
    critical: int
    monitor: int
    small_markdown: int
    deep_markdown: int
    transfer: int
    donate: int


class OutcomeSlice(BaseModel):
    label: str
    count: int
    value_saved: float
    # Real write-off value for this slice (non-zero only for "Disposed") -
    # see AppliedAction.value_lost for the methodology.
    value_lost: float = 0.0


class OutcomesResponse(BaseModel):
    store: Optional[str] = None
    total: int
    slices: List[OutcomeSlice]


class TransactionLogRow(BaseModel):
    id: int
    store: str
    item_id: str
    product_name: str
    action_type: str
    discount_pct: Optional[int] = None
    # Stock on hand at the moment this action was applied - a frozen
    # snapshot (see actions.py), not the item's live current_stock, so this
    # row keeps meaning even after current_stock later changes. Null for
    # rows applied before this column existed.
    quantity: Optional[float] = None
    full_price: Optional[float] = None
    value_saved: Optional[float] = None
    # Only set for action_type "dispose" - see AppliedAction.value_lost.
    value_lost: Optional[float] = None
    status: str
    applied_at: str
