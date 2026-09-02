"use client";

import { useEffect, useState } from "react";
import { api, AppliedAction, ActionHistorySummary, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { StatTile } from "@/components/StatTile";
import { formatUSD } from "@/lib/format";

export default function ActionHistoryPage() {
  const { user, token } = useAuth();
  const [actions, setActions] = useState<AppliedAction[] | null>(null);
  const [summary, setSummary] = useState<ActionHistorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<number | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !token) return;
    api
      .actionHistory(token)
      .then(setActions)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load action history."));
    api.actionHistorySummary(token).then(setSummary).catch(() => {});
  }, [user, token]);

  async function handleRevert(id: number) {
    if (!token) return;
    setRevertingId(id);
    setRevertError(null);
    try {
      const updated = await api.revertAction(token, id);
      setActions((cur) => cur?.map((a) => (a.id === id ? updated : a)) ?? cur);
      // Reverted actions drop out of the totals, so the stat tiles need a refresh too.
      api.actionHistorySummary(token).then(setSummary).catch(() => {});
    } catch (err) {
      setRevertError(err instanceof ApiError ? err.message : "Couldn't revert this action.");
    } finally {
      setRevertingId(null);
    }
  }

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">{user.store}</p>
        <h1 className="text-3xl font-bold tracking-tight text-on-surface">Action history</h1>
        <p className="mt-1 text-on-surface-variant">Markdowns, transfers, donations, and disposals your store has logged.</p>
      </div>

      {error && <p className="text-error">{error}</p>}
      {revertError && <p className="text-sm text-error">{revertError}</p>}

      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="Total value saved" value={formatUSD(summary.total_value_saved)} sub="Estimated, vs. doing nothing" />
          <StatTile label="Actions taken" value={summary.actions_taken.toLocaleString()} sub="Reverted actions don't count" />
          <StatTile label="Top action type" value={summary.top_action_type ?? "—"} sub="By count, this store" />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant text-left text-xs uppercase tracking-wide text-on-surface-variant">
              <th className="px-4 py-3 font-semibold">Item</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Applied by</th>
              <th className="px-4 py-3 font-semibold">When</th>
              <th className="px-4 py-3 font-semibold text-right">Value saved</th>
              <th className="px-4 py-3 font-semibold text-right">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {actions?.map((a) => {
              const reverted = a.status === "reverted";
              return (
                <tr key={a.id} className={`border-b border-outline-variant last:border-0 ${reverted ? "opacity-60" : ""}`}>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">{a.item_id}</td>
                  <td className={`px-4 py-3 capitalize text-on-surface ${reverted ? "line-through" : ""}`}>
                    {a.action_type}
                    {a.discount_pct != null && ` (${a.discount_pct}% off)`}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                        reverted ? "bg-surface-container text-on-surface-variant" : "bg-secondary-container text-on-secondary-container"
                      }`}
                    >
                      {reverted ? "Reverted" : "Applied"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">{a.applied_by}</td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">{a.applied_at.split(".")[0]}</td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      !reverted && a.value_saved ? "text-on-secondary-container" : "text-on-surface-variant"
                    }`}
                  >
                    {!reverted && a.value_saved ? `+${formatUSD(a.value_saved)}` : "$0.00"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!reverted && (
                      <button
                        onClick={() => handleRevert(a.id)}
                        disabled={revertingId === a.id}
                        className="rounded-md border border-outline-variant px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-on-surface-variant hover:border-error hover:text-error disabled:opacity-50"
                      >
                        {revertingId === a.id ? "Reverting..." : "Revert"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {actions && actions.length === 0 && (
          <p className="p-6 text-center text-sm text-on-surface-variant">No actions logged yet.</p>
        )}
        {!actions && !error && <p className="p-6 text-center text-sm text-on-surface-variant">Loading...</p>}
      </div>

      <p className="text-xs text-on-surface-variant">
        Reverting an action doesn&apos;t undo any real inventory change - applying an action here only logs the decision,
        it was never wired to actually move stock - it just marks the log entry as reverted and drops it from the
        totals above, so a mistaken click doesn&apos;t misrepresent what this store actually did. This store also has
        one shared demo login, so &quot;Applied by&quot; is always that account - there&apos;s no real multi-associate
        staff directory behind this demo (see the project README).
      </p>
    </div>
  );
}
