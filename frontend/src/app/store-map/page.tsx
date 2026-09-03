"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, StoreMapResponse, StoreSummary, StoreDistancesResponse, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { StatTile } from "@/components/StatTile";
import { StoreMap } from "@/components/StoreMap";
import { formatUSD, formatTransitMinutes } from "@/lib/format";

type ColorMode = "state" | "risk";

function matchesSearch(d: { store: string; city: string }, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return d.store.toLowerCase().includes(q) || d.city.toLowerCase().includes(q);
}

export default function StoreMapPage() {
  const { user } = useAuth();
  const [data, setData] = useState<StoreMapResponse | null>(null);
  const [yourStore, setYourStore] = useState<StoreSummary | null>(null);
  const [distances, setDistances] = useState<StoreDistancesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("state");
  const [showDistances, setShowDistances] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.storeMap().then(setData).catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the store map."));
  }, []);

  useEffect(() => {
    if (!user) return;
    api.getStore(user.store).then(setYourStore).catch(() => {});
    api.storeDistances(user.store).then(setDistances).catch(() => {});
  }, [user]);

  const stats = useMemo(() => {
    if (!data) return null;
    const laneCount = data.lanes.length;
    const totalMoving = data.lanes.reduce((sum, l) => sum + l.batch_value, 0);
    return { laneCount, totalMoving };
  }, [data]);

  const sameStateReach = useMemo(() => {
    if (!distances || !user) return null;
    const stateCode = user.store.split("_")[0];
    const peers = distances.distances.filter((d) => d.store.split("_")[0] === stateCode);
    const avgMiles = peers.length ? peers.reduce((s, d) => s + d.miles, 0) / peers.length : 0;
    return { count: peers.length, avgMiles };
  }, [distances, user]);

  const criticalPct = yourStore && yourStore.total_items > 0 ? (yourStore.critical / yourStore.total_items) * 100 : 0;

  const storeInfoByCode = useMemo(() => {
    if (!data) return {} as Record<string, StoreMapResponse["stores"][number]>;
    return Object.fromEntries(data.stores.map((s) => [s.store, s]));
  }, [data]);

  const topOpportunity = useMemo(() => {
    if (!data || !user) return null;
    const sending = [...data.lanes].filter((l) => l.origin_store === user.store).sort((a, b) => b.batch_value - a.batch_value)[0];
    if (sending) return { ...sending, direction: "sending" as const };
    const receiving = [...data.lanes].filter((l) => l.destination_store === user.store).sort((a, b) => b.batch_value - a.batch_value)[0];
    if (receiving) return { ...receiving, direction: "receiving" as const };
    return null;
  }, [data, user]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
            Logistics &amp; regional rebalancing
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-on-surface">Store Network Map</h1>
          <p className="mt-1 max-w-2xl text-on-surface-variant">
            Where every store sits and which same-state transfer lanes are actually running right now — real
            distances and dollar amounts throughout, no live GPS or traffic data (this project has none).
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <span
            className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
            style={{ fontSize: 18 }}
          >
            search
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search store or city..."
            className="w-full rounded-md border border-outline-variant bg-surface py-2 pl-9 pr-3 text-sm text-on-surface outline-none focus:border-primary"
          />
        </div>
      </div>

      {error && <p className="text-error">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-outline-variant bg-surface p-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Your store</p>
          <p className="text-2xl font-bold tracking-tight text-on-surface">{user?.store ?? "—"}</p>
          <p className="text-xs text-on-surface-variant">{storeInfoByCode[user?.store ?? ""]?.city ?? ""}</p>
          {yourStore && (
            <>
              <p className="mt-3 text-xs text-on-surface-variant">
                <span className="font-semibold text-error">{yourStore.critical.toLocaleString()} items</span> at
                Critical risk of {yourStore.total_items.toLocaleString()}
              </p>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
                <div className="h-full rounded-full bg-error" style={{ width: `${Math.min(100, criticalPct)}%` }} />
              </div>
            </>
          )}
        </div>

        <StatTile
          label="Same-state reach"
          value={sameStateReach ? `${sameStateReach.count}` : "—"}
          sub={
            sameStateReach
              ? `Avg ${Math.round(sameStateReach.avgMiles).toLocaleString()} mi away — the only stores eligible to receive a transfer`
              : undefined
          }
        />
        <StatTile
          label="Active transfer lanes"
          value={stats ? stats.laneCount.toLocaleString() : "—"}
          sub="Same-state, cost-effective lanes running network-wide"
        />
        <StatTile
          label="Value moving now"
          value={stats ? formatUSD(stats.totalMoving) : "—"}
          sub="Combined across every active route, network-wide"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-outline-variant bg-surface p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-on-surface">Store network</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex overflow-hidden rounded-md border border-outline-variant">
                <button
                  onClick={() => setColorMode("state")}
                  className={`px-2.5 py-1.5 font-medium transition-colors ${
                    colorMode === "state"
                      ? "bg-secondary-container text-on-secondary-container"
                      : "text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  By state
                </button>
                <button
                  onClick={() => setColorMode("risk")}
                  className={`px-2.5 py-1.5 font-medium transition-colors ${
                    colorMode === "risk"
                      ? "bg-secondary-container text-on-secondary-container"
                      : "text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  By risk
                </button>
              </div>
              <label className="flex items-center gap-1.5 rounded-md border border-outline-variant px-2.5 py-1.5 font-medium text-on-surface-variant">
                <input type="checkbox" checked={showDistances} onChange={(e) => setShowDistances(e.target.checked)} />
                Show distances
              </label>
            </div>
          </div>
          {data ? (
            <StoreMap
              stores={data.stores}
              lanes={data.lanes}
              highlightStore={user?.store}
              colorMode={colorMode}
              showDistances={showDistances}
              searchQuery={search}
            />
          ) : !error ? (
            <p className="text-sm text-on-surface-variant">Loading...</p>
          ) : null}
        </div>

        <div className="rounded-lg border border-outline-variant bg-surface p-5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
            Top transfer opportunity
          </p>
          {!data || !user ? (
            <p className="text-sm text-on-surface-variant">Loading...</p>
          ) : topOpportunity ? (
            <>
              <p className="text-lg font-bold text-on-surface">
                {topOpportunity.direction === "sending"
                  ? `${user.store} → ${topOpportunity.destination_store}`
                  : `${topOpportunity.origin_store} → ${user.store}`}
              </p>
              <p className="mb-4 text-sm text-on-surface-variant">
                {topOpportunity.direction === "sending"
                  ? "Your store's highest-value active lane right now"
                  : "Your store's highest-value incoming lane right now"}
              </p>
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-on-surface-variant">Distance</dt>
                  <dd className="font-semibold text-on-surface">{topOpportunity.distance_miles.toLocaleString()} mi</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-on-surface-variant">Est. transit</dt>
                  <dd className="font-semibold text-on-surface">{formatTransitMinutes(topOpportunity.transit_minutes)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-on-surface-variant">Items on this lane</dt>
                  <dd className="font-semibold text-on-surface">{topOpportunity.item_count.toLocaleString()}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-on-surface-variant">Value moving</dt>
                  <dd className="font-semibold text-on-secondary-container">{formatUSD(topOpportunity.batch_value)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-on-surface-variant">Shipment cost</dt>
                  <dd className="font-semibold text-on-surface">{formatUSD(topOpportunity.shipment_cost)}</dd>
                </div>
              </dl>
              <Link
                href={`/stores/${user.store}/transfers`}
                className="mt-5 flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
              >
                View all transfers
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  arrow_forward
                </span>
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-on-surface-variant">
                Your store has no active transfer lane right now — either nothing here is thin enough at a
                same-state sister store, or no route cleared the cost-effectiveness check.
              </p>
              <Link
                href={`/stores/${user.store}/transfers`}
                className="mt-4 flex items-center justify-center gap-1.5 rounded-md border border-outline-variant px-4 py-2.5 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container"
              >
                Check your Transfers page
              </Link>
            </>
          )}
        </div>
      </div>

      {distances && data && (
        <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface">
          <div className="border-b border-outline-variant px-4 py-3">
            <p className="text-sm font-semibold text-on-surface">Regional store proximity — from {user?.store}</p>
            <p className="text-xs text-on-surface-variant">
              Real distance, a disclosed truck-speed estimate, and whether that store is actually part of a live
              lane right now — not a fabricated capacity percentage.
            </p>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline-variant text-xs uppercase tracking-wide text-on-surface-variant">
              <tr>
                <th className="px-4 py-3 font-semibold">Store</th>
                <th className="px-4 py-3 font-semibold text-right">Distance / transit</th>
                <th className="px-4 py-3 font-semibold text-right">Critical items</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Focus</th>
              </tr>
            </thead>
            <tbody>
              {distances.distances
                .filter((d) => matchesSearch(d, search))
                .map((d) => {
                  const info = storeInfoByCode[d.store];
                  const isSameState = d.store.split("_")[0] === user?.store.split("_")[0];
                  const statusLabel = !isSameState
                    ? "Different state — not eligible"
                    : info?.sending_now && info?.receiving_now
                    ? "Sending & receiving now"
                    : info?.sending_now
                    ? "Sending now"
                    : info?.receiving_now
                    ? "Receiving now"
                    : "No active transfers";
                  return (
                    <tr key={d.store} className="border-b border-outline-variant last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-medium text-on-surface">{d.store}</p>
                        <p className="text-xs text-on-surface-variant">{d.city}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-on-surface-variant">
                        {d.miles.toLocaleString()} mi · {formatTransitMinutes(d.estimated_transit_minutes)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-on-surface-variant">
                        {info?.critical_items.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            isSameState && (info?.sending_now || info?.receiving_now)
                              ? "bg-secondary-container text-on-secondary-container"
                              : "bg-surface-container-high text-on-surface-variant"
                          }`}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setSearch(d.store)} className="text-xs font-semibold text-primary hover:underline">
                          Focus on map
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
