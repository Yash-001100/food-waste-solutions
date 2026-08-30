"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, TransferCandidate } from "@/lib/api";
import { formatUSD } from "@/lib/format";
import { Pagination } from "@/components/Pagination";

const PAGE_SIZE = 20;

export default function TransfersPage() {
  const params = useParams<{ store: string }>();
  const store = params.store.toUpperCase();
  const [transfers, setTransfers] = useState<TransferCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.listTransfers(store).then(setTransfers).catch(() => setError("Couldn't load transfers."));
  }, [store]);

  const totalPages = transfers ? Math.max(1, Math.ceil(transfers.length / PAGE_SIZE)) : 1;
  const pageTransfers = transfers ? transfers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-text-muted font-mono">{store}</p>
        <h1 className="font-display text-4xl font-800 tracking-tight">Transfer candidates</h1>
        <p className="mt-1 text-text-secondary">
          Critical items here that discounting can&apos;t clear, where another store is genuinely thin on the same item.
        </p>
      </div>

      {error && <p style={{ color: "var(--risk-critical)" }}>{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {pageTransfers?.map((t) => (
          <Link
            key={t.item_id}
            href={`/stores/${store}/items/${t.item_id}`}
            className="rounded-xl border border-border-strong bg-surface-card p-5 hover:bg-surface-card-hover"
          >
            <p className="font-medium">{t.product_name}</p>
            <p className="font-mono text-xs text-text-muted">{t.barcode}</p>
            <p className="mt-2 text-sm text-text-secondary">{t.transfer_detail}</p>
            <p className="mt-2 font-mono text-xs text-text-muted">
              {t.current_stock.toLocaleString()} units on hand · {formatUSD(t.full_price)} each
            </p>
          </Link>
        ))}
      </div>

      {transfers && transfers.length === 0 && (
        <p className="rounded-xl border border-border-strong bg-surface-card p-6 text-center text-sm text-text-muted">
          No transfer candidates at {store} right now.
        </p>
      )}
      {!transfers && !error && <p className="font-mono text-sm text-text-muted">Loading...</p>}

      {transfers && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalCount={transfers.length}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      )}
    </div>
  );
}
