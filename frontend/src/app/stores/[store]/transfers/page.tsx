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
        <p className="text-sm text-on-surface-variant">{store}</p>
        <h1 className="text-3xl font-bold tracking-tight text-on-surface">Transfer candidates</h1>
        <p className="mt-1 text-on-surface-variant">
          Critical items here that discounting can&apos;t clear, where a sister store sells through this item
          noticeably faster and could use the stock before it expires here.
        </p>
      </div>

      {error && <p className="text-error">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {pageTransfers?.map((t) => (
          <Link
            key={t.item_id}
            href={`/stores/${store}/items/${t.item_id}`}
            className="rounded-lg border border-outline-variant bg-surface p-5 hover:bg-surface-container"
          >
            <p className="font-medium text-on-surface">{t.product_name}</p>
            <p className="text-xs text-on-surface-variant">{t.barcode}</p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-on-surface-variant">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                swap_horiz
              </span>
              {t.transfer_detail}
            </p>
            {t.transfer_to_store && t.transfer_to_current_stock != null && (
              <p className="mt-1 text-xs text-on-surface-variant">
                {t.transfer_to_store} holds {t.transfer_to_current_stock.toLocaleString()} units
                {t.transfer_to_daily_demand != null && ` against ~${t.transfer_to_daily_demand}/day of its own demand`}
              </p>
            )}
            <p className="mt-2 text-xs tabular-nums text-on-surface-variant">
              {t.current_stock.toLocaleString()} units on hand · {formatUSD(t.full_price)} each
            </p>
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
