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


class ActionHistorySummary(BaseModel):
    total_value_saved: float
    actions_taken: int
    top_action_type: Optional[str] = None
