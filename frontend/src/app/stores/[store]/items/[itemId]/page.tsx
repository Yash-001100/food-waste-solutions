"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ItemDetail, ApiError, ActionType } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { RiskBadge } from "@/components/RiskBadge";
import { Barcode } from "@/components/Barcode";
import { ScheduleChart } from "@/components/ScheduleChart";
import { StatTile } from "@/components/StatTile";
import { formatUSD } from "@/lib/format";

const ACTION_TYPE_FROM_LABEL = (action: string): { type: string; discount?: number } => {
  if (action.startsWith("Monitor")) return { type: "monitor" };
  if (action.startsWith("Transfer")) return { type: "transfer" };
  if (action.startsWith("Donate")) return { type: "donate" };
  const match = action.match(/\((\d+)%/);
  return { type: "markdown", discount: match ? Number(match[1]) : undefined };
};

export default function ItemDetailPage() {
  const params = useParams<{ store: string; itemId: string }>();
  const store = params.store.toUpperCase();
  const { user, token } = useAuth();

  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<{ id: number; message: string } | null>(null);
  const [reverting, setReverting] = useState(false);

  useEffect(() => {
    api
      .getItem(store, params.itemId)
      .then(setItem)
      .catch(() => setError("Item not found."));
  }, [store, params.itemId]);

  async function applyActionType(type: ActionType, discount?: number, label?: string) {
    if (!item || !token) return;
    setApplying(true);
    setApplied(null);
    try {
      const result = await api.applyAction(token, {
        store,
        item_id: item.item_id,
        action_type: type,
        discount_pct: discount,
      });
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
    await applyActionType(type as ActionType, discount, item.action);
  }

  if (error) {
    return <p className="text-error">{error}</p>;
  }
  if (!item) {
    return <p className="text-sm text-on-surface-variant">Loading...</p>;
  }

  const canApply = user?.store === store;
  const stockPoints = item.schedule.map((s) => ({ x: s.days_remaining, y: s.stock_remaining }));
  const discountPoints = item.schedule.map((s) => ({ x: s.days_remaining, y: s.applied_discount_pct }));

  return (
    <div className="space-y-8">
      <Link href={`/stores/${store}`} className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary">
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          arrow_back
        </span>
        Back to {store} risk board
      </Link>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <RiskBadge tier={item.risk_score} />
            <span className="text-xs text-on-surface-variant">{item.shelf_life_tier} shelf-life tier</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-on-surface">{item.product_name}</h1>
          <p className="mt-1 text-on-surface-variant">
            {store} · {item.item_id} · {formatUSD(item.full_price)} full price
          </p>
        </div>
        <div className="rounded-lg bg-white p-3">
          <Barcode value={item.barcode} />
        </div>
      </div>

      <div className="rounded-lg border border-outline-variant bg-surface p-5">
        <p className="text-sm text-on-surface-variant">Recommended action</p>
        <p className="text-2xl font-bold tracking-tight text-on-surface">{item.action}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canApply ? (
            <>
              <button
                onClick={handleApply}
                disabled={applying}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {applying ? "Applying..." : "Apply this action"}
              </button>
              <span className="text-xs text-on-surface-variant">or log manually:</span>
              <button
                onClick={() => applyActionType("donate", undefined, "Donated")}
                disabled={applying}
                className="flex items-center gap-1.5 rounded-md border border-outline-variant px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  volunteer_activism
                </span>
                Donate
              </button>
              <button
                onClick={() => applyActionType("dispose", undefined, "Disposed")}
                disabled={applying}
                className="flex items-center gap-1.5 rounded-md border border-outline-variant px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  delete
                </span>
                Dispose
              </button>
            </>
          ) : (
            <p className="text-xs text-on-surface-variant">Sign in as a {store} associate to apply this action.</p>
          )}
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
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Current stock" value={item.current_stock.toLocaleString()} sub={`${item.shelf_life_days} days shelf life`} />
        <StatTile
          label="Sellthrough if untouched"
          value={`${item.do_nothing_sellthrough_pct.toFixed(1)}%`}
          sub={item.reachable_target ? "95% target reachable with a discount" : "95% target unreachable even at 50% off"}
        />
        <StatTile label="Daily demand" value={item.baseline_daily_demand.toFixed(1)} sub={`Elasticity used: ${item.elasticity_used.toFixed(3)}`} />
      </div>

      {(item.category || item.vendor || item.batch_lot || item.shelf_location) && (
        <div className="rounded-lg border border-outline-variant bg-surface p-5">
          <h2 className="mb-3 text-lg font-bold text-on-surface">Item details</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            {item.category && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-on-surface-variant">Category</dt>
                <dd className="mt-0.5 text-on-surface">{item.category}</dd>
              </div>
            )}
            {item.vendor && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-on-surface-variant">Vendor</dt>
                <dd className="mt-0.5 text-on-surface">{item.vendor}</dd>
              </div>
            )}
            {item.batch_lot && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-on-surface-variant">Batch lot</dt>
                <dd className="mt-0.5 text-xs text-on-surface">{item.batch_lot}</dd>
              </div>
            )}
            {item.shelf_location && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-on-surface-variant">Shelf location</dt>
                <dd className="mt-0.5 text-on-surface">{item.shelf_location}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-on-surface-variant">
            Category comes from the source data; vendor, batch lot, and shelf location are illustrative demo data.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-outline-variant bg-surface p-5">
          <h2 className="mb-1 text-lg font-bold text-on-surface">Stock remaining</h2>
          <p className="mb-3 text-xs text-on-surface-variant">Day-by-day depletion under the recommended schedule</p>
          <ScheduleChart points={stockPoints} color="var(--color-primary)" valueFormat={(v) => v.toFixed(0)} />
        </div>
        <div className="rounded-lg border border-outline-variant bg-surface p-5">
          <h2 className="mb-1 text-lg font-bold text-on-surface">Discount applied</h2>
          <p className="mb-3 text-xs text-on-surface-variant">Escalates only when the current discount can no longer clear the actual remaining stock</p>
          <ScheduleChart points={discountPoints} color="var(--color-tertiary-fixed-dim)" valueFormat={(v) => `${v}%`} />
        </div>
      </div>
    </div>
  );
}
