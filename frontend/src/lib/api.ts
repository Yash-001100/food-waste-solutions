/**
 * Thin typed client for the FastAPI backend (Task #8). Uses the API base URL
 * from NEXT_PUBLIC_API_URL, defaulting to the local dev server.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type RiskTier = "Low" | "Medium" | "High" | "Critical";

export interface StoreSummary {
  store: string;
  total_items: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
  potential_revenue_at_risk: number;
}

export interface ItemSummary {
  store: string;
  item_id: string;
  product_name: string;
  barcode: string;
  shelf_life_tier: string;
  shelf_life_days: number;
  current_stock: number;
  full_price: number;
  risk_score: RiskTier;
  action: string;
  do_nothing_sellthrough_pct: number;
  waste_min_discount_pct: number;
  revenue_max_discount_pct: number;
  reachable_target: boolean;
  category?: string | null;
}

export interface ScheduleDay {
  days_remaining: number;
  stock_at_start_of_day: number;
  applied_discount_pct: number;
  units_sold_today: number;
  stock_remaining: number;
  reachable_target: boolean;
}

export interface ItemDetail extends ItemSummary {
  baseline_daily_demand: number;
  elasticity_used: number;
  schedule: ScheduleDay[];
  // category is inherited from ItemSummary; vendor/batch_lot/shelf_location
  // are disclosed synthetic enrichment that only item detail needs (see
  // backend scripts/07_enrich_item_catalog_metadata.py).
  vendor?: string | null;
  batch_lot?: string | null;
  shelf_location?: string | null;
}

export interface TransferCandidate {
  item_id: string;
  product_name: string;
  barcode: string;
  current_stock: number;
  full_price: number;
  transfer_detail: string;
  transfer_to_store?: string | null;
  transfer_to_current_stock?: number | null;
  transfer_to_daily_demand?: number | null;
  // Shipment economics (Task #11) - see scripts/08_transfer_cost_model.py.
  transfer_item_value?: number | null;
  transfer_solo_cost_effective?: boolean | null;
  transfer_shipment_cost?: number | null;
  transfer_batch_value?: number | null;
  transfer_batch_item_count?: number | null;
}

export type ActionType = "markdown" | "transfer" | "donate" | "dispose" | "monitor";

export interface AppliedAction {
  id: number;
  store: string;
  item_id: string;
  action_type: string;
  discount_pct: number | null;
  applied_by: string;
  applied_at: string;
  status: string;
  value_saved?: number | null;
}

export interface ActionHistorySummary {
  total_value_saved: number;
  actions_taken: number;
  top_action_type: string | null;
}

export interface AuthedUser {
  username: string;
  store: string;
  display_name: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // no JSON body
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async login(username: string, password: string) {
    const body = new URLSearchParams({ username, password });
    return request<{ access_token: string; token_type: string; store: string; display_name: string }>(
      "/auth/login",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }
    );
  },

  async me(token: string) {
    return request<AuthedUser>("/auth/me", {}, token);
  },

  async listStores() {
    return request<StoreSummary[]>("/stores");
  },

  async getStore(store: string) {
    return request<StoreSummary>(`/stores/${store}`);
  },

  async listItems(store: string, risk?: RiskTier) {
    const qs = risk ? `?risk=${risk}` : "";
    return request<ItemSummary[]>(`/stores/${store}/items${qs}`);
  },

  async getItem(store: string, itemId: string) {
    return request<ItemDetail>(`/items/${store}/${itemId}`);
  },

  async listTransfers(store: string) {
    return request<TransferCandidate[]>(`/stores/${store}/transfers`);
  },

  async applyAction(
    token: string,
    body: { store: string; item_id: string; action_type: ActionType; discount_pct?: number }
  ) {
    return request<AppliedAction>(
      "/actions/apply",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      token
    );
  },

  async revertAction(token: string, actionId: number) {
    return request<AppliedAction>(`/actions/${actionId}/revert`, { method: "POST" }, token);
  },

  async actionHistory(token: string, store?: string) {
    const qs = store ? `?store=${store}` : "";
    return request<AppliedAction[]>(`/actions/history${qs}`, {}, token);
  },

  async actionHistorySummary(token: string, store?: string) {
    const qs = store ? `?store=${store}` : "";
    return request<ActionHistorySummary>(`/actions/history/summary${qs}`, {}, token);
  },
};

export const RISK_TIERS: RiskTier[] = ["Critical", "High", "Medium", "Low"];

export const ALL_STORES = ["CA_1", "CA_2", "CA_3", "CA_4", "TX_1", "TX_2", "TX_3", "WI_1", "WI_2", "WI_3"];

// --- Analytics (Task #10) ---

export interface SalesHistoryPoint {
  date: string;
  qty: number;
  sell_price: number | null;
  discount_pct: number;
}

export interface SalesHistoryResponse {
  store: string;
  item_id: string;
  product_name: string;
  full_price: number;
  baseline_daily_demand: number;
  points: SalesHistoryPoint[];
}

export interface DiscountBucket {
  bucket: string;
  label: string;
  price_ratio_range: string;
  n_obs: number;
  mean_qty_norm: number | null;
}

export interface ElasticityResponse {
  store: string;
  elasticity_used: number;
  source: string;
  buckets: DiscountBucket[];
}

export interface RiskActionMix {
  store: string;
  low: number;
  medium: number;
  high: number;
  critical: number;
  monitor: number;
  small_markdown: number;
  deep_markdown: number;
  transfer: number;
  donate: number;
}

export interface OutcomeSlice {
  label: string;
  count: number;
  value_saved: number;
}

export interface OutcomesResponse {
  store: string | null;
  total: number;
  slices: OutcomeSlice[];
}

export interface TransactionLogRow {
  id: number;
  store: string;
  item_id: string;
  product_name: string;
  action_type: string;
  discount_pct: number | null;
  quantity: number | null;
  full_price: number | null;
  value_saved: number | null;
  status: string;
  applied_at: string;
}

export const analyticsApi = {
  async salesHistory(store: string, itemId: string, days = 90) {
    return request<SalesHistoryResponse>(`/analytics/sales-history/${store}/${itemId}?days=${days}`);
  },
  async elasticity(store: string) {
    return request<ElasticityResponse>(`/analytics/elasticity/${store}`);
  },
  async riskActionMix() {
    return request<RiskActionMix[]>(`/analytics/risk-action-mix`);
  },
  async outcomes(token: string, store?: string) {
    const qs = store ? `?store=${store}` : "";
    return request<OutcomesResponse>(`/analytics/outcomes${qs}`, {}, token);
  },
  async transactionLog(token: string, store?: string, limit = 50) {
    const qs = new URLSearchParams({ limit: String(limit), ...(store ? { store } : {}) });
    return request<TransactionLogRow[]>(`/analytics/transaction-log?${qs}`, {}, token);
  },
};
