"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ItemDetail, ApiError, ActionType } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { RiskBadge } from "@/components/RiskBadge";
import { formatUSD } from "@/lib/format";

const ACTION_TYPE_FROM_LABEL = (action: string): { type: ActionType; discount?: number } => {
  if (action.startsWith("Monitor")) return { type: "monitor" };
  if (action.startsWith("Transfer")) return { type: "transfer" };
  if (action.startsWith("Donate")) return { type: "donate" };
  const match = action.match(/\((\d+)%/);
  return { type: "markdown", discount: match ? Number(match[1]) : undefined };
};

/**
 * A right-hand drawer for drilling into one item without leaving the risk
 * board - opened from a treemap tile (or could be from a table row). Shows
 * the same real fields and the same apply/donate/dispose actions as the
 * full item detail page; the day-by-day schedule charts stay on that page
 * rather than being duplicated here, so the panel links out to it instead
 * of trying to cram everything in.
 */
export function ItemDetailPanel({ store, itemId, onClose }: { store: string; itemId: string; onClose: () => void }) {
  const { user, token } = useAuth();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<{ id: number; message: string } | null>(null);
  const [reverting, setReverting] = useState(false);

  useEffect(() => {
    setItem(null);
    setError(null);
    setApplied(null);
    api
      .getItem(store, itemId)
      .then(setItem)
      .catch(() => setError("Couldn't load this item."));
  }, [store, itemId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function applyActionType(type: ActionType, discount?: number, label?: string) {
    if (!item || !token) return;
    setApplying(true);
    setApplied(null);
    try {
      const result = await api.applyAction(token, { store, item_id: item.item_id, action_type: type, discount_pct: discount });
      const savedNote = result.value_saved ? ` — est. ${formatUSD(result.value_saved)} recovered` : "";
      setApplied({ id: result.id, message: `Logged: ${label ?? type}${savedNote}` });
    } catch (err) {
      setApplied({ id: -1, message: err instanceof ApiError ? `Couldn't apply: ${err.message}` : "Couldn't reach the API." });
    } finally {
      setApplying(false);
    }
  }

  async function handleUndo() {
    if (!applied || applied.id < 0 || !token) return;
    setReverting(true);
    try {
      await api.revertAction(token, applied.id);
      setApplied({ id: -1, message: "Reverted — this action no longer counts toward totals." });
    } catch (err) {
      setApplied({
        id: applied.id,
        message: err instanceof ApiError ? `Couldn't undo: ${err.message}` : "Couldn't reach the API.",
      });
    } finally {
      setReverting(false);
    }
  }

  async function handleApply() {
    if (!item) return;
    const { type, discount } = ACTION_TYPE_FROM_LABEL(item.action);
    await applyActionType(type, discount, item.action);
  }

  const canApply = user?.store === store;
  const revenueAtRisk = item ? item.current_stock * item.full_price : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-on-background/20" onClick={onClose} aria-hidden="true" />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col overflow-y-auto border-l border-outline-variant bg-surface shadow-xl">
        <div className="flex items-start justify-between border-b border-outline-variant p-5">
          <div className="min-w-0">
            {item && (
              <div className="mb-2">
                <RiskBadge tier={item.risk_score} />
              </div>
            )}
            <h2 className="truncate text-lg font-bold text-on-surface">{item?.product_name ?? "Loading..."}</h2>
            {item && (
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {[item.category, item.shelf_location].filter(Boolean).join(" · ") || item.item_id}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
            title="Close"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              close
            </span>
          </button>
        </div>

        {error && <p className="p-5 text-sm text-error">{error}</p>}
        {!item && !error && <p className="p-5 text-sm text-on-surface-variant">Loading...</p>}

        {item && (
          <div className="flex-1 space-y-6 p-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-outline-variant p-3">
                <p className="text-xs uppercase tracking-wide text-on-surface-variant">Stock value</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-on-surface">{formatUSD(revenueAtRisk ?? 0)}</p>
                <p className="text-xs text-on-surface-variant">{item.current_stock.toLocaleString()} units on hand</p>
              </div>
              <div className="rounded-lg border border-outline-variant p-3">
                <p className="text-xs uppercase tracking-wide text-on-surface-variant">Sellthrough</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-on-surface">{item.do_nothing_sellthrough_pct.toFixed(1)}%</p>
                <p className="text-xs text-on-surface-variant">if left untouched</p>
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-on-surface-variant">Recommended action</p>
              <p className="mt-1 font-semibold text-on-surface">{item.action}</p>
            </div>

            {canApply ? (
              <div className="space-y-2">
                <button
                  onClick={handleApply}
                  disabled={applying}
                  className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {applying ? "Applying..." : "Apply this action"}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => applyActionType("donate", undefined, "Donated")}
                    disabled={applying}
                    className="flex-1 rounded-md border border-outline-variant px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    Donate
                  </button>
                  <button
                    onClick={() => applyActionType("dispose", undefined, "Disposed")}
                    disabled={applying}
                    className="flex-1 rounded-md border border-outline-variant px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    Dispose
                  </button>
                </div>
                {applied && (
                  <p className="text-sm text-on-surface-variant">
                    {applied.message}
                    {applied.id >= 0 && (
                      <button
                        onClick={handleUndo}
                        disabled={reverting}
                        className="ml-2 font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        {reverting ? "Undoing..." : "Undo"}
                      </button>
                    )}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-on-surface-variant">Sign in as a {store} associate to apply this action.</p>
            )}

            <Link
              href={`/stores/${store}/items/${item.item_id}`}
              className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              View full details &amp; sell-down schedule
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                arrow_forward
              </span>
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}
