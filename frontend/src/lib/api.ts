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
  // Store-operations metadata: category comes from the real M5 dept_id
  // column; vendor/batch_lot/shelf_location are disclosed synthetic
  // enrichment (see backend scripts/07_enrich_item_catalog_metadata.py).
  category?: string | null;
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
