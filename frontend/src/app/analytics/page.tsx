"use client";

import { useEffect, useMemo, useState } from "react";
import {
  api,
  analyticsApi,
  ALL_STORES,
  ItemSummary,
  SalesHistoryResponse,
  ElasticityResponse,
  RiskActionMix,
  OutcomesResponse,
  TransactionLogRow,
  ApiError,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { RiskBadge } from "@/components/RiskBadge";
import { BarChart, BarDatum } from "@/components/BarChart";
import { DonutChart, DonutSlice } from "@/components/DonutChart";
import { formatUSD } from "@/lib/format";

const TIER_TILE_STYLE: Record<string, string> = {
  Critical: "bg-error-container text-on-error-container",
  High: "bg-tertiary-fixed-dim text-on-tertiary-fixed",
  Medium: "bg-tertiary-fixed text-on-tertiary-fixed",
  Low: "bg-secondary-container text-on-secondary-container",
};

const ACTION_DOT: Record<string, string> = {
  Monitor: "bg-secondary",
  "Small markdown": "bg-tertiary-fixed",
  "Deep markdown": "bg-tertiary-fixed-dim",
  Transfer: "bg-error",
  Donate: "bg-error",
};

// Reuses the app's existing status tokens (same family as RiskBadge) rather
// than an arbitrary categorical palette, since these outcomes really are a
// quality gradient: Donated/Transferred recover something, Markdown is a
// partial recovery, Disposed is a total loss.
const OUTCOME_COLOR: Record<string, string> = {
  Donated: "var(--color-secondary)",
  Transferred: "var(--color-secondary)",
  "Small markdown": "var(--color-tertiary-fixed)",
  Markdown: "var(--color-tertiary-fixed)",
  "Deep markdown": "var(--color-tertiary-fixed-dim)",
  Monitored: "var(--color-outline-variant)",
  Disposed: "var(--color-error)",
  Other: "var(--color-outline-variant)",
};

export default function AnalyticsPage() {
  const { user, token } = useAuth();
  const [store, setStore] = useState<string | null>(null);
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [view, setView] = useState<"sales" | "elasticity">("sales");

  const [salesHistory, setSalesHistory] = useState<SalesHistoryResponse | null>(null);
  const [elasticity, setElasticity] = useState<ElasticityResponse | null>(null);
  const [riskMix, setRiskMix] = useState<RiskActionMix[] | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomesResponse | null>(null);
  const [log, setLog] = useState<TransactionLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !store) setStore(user.store);
  }, [user, store]);

  // Item list for the picker, resets whenever the store changes.
  useEffect(() => {
    if (!store) return;
    setItems(null);
    setItemId(null);
    api
      .listItems(store)
      .then((list) => {
        const sorted = [...list].sort((a, b) => b.current_stock - a.current_stock);
        setItems(sorted);
        setItemId(sorted[0]?.item_id ?? null);
      })
      .catch(() => setError("Couldn't load this store's items."));
  }, [store]);

  useEffect(() => {
    if (!store || !itemId) return;
    analyticsApi.salesHistory(store, itemId, 90).then(setSalesHistory).catch(() => setSalesHistory(null));
  }, [store, itemId]);

  useEffect(() => {
    if (!store) return;
    analyticsApi.elasticity(store).then(setElasticity).catch(() => setElasticity(null));
  }, [store]);

  useEffect(() => {
    analyticsApi.riskActionMix().then(setRiskMix).catch(() => {});
  }, []);

  useEffect(() => {
    if (!store || !token) return;
    analyticsApi.outcomes(token, store).then(setOutcomes).catch(() => {});
    analyticsApi
      .transactionLog(token, store, 25)
      .then(setLog)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the transaction log."));
  }, [store, token]);

  const storeMix = useMemo(() => riskMix?.find((r) => r.store === store) ?? null, [riskMix, store]);

  const salesBars: BarDatum[] = useMemo(
    () =>
      (salesHistory?.points ?? []).map((p) => ({
        label: p.date.slice(5),
        value: p.qty,
        tooltip: `${p.qty.toFixed(0)} units · ${p.discount_pct > 0 ? `${p.discount_pct}% off` : "full price"}`,
      })),
    [salesHistory]
  );

  const elasticityBars: BarDatum[] = useMemo(
    () =>
      (elasticity?.buckets ?? []).map((b) => ({
        label: b.label,
        value: b.mean_qty_norm ?? 0,
        tooltip: `${(b.mean_qty_norm ?? 0).toFixed(2)}x avg volume (${b.n_obs.toLocaleString()} real days observed)`,
      })),
    [elasticity]
  );

  const avgLift = useMemo(() => {
    const deepest = elasticity?.buckets.find((b) => b.bucket === "10pct_plus_off");
    if (!deepest?.mean_qty_norm) return null;
    return Math.round((deepest.mean_qty_norm - 1) * 100);
  }, [elasticity]);

  const selectedItem = items?.find((i) => i.item_id === itemId) ?? null;

  const donutSlices: DonutSlice[] = useMemo(
    () =>
      (outcomes?.slices ?? []).map((s) => ({
        label: s.label,
        value: s.count,
        color: OUTCOME_COLOR[s.label] ?? "var(--color-outline-variant)",
      })),
    [outcomes]
  );

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-on-surface">Analytics &amp; Insights</h1>
          <p className="mt-1 text-on-surface-variant">Real sales history, discount response, and risk/action outcomes.</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Store</label>
          <select
            value={store ?? ""}
            onChange={(e) => setStore(e.target.value)}
            className="rounded-md border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
          >
            {ALL_STORES.map((s) => (
              <option key={s} value={s}>
                {s}
                {s === user.store ? " (your store)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sales Velocity & Elasticity */}
        <div className="rounded-lg border border-outline-variant bg-surface p-5 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-on-surface">Sales Velocity &amp; Elasticity</h2>
              <p className="text-xs text-on-surface-variant">
                {view === "sales"
                  ? "Real daily units sold, last 90 days of the M5 dataset's history"
                  : `Real discount response for ${store} — normalized average volume at each discount depth actually observed`}
              </p>
            </div>
            <div className="flex overflow-hidden rounded-md border border-outline-variant text-xs font-semibold uppercase tracking-wide">
              <button
                onClick={() => setView("sales")}
                className={`px-3 py-1.5 ${view === "sales" ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant hover:bg-surface-container"}`}
              >
                Daily sales
              </button>
              <button
                onClick={() => setView("elasticity")}
                className={`px-3 py-1.5 ${view === "elasticity" ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant hover:bg-surface-container"}`}
              >
                Elasticity
              </button>
            </div>
          </div>

          {view === "sales" && (
            <div className="mb-3">
              <select
                value={itemId ?? ""}
                onChange={(e) => setItemId(e.target.value)}
                className="w-full max-w-sm rounded-md border border-outline-variant bg-surface-container-low px-3 py-1.5 text-sm text-on-surface outline-none focus:border-primary"
              >
                {items?.map((i) => (
                  <option key={i.item_id} value={i.item_id}>
                    {i.product_name} ({i.item_id})
                  </option>
                ))}
              </select>
            </div>
          )}

          {view === "sales" ? (
            salesHistory ? (
              <BarChart data={salesBars} color="var(--color-primary)" valueFormat={(v) => `${v.toFixed(0)} units`} />
            ) : (
              <p className="text-sm text-on-surface-variant">Loading...</p>
            )
          ) : elasticity ? (
            <BarChart
              data={elasticityBars}
              color="var(--color-tertiary-fixed-dim)"
              valueFormat={(v) => `${v.toFixed(2)}x avg`}
              showAllLabels
            />
          ) : (
            <p className="text-sm text-on-surface-variant">Loading...</p>
          )}

          <div className="mt-4 grid grid-cols-3 gap-4 border-t border-outline-variant pt-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-on-surface-variant">Lift at 10%+ off</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-on-surface">
                {avgLift !== null ? `${avgLift >= 0 ? "+" : ""}${avgLift}%` : "—"}
              </p>
              <p className="text-xs text-on-surface-variant">vs. this store's average volume</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-on-surface-variant">Recommended discount</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-on-surface">
                {selectedItem ? `${selectedItem.waste_min_discount_pct}%` : "—"}
              </p>
              <p className="text-xs text-on-surface-variant">for the selected item, to clear stock</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-on-surface-variant">Store elasticity</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-on-surface">
                {elasticity ? elasticity.elasticity_used.toFixed(2) : "—"}
              </p>
              <p className="text-xs text-on-surface-variant">
                {elasticity ? (elasticity.source === "store_specific" ? "estimated for this store" : "pooled fallback — too little real discounting here") : ""}
              </p>
            </div>
          </div>
        </div>

        {/* Risk Profiling */}
        <div className="rounded-lg border border-outline-variant bg-surface p-5">
          <h2 className="text-lg font-bold text-on-surface">Risk Profiling</h2>
          <p className="mb-3 text-xs text-on-surface-variant">Current inventory at risk of waste, {store}.</p>

          {storeMix ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                {(["Critical", "High", "Medium", "Low"] as const).map((tier) => {
                  const value = { Critical: storeMix.critical, High: storeMix.high, Medium: storeMix.medium, Low: storeMix.low }[tier];
                  return (
                    <div key={tier} className={`rounded-lg p-3 ${TIER_TILE_STYLE[tier]}`}>
                      <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{tier}</p>
                      <p className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
                    </div>
                  );
                })}
              </div>

              <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Action queue</p>
              <div className="space-y-2 text-sm">
                {[
                  { label: "Monitor", n: storeMix.monitor },
                  { label: "Small markdown", n: storeMix.small_markdown },
                  { label: "Deep markdown", n: storeMix.deep_markdown },
                  { label: "Transfer", n: storeMix.transfer },
                  { label: "Donate", n: storeMix.donate },
                ]
                  .filter((row) => row.n > 0)
                  .map((row) => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-on-surface">
                        <span className={`h-2 w-2 rounded-full ${ACTION_DOT[row.label]}`} />
                        {row.label}
                      </span>
                      <span className="tabular-nums text-on-surface-variant">{row.n.toLocaleString()} SKUs</span>
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-on-surface-variant">Loading...</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Outcome Tracking */}
        <div className="rounded-lg border border-outline-variant bg-surface p-5">
          <h2 className="text-lg font-bold text-on-surface">Outcome Tracking</h2>
          <p className="mb-4 text-xs text-on-surface-variant">Resolution of applied actions, {store} (reverted ones excluded).</p>
          {outcomes ? (
            <DonutChart slices={donutSlices} centerLabel="actions" />
          ) : (
            <p className="text-sm text-on-surface-variant">Loading...</p>
          )}
        </div>

        {/* Detailed Transaction Log */}
        <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface lg:col-span-2">
          <div className="p-5 pb-0">
            <h2 className="text-lg font-bold text-on-surface">Detailed Transaction Log</h2>
            <p className="mb-3 text-xs text-on-surface-variant">Itemized view of every action applied at {store}.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant text-left text-xs uppercase tracking-wide text-on-surface-variant">
                  <th className="px-4 py-2.5 font-semibold">Item ID</th>
                  <th className="px-4 py-2.5 font-semibold">Item</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Qty</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Price</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Discount</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Value saved</th>
                </tr>
              </thead>
              <tbody>
                {log?.map((row) => {
                  const reverted = row.status === "reverted";
                  return (
                    <tr key={row.id} className={`border-b border-outline-variant last:border-0 ${reverted ? "opacity-50" : ""}`}>
                      <td className="px-4 py-2.5 text-xs text-on-surface-variant">{row.item_id}</td>
                      <td className={`px-4 py-2.5 text-on-surface ${reverted ? "line-through" : ""}`}>{row.product_name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-on-surface-variant">
                        {row.quantity != null ? row.quantity.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-on-surface-variant">
                        {row.full_price != null ? formatUSD(row.full_price) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-on-surface-variant">
                        {row.discount_pct != null ? `${row.discount_pct}%` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-on-secondary-container">
                        {!reverted && row.value_saved ? formatUSD(row.value_saved) : "$0.00"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {log && log.length === 0 && <p className="p-6 text-center text-sm text-on-surface-variant">No actions logged yet.</p>}
            {!log && !error && <p className="p-6 text-center text-sm text-on-surface-variant">Loading...</p>}
          </div>
        </div>
      </div>

      <p className="text-xs text-on-surface-variant">
        Sales history and discount-response numbers come straight from the real M5 dataset (2011-2016) - the same data
        described in the project README - not a live feed. &quot;Qty&quot; in the transaction log is the stock on hand at
        the moment each action was applied, frozen at that time; rows logged before this page existed show &quot;—&quot;
        since that snapshot wasn&apos;t captured yet.
      </p>
    </div>
  );
}
