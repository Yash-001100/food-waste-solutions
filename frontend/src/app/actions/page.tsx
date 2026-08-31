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

  useEffect(() => {
    if (!user || !token) return;
    api
      .actionHistory(token)
      .then(setActions)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load action history."));
    api.actionHistorySummary(token).then(setSummary).catch(() => {});
  }, [user, token]);

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-text-muted font-mono">{user.store}</p>
        <h1 className="font-display text-4xl font-800 tracking-tight">Action history</h1>
        <p className="mt-1 text-text-secondary">Markdowns, transfers, donations, and disposals your store has logged.</p>
      </div>

      {error && <p style={{ color: "var(--risk-critical)" }}>{error}</p>}

      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="Total value saved" value={formatUSD(summary.total_value_saved)} sub="Estimated, vs. doing nothing" />
          <StatTile label="Actions taken" value={summary.actions_taken.toLocaleString()} />
          <StatTile label="Top action type" value={summary.top_action_type ?? "—"} sub="By count, this store" />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border-strong bg-surface-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-strong text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-4 py-3 font-semibold">Item</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold">Applied by</th>
              <th className="px-4 py-3 font-semibold">When</th>
              <th className="px-4 py-3 font-semibold text-right">Value saved</th>
            </tr>
          </thead>
          <tbody>
            {actions?.map((a) => (
              <tr key={a.id} className="border-b border-border-strong last:border-0">
                <td className="px-4 py-3 font-mono text-xs">{a.item_id}</td>
                <td className="px-4 py-3 capitalize">
                  {a.action_type}
                  {a.discount_pct != null && ` (${a.discount_pct}% off)`}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{a.applied_by}</td>
                <td className="px-4 py-3 font-mono text-xs text-text-muted">{a.applied_at.split(".")[0]}</td>
                <td className="px-4 py-3 text-right font-mono" style={a.value_saved ? { color: "var(--risk-low)" } : undefined}>
                  {a.value_saved ? `+${formatUSD(a.value_saved)}` : "$0.00"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {actions && actions.length === 0 && (
          <p className="p-6 text-center text-sm text-text-muted">No actions logged yet.</p>
        )}
        {!actions && !error && <p className="p-6 text-center text-sm text-text-muted font-mono">Loading...</p>}
      </div>

      <p className="text-xs text-text-muted">
        This store has one shared demo login, so &quot;Applied by&quot; is always that account - there&apos;s no real
        multi-associate staff directory behind this demo (see the project README).
      </p>
    </div>
  );
}
