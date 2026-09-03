"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, StoreMapResponse, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { StatTile } from "@/components/StatTile";
import { StoreMap } from "@/components/StoreMap";
import { formatUSD } from "@/lib/format";

export default function StoreMapPage() {
  const { user } = useAuth();
  const [data, setData] = useState<StoreMapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.storeMap().then(setData).catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the store map."));
  }, []);

  const stats = useMemo(() => {
    if (!data) return null;
    const storesWithCritical = data.stores.filter((s) => s.critical_items > 0).length;
    const totalMoving = data.lanes.reduce((sum, l) => sum + l.batch_value, 0);
    return { storesWithCritical, totalMoving, laneCount: data.lanes.length };
  }, [data]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">All stores</p>
        <h1 className="text-3xl font-bold tracking-tight text-on-surface">Store Network Map</h1>
        <p className="mt-1 text-on-surface-variant">
          Where every store sits and which transfer routes are actually running right now. Positions use a real
          major city standing in for each store (the dataset never discloses actual store locations) — see the
          Transfers page for exactly what&apos;s real vs. disclosed here.
        </p>
      </div>

      {error && <p className="text-error">{error}</p>}

      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="Stores with Critical items" value={`${stats.storesWithCritical} / 10`} sub="Any risk needing action right now" />
          <StatTile label="Active transfer routes" value={stats.laneCount.toLocaleString()} sub="Same-state, cost-effective lanes" />
          <StatTile label="Value moving right now" value={formatUSD(stats.totalMoving)} sub="Combined across all active routes" />
        </div>
      )}

      <div className="rounded-lg border border-outline-variant bg-surface p-5">
        {data ? (
          <StoreMap stores={data.stores} lanes={data.lanes} highlightStore={user?.store} />
        ) : !error ? (
          <p className="text-sm text-on-surface-variant">Loading...</p>
        ) : null}
      </div>

      {data && data.lanes.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline-variant text-xs uppercase tracking-wide text-on-surface-variant">
              <tr>
                <th className="px-4 py-3 font-semibold">Route</th>
                <th className="px-4 py-3 font-semibold text-right">Distance</th>
                <th className="px-4 py-3 font-semibold text-right">Items</th>
                <th className="px-4 py-3 font-semibold text-right">Value moving</th>
                <th className="px-4 py-3 font-semibold text-right">Shipment cost</th>
              </tr>
            </thead>
            <tbody>
              {[...data.lanes]
                .sort((a, b) => b.batch_value - a.batch_value)
                .map((l) => (
                  <tr key={`${l.origin_store}-${l.destination_store}`} className="border-b border-outline-variant last:border-0">
                    <td className="px-4 py-3 font-medium text-on-surface">
                      <Link href={`/stores/${l.origin_store}/transfers`} className="hover:text-primary hover:underline">
                        {l.origin_store} → {l.destination_store}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-on-surface-variant">{l.distance_miles.toLocaleString()} mi</td>
                    <td className="px-4 py-3 text-right tabular-nums text-on-surface-variant">{l.item_count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-on-secondary-container font-semibold">{formatUSD(l.batch_value)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-on-surface-variant">{formatUSD(l.shipment_cost)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
