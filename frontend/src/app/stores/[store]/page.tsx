"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ItemSummary, RiskTier, RISK_TIERS, StoreSummary } from "@/lib/api";
import { RiskBadge } from "@/components/RiskBadge";
import { Pagination } from "@/components/Pagination";
import { formatUSD } from "@/lib/format";

export default function StoreRiskBoard() {
  const params = useParams<{ store: string }>();
  const store = params.store.toUpperCase();

  const [summary, setSummary] = useState<StoreSummary | null>(null);
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [filter, setFilter] = useState<RiskTier | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
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
    </div>
  );
}
