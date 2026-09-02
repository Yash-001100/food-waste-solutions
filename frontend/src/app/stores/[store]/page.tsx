"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ItemSummary, RiskTier, RISK_TIERS, StoreSummary } from "@/lib/api";
import { RiskBadge } from "@/components/RiskBadge";
import { Pagination } from "@/components/Pagination";
import { Treemap, TreemapDatum } from "@/components/Treemap";
import { ItemDetailPanel } from "@/components/ItemDetailPanel";
import { ResizableBox } from "@/components/ResizableBox";
import { formatUSD } from "@/lib/format";

// Past this many tiles a treemap stops being readable (slivers, unreadable
// labels) - so the map shows the biggest-value items and the note below it
// says how many more are in the full table.
const TREEMAP_MAX_TILES = 60;

export default function StoreRiskBoard() {
  const params = useParams<{ store: string }>();
  const store = params.store.toUpperCase();

  const [summary, setSummary] = useState<StoreSummary | null>(null);
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [filter, setFilter] = useState<RiskTier | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const PAGE_SIZE = 50;

  useEffect(() => {
    api.getStore(store).then(setSummary).catch(() => setError("Store not found."));
  }, [store]);

  useEffect(() => {
    setItems(null);
    setPage(1);
    api
      .listItems(store, filter ?? undefined)
      .then(setItems)
      .catch(() => setError("Couldn't load items for this store."));
  }, [store, filter]);

  const q = search.trim().toLowerCase();
  const filteredItems = items && q
    ? items.filter((i) => i.product_name.toLowerCase().includes(q) || i.barcode.includes(q))
    : items;

  const totalPages = filteredItems ? Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE)) : 1;
  const pageItems = filteredItems ? filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : null;

  // Sized by stock value (current_stock x full_price) so the map reads as
  // "how much money is tied up in this item" regardless of which risk tier
  // is filtered in; color still carries the risk tier, so the biggest
  // red/amber tiles are what should draw the eye first. Capped to the
  // highest-value items so tiles stay legible - the full list is still the
  // table below.
  const treemapData: TreemapDatum[] = useMemo(() => {
    if (!filteredItems) return [];
    return [...filteredItems]
      .sort((a, b) => b.current_stock * b.full_price - a.current_stock * a.full_price)
      .slice(0, TREEMAP_MAX_TILES)
      .map((i) => ({
        id: i.item_id,
        label: i.product_name,
        sub: i.category,
        value: i.current_stock * i.full_price,
        tier: i.risk_score,
      }));
  }, [filteredItems]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">{store}</p>
        <h1 className="text-3xl font-bold tracking-tight text-on-surface">Risk board</h1>
      </div>

      {error && (
        <p className="rounded-lg border border-outline-variant bg-error-container p-4 text-sm text-on-error-container">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilter(null)}
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
              filter === null
                ? "border-primary bg-primary/5 text-primary"
                : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
            }`}
          >
            All {summary ? `(${summary.total_items})` : ""}
          </button>
          {RISK_TIERS.map((tier) => {
            const count = summary
              ? { Low: summary.low, Medium: summary.medium, High: summary.high, Critical: summary.critical }[tier]
              : null;
            return (
              <button
                key={tier}
                onClick={() => setFilter(tier)}
                className={`rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  filter === tier
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                {tier} {count !== null ? `(${count})` : ""}
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-64">
          <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontSize: 18 }}>
            search
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search barcode or name..."
            className="w-full rounded-md border border-outline-variant bg-surface py-1.5 pl-9 pr-3 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="rounded-lg border border-outline-variant bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-on-surface">Risk map</h2>
            <p className="text-xs text-on-surface-variant">
              Tile size is stock value on hand (units x price); color is risk tier. Click a tile for detail and actions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {RISK_TIERS.map((tier) => (
              <RiskBadge key={tier} tier={tier} />
            ))}
          </div>
        </div>

        {items && !filteredItems?.length ? (
          <p className="p-6 text-center text-sm text-on-surface-variant">No items match this filter.</p>
        ) : !items ? (
          <p className="p-6 text-center text-sm text-on-surface-variant">Loading...</p>
        ) : (
          <>
            <ResizableBox storageKey="fws_riskmap_height" defaultHeight={420}>
              <Treemap data={treemapData} onSelect={setSelectedItemId} />
            </ResizableBox>
            <p className="mt-2 text-xs text-on-surface-variant">
              Drag the bottom-right corner to resize the map.
              {filteredItems && filteredItems.length > TREEMAP_MAX_TILES && (
                <>
                  {" "}
                  Showing the {TREEMAP_MAX_TILES} highest stock-value items of {filteredItems.length.toLocaleString()} - the
                  full list is sortable in the table below.
                </>
              )}
            </p>
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant text-left text-xs uppercase tracking-wide text-on-surface-variant">
              <th className="px-4 py-3 font-semibold">Product</th>
              <th className="px-4 py-3 font-semibold">Risk</th>
              <th className="px-4 py-3 font-semibold text-right">Sellthrough (do nothing)</th>
              <th className="px-4 py-3 font-semibold text-right">Stock</th>
              <th className="px-4 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {pageItems?.map((item) => (
              <tr key={item.item_id} className="border-b border-outline-variant last:border-0 hover:bg-surface-container">
                <td className="px-4 py-3">
                  <Link href={`/stores/${store}/items/${item.item_id}`} className="font-medium text-on-surface hover:text-primary">
                    {item.product_name}
                  </Link>
                  <p className="text-xs text-on-surface-variant">{item.barcode}</p>
                </td>
                <td className="px-4 py-3">
                  <RiskBadge tier={item.risk_score} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{item.do_nothing_sellthrough_pct.toFixed(1)}%</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {item.current_stock.toLocaleString()}
                  <span className="text-on-surface-variant"> · {formatUSD(item.full_price)}</span>
                </td>
                <td className="px-4 py-3 text-on-surface-variant">{item.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredItems && filteredItems.length === 0 && (
          <p className="p-6 text-center text-sm text-on-surface-variant">No items match this filter.</p>
        )}
        {!items && !error && <p className="p-6 text-center text-sm text-on-surface-variant">Loading...</p>}
      </div>

      {filteredItems && (
        <Pagination page={page} totalPages={totalPages} totalCount={filteredItems.length} pageSize={PAGE_SIZE} onChange={setPage} />
      )}

      {selectedItemId && (
        <ItemDetailPanel store={store} itemId={selectedItemId} onClose={() => setSelectedItemId(null)} />
      )}
    </div>
  );
}
