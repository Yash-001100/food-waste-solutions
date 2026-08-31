"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, StoreSummary } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { StatTile } from "@/components/StatTile";
import { RiskStackBar } from "@/components/RiskStackBar";
import { formatCompactUSD, formatUSD } from "@/lib/format";

export default function OverviewPage() {
  const { user } = useAuth();
  const [stores, setStores] = useState<StoreSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .listStores()
      .then(setStores)
      .catch(() => setError("Couldn't reach the API. Is the backend running on localhost:8000?"));
  }, [user]);

  if (!user) return null;

  const totals = stores?.reduce(
    (acc, s) => ({
      items: acc.items + s.total_items,
      critical: acc.critical + s.critical,
      high: acc.high + s.high,
      risk: acc.risk + s.potential_revenue_at_risk,
    }),
    { items: 0, critical: 0, high: 0, risk: 0 }
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-on-surface">Store overview</h1>
        <p className="mt-1 text-on-surface-variant">
          Surplus risk across all 10 stores, from this morning&apos;s forecast run.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-outline-variant bg-error-container p-4 text-sm text-on-error-container">
          {error}
        </p>
      )}

      {totals && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile
            label="Potential waste flagged"
            value={formatCompactUSD(totals.risk)}
            sub="Revenue value at risk across High + Critical items, network-wide"
          />
          <StatTile
            label="Critical items"
            value={totals.critical.toLocaleString()}
            sub="Discounting alone can't clear these - transfer or donate"
          />
          <StatTile
            label="High-risk items"
            value={totals.high.toLocaleString()}
            sub="Need a deep markdown to sell through in time"
          />
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-on-surface-variant">
          Location breakdown
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stores?.map((s) => (
            <Link
              key={s.store}
              href={`/stores/${s.store}`}
              className="rounded-lg border border-outline-variant bg-surface p-5 transition-colors hover:bg-surface-container"
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-xl font-bold tracking-tight text-on-surface">{s.store}</h3>
                <span className="text-xs tabular-nums text-on-surface-variant">
                  {s.total_items.toLocaleString()} items
                </span>
              </div>
              <div className="my-3">
                <RiskStackBar summary={s} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-on-surface-variant">
                  <strong className="text-error">{s.critical}</strong> critical ·{" "}
                  <strong className="text-on-tertiary-fixed">{s.high}</strong> high
                </span>
                <span className="font-semibold tabular-nums text-on-surface">
                  {formatUSD(s.potential_revenue_at_risk)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
