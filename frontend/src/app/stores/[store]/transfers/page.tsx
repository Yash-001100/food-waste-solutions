"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, TransferCandidate, StoreDistancesResponse } from "@/lib/api";
import { formatUSD } from "@/lib/format";
import { Pagination } from "@/components/Pagination";

const PAGE_SIZE = 20;

export default function TransfersPage() {
  const params = useParams<{ store: string }>();
  const store = params.store.toUpperCase();
  const [transfers, setTransfers] = useState<TransferCandidate[] | null>(null);
  const [distances, setDistances] = useState<StoreDistancesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [showDistances, setShowDistances] = useState(false);

  useEffect(() => {
    api.listTransfers(store).then(setTransfers).catch(() => setError("Couldn't load transfers."));
    api.storeDistances(store).then(setDistances).catch(() => {});
  }, [store]);

  const totalPages = transfers ? Math.max(1, Math.ceil(transfers.length / PAGE_SIZE)) : 1;
  const pageTransfers = transfers ? transfers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">{store}</p>
        <h1 className="text-3xl font-bold tracking-tight text-on-surface">Transfer candidates</h1>
        <p className="mt-1 text-on-surface-variant">
          Critical items here that discounting can&apos;t clear, where a sister store sells through this item
          noticeably faster and could use the stock before it expires here. Each card is one shipment lane for
          that item — a single item can appear more than once if its surplus is split across a couple of
          destinations, each capped at how much it can genuinely use.
        </p>
      </div>

      <div className="rounded-lg border border-outline-variant bg-surface-container-low p-4 text-xs text-on-surface-variant">
        <span className="font-semibold text-on-surface">Shipment economics: </span>
        almost no single item&apos;s stock is worth a dedicated truck on its own — each card below shows what this
        item alone is worth versus what a real shipment costs. What actually makes transfer worthwhile is batching:
        every item queued for the same destination store rides on one shipment together, so the fixed cost gets
        split across everything moving that route. Cost is distance × a real 2026 dry-van freight rate (
        {distances ? `$${distances.rate_per_mile.toFixed(2)}/mi` : "$2.40/mi"}), and distance is the real
        great-circle miles between a real major city standing in for each store (the dataset itself never
        discloses a store&apos;s actual city). Transfer targets are restricted to stores in the{" "}
        <span className="font-semibold text-on-surface">same state</span> only — a multi-day cross-country haul
        can burn through a near-expiry item&apos;s remaining shelf life before it even arrives, so out-of-state
        stores are never proposed as a destination, however thin they are on stock (the table below still shows
        every store&apos;s distance for reference, since you asked what those distances are).{" "}
        {distances && (
          <button
            type="button"
            onClick={() => setShowDistances((v) => !v)}
            className="font-medium text-primary underline underline-offset-2"
          >
            {showDistances ? "hide" : "see"} distances from {store} ({distances.city})
          </button>
        )}
      </div>

      {showDistances && distances && (
        <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-outline-variant text-on-surface-variant">
              <tr>
                <th className="px-4 py-2 font-medium">Store</th>
                <th className="px-4 py-2 font-medium">Stand-in city</th>
                <th className="px-4 py-2 text-right font-medium">Distance</th>
                <th className="px-4 py-2 text-right font-medium">Est. shipment cost</th>
              </tr>
            </thead>
            <tbody>
              {distances.distances.map((d) => (
                <tr key={d.store} className="border-b border-outline-variant last:border-0">
                  <td className="px-4 py-2 font-medium text-on-surface">{d.store}</td>
                  <td className="px-4 py-2 text-on-surface-variant">{d.city}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-on-surface-variant">
                    {d.miles.toLocaleString()} mi
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-on-surface-variant">
                    {formatUSD(d.estimated_shipment_cost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-error">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {pageTransfers?.map((t) => (
          <Link
            key={`${t.item_id}-${t.transfer_to_store}`}
            href={`/stores/${store}/items/${t.item_id}`}
            className="rounded-lg border border-outline-variant bg-surface p-5 hover:bg-surface-container"
          >
            <p className="font-medium text-on-surface">{t.product_name}</p>
            <p className="text-xs text-on-surface-variant">{t.barcode}</p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-on-surface-variant">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                swap_horiz
              </span>
              Transfer {t.qty_transferred.toLocaleString()} units to {t.transfer_to_store}
            </p>
            {t.transfer_to_store && t.transfer_to_current_stock != null && (
              <p className="mt-1 text-xs text-on-surface-variant">
                {t.transfer_to_store} holds {t.transfer_to_current_stock.toLocaleString()} units
                {t.transfer_to_daily_demand != null && ` against ~${t.transfer_to_daily_demand}/day of its own demand`}
                {" "}— topped up to a normal stock level, not overstocked
              </p>
            )}
            <p className="mt-2 text-xs tabular-nums text-on-surface-variant">
              {t.current_stock.toLocaleString()} units on hand · {formatUSD(t.full_price)} each
              {t.leftover_qty > 0.5 && (
                <span className="text-tertiary"> · {t.leftover_qty.toLocaleString()} left over, donated</span>
              )}
            </p>

            {t.transfer_item_value != null && t.transfer_shipment_cost != null && (
              <div className="mt-3 rounded-md border border-outline-variant bg-surface-container-low p-3 text-xs">
                {t.transfer_distance_miles != null && (
                  <div className="mb-2 flex items-center justify-between text-on-surface-variant">
                    <span>Distance to {t.transfer_to_store}</span>
                    <span className="tabular-nums">{t.transfer_distance_miles.toLocaleString()} mi</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant">This item alone</span>
                  <span className={`font-semibold tabular-nums ${t.transfer_solo_cost_effective ? "text-on-secondary-container" : "text-error"}`}>
                    {formatUSD(t.transfer_item_value)}
                  </span>
                </div>
                {!t.transfer_solo_cost_effective && (
                  <p className="mt-0.5 text-error">wouldn&apos;t cover a {formatUSD(t.transfer_shipment_cost)} shipment by itself</p>
                )}
                {t.transfer_batch_value != null && t.transfer_batch_item_count != null && (
                  <div className="mt-2 flex items-center justify-between border-t border-outline-variant pt-2">
                    <span className="text-on-surface-variant">
                      Batched with {Math.max(0, t.transfer_batch_item_count - 1)} other item(s) to {t.transfer_to_store}
                    </span>
                    <span className="font-semibold tabular-nums text-on-secondary-container">{formatUSD(t.transfer_batch_value)}</span>
                  </div>
                )}
              </div>
            )}
          </Link>
        ))}
      </div>

      {transfers && transfers.length === 0 && (
        <p className="rounded-lg border border-outline-variant bg-surface p-6 text-center text-sm text-on-surface-variant">
          No transfer candidates at {store} right now.
        </p>
      )}
      {!transfers && !error && <p className="text-sm text-on-surface-variant">Loading...</p>}

      {transfers && (
        <Pagination page={page} totalPages={totalPages} totalCount={transfers.length} pageSize={PAGE_SIZE} onChange={setPage} />
      )}
    </div>
  );
}
