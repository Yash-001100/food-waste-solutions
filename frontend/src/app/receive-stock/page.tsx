"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, ItemSummary, ReceiveStockResponse, StockMovement, StockTransfer } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { RiskBadge } from "@/components/RiskBadge";

export default function ReceiveStockPage() {
  const { user, token } = useAuth();
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [incoming, setIncoming] = useState<StockTransfer[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [confirmError, setConfirmError] = useState<Record<number, string>>({});
  const [result, setResult] = useState<ReceiveStockResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshHistory = useCallback(() => {
    if (!user) return;
    api.listStockMovements(user.store).then(setMovements).catch(() => {});
  }, [user]);

  const refreshIncoming = useCallback(() => {
    if (!user) return;
    api.listIncomingTransfers(user.store, "in_transit").then(setIncoming).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api.listItems(user.store).then(setItems).catch(() => {});
    refreshHistory();
    refreshIncoming();
  }, [user, refreshHistory, refreshIncoming]);

  async function handleConfirm(transferId: number) {
    if (!token) return;
    setConfirmingId(transferId);
    setConfirmError((prev) => ({ ...prev, [transferId]: "" }));
    try {
      await api.confirmTransfer(token, transferId);
      refreshIncoming();
      refreshHistory();
      if (user) api.listItems(user.store).then(setItems).catch(() => {});
    } catch (err) {
      setConfirmError((prev) => ({
        ...prev,
        [transferId]: err instanceof ApiError ? err.message : "Couldn't reach the API.",
      }));
    } finally {
      setConfirmingId(null);
    }
  }

  async function handleFile(file: File) {
    if (!user || !token) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a .csv file.");
      return;
    }
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.receiveStock(token, user.store, file);
      setResult(res);
      // The upload can move items between risk tiers, so the item list
      // (used for the starter-CSV download and the "at a glance" numbers
      // below) needs a refresh too, not just the receipts history.
      api.listItems(user.store).then(setItems).catch(() => {});
      refreshHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't process this file.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function downloadTemplate() {
    if (!items) return;
    // A real starter file, not a fabricated example: this store's own item
    // IDs and product names, so there's no guessing at a valid item_id -
    // just fill in the qty column for whatever actually arrived and delete
    // the rest of the rows.
    const sample = [...items]
      .sort((a, b) => a.current_stock - b.current_stock)
      .slice(0, 25);
    const lines = ["item_id,qty,# product_name (for reference - not read on upload)"];
    for (const i of sample) {
      lines.push(`${i.item_id},,${i.product_name.replace(/,/g, "")}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${user?.store ?? "store"}_shipment_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-on-surface-variant">{user.store}</p>
        <h1 className="text-3xl font-bold tracking-tight text-on-surface">Receive stock</h1>
        <p className="mt-1 text-on-surface-variant">
          Log a real shipment by uploading its manifest, instead of typing each item&apos;s new stock into a form by
          hand.
        </p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-outline-variant bg-surface"
        }`}
      >
        <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 36 }}>
          local_shipping
        </span>
        <p className="mt-2 text-sm font-medium text-on-surface">
          {uploading ? "Processing..." : "Drop a shipment CSV here, or"}
        </p>
        {!uploading && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:opacity-90"
            >
              Choose file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <p className="mt-3 text-xs text-on-surface-variant">
              Two columns: <code className="rounded bg-surface-container px-1 py-0.5">item_id</code> and{" "}
              <code className="rounded bg-surface-container px-1 py-0.5">qty</code>. Only items {user.store} already
              carries can be restocked this way -{" "}
              <button onClick={downloadTemplate} disabled={!items} className="font-medium text-primary hover:underline disabled:opacity-50">
                download a starter CSV of this store&apos;s real items
              </button>
              .
            </p>
          </>
        )}
      </div>

      {result && (
        <div className="rounded-lg border border-outline-variant bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-on-surface">
              {result.filename}: {result.rows_accepted} row{result.rows_accepted === 1 ? "" : "s"} received
            </h2>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-secondary-container p-3 text-on-secondary-container">
              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Rows accepted</p>
              <p className="text-2xl font-bold tabular-nums">{result.rows_accepted}</p>
            </div>
            <div className="rounded-lg bg-surface-container p-3 text-on-surface">
              <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Items updated</p>
              <p className="text-2xl font-bold tabular-nums">{result.items_updated}</p>
            </div>
            <div className={`rounded-lg p-3 ${result.rows_rejected > 0 ? "bg-error-container text-on-error-container" : "bg-surface-container text-on-surface"}`}>
              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Rows rejected</p>
              <p className="text-2xl font-bold tabular-nums">{result.rows_rejected}</p>
            </div>
          </div>

          {result.rejected.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Why rows were rejected
              </p>
              <ul className="space-y-1 text-sm text-on-surface-variant">
                {result.rejected.map((r, idx) => (
                  <li key={idx}>
                    Row {r.row}
                    {r.item_id ? ` (${r.item_id})` : ""}: {r.reason}
                  </li>
                ))}
              </ul>
              {result.rows_rejected > result.rejected.length && (
                <p className="mt-1 text-xs text-on-surface-variant">
                  ...and {result.rows_rejected - result.rejected.length} more.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-outline-variant bg-surface p-5">
        <h2 className="text-lg font-bold text-on-surface">Incoming from other stores</h2>
        <p className="mb-3 text-xs text-on-surface-variant">
          Transfers a sister store has shipped to {user.store} that haven&apos;t been confirmed yet - {user.store}
          &apos;s own stock won&apos;t reflect them until someone here checks them in, the same way a real shipment
          isn&apos;t inventory until it&apos;s scanned at the dock.
        </p>
        {incoming && incoming.length > 0 && (
          <ul className="space-y-2">
            {incoming.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-outline-variant bg-surface-container-low p-3"
              >
                <div>
                  <p className="text-sm font-medium text-on-surface">{t.product_name}</p>
                  <p className="text-xs text-on-surface-variant">
                    {t.qty.toLocaleString()} units from {t.origin_store} · shipped {t.shipped_at.split(".")[0]}
                  </p>
                  {confirmError[t.id] && <p className="text-xs text-error">{confirmError[t.id]}</p>}
                </div>
                <button
                  onClick={() => handleConfirm(t.id)}
                  disabled={confirmingId === t.id}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {confirmingId === t.id ? "Confirming..." : "Confirm receipt"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {incoming && incoming.length === 0 && (
          <p className="text-sm text-on-surface-variant">Nothing in transit to {user.store} right now.</p>
        )}
        {!incoming && <p className="text-sm text-on-surface-variant">Loading...</p>}
      </div>

      <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface">
        <div className="p-5 pb-0">
          <h2 className="text-lg font-bold text-on-surface">Stock movement history</h2>
          <p className="mb-3 text-xs text-on-surface-variant">
            Every supplier receipt, outgoing transfer, and confirmed incoming transfer at {user.store}, most recent
            first.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant text-left text-xs uppercase tracking-wide text-on-surface-variant">
              <th className="px-4 py-2.5 font-semibold">Item</th>
              <th className="px-4 py-2.5 font-semibold">Movement</th>
              <th className="px-4 py-2.5 font-semibold text-right">Qty</th>
              <th className="px-4 py-2.5 font-semibold">Risk now</th>
              <th className="px-4 py-2.5 font-semibold">By</th>
              <th className="px-4 py-2.5 font-semibold">When</th>
            </tr>
          </thead>
          <tbody>
            {movements?.map((m) => (
              <tr key={`${m.kind}-${m.id}`} className="border-b border-outline-variant last:border-0">
                <td className="px-4 py-2.5 text-on-surface">
                  {m.product_name}
                  <p className="text-xs text-on-surface-variant">{m.item_id}</p>
                </td>
                <td className="px-4 py-2.5 text-xs text-on-surface-variant">
                  {m.kind === "receipt" && (
                    <>
                      Supplier receipt
                      {m.counterparty && <span className="block text-on-surface-variant">{m.counterparty}</span>}
                    </>
                  )}
                  {m.kind === "transfer_out" && (
                    <span className="text-tertiary">
                      Shipped to {m.counterparty}
                      {m.status !== "received" && <span className="block capitalize">{m.status.replace("_", " ")}</span>}
                    </span>
                  )}
                  {m.kind === "transfer_in" && <span className="text-secondary">Received from {m.counterparty}</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-on-surface-variant">
                  {m.qty.toLocaleString()}
                </td>
                <td className="px-4 py-2.5">
                  <RiskBadge tier={m.risk_score_now} />
                </td>
                <td className="px-4 py-2.5 text-xs text-on-surface-variant">{m.performed_by || "—"}</td>
                <td className="px-4 py-2.5 text-xs text-on-surface-variant">{m.performed_at.split(".")[0]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {movements && movements.length === 0 && (
          <p className="p-6 text-center text-sm text-on-surface-variant">No stock movements logged yet.</p>
        )}
        {!movements && <p className="p-6 text-center text-sm text-on-surface-variant">Loading...</p>}
      </div>

      <p className="text-xs text-on-surface-variant">
        CSV upload only restocks items {user.store} already carries - a brand-new item this store has never sold has
        no real sales history to base a demand or discount recommendation on, so rather than invent those numbers,
        unrecognized item IDs are rejected instead of silently accepted. An incoming transfer works the same way but
        is stricter still: it can only ever be one of the model&apos;s own <a className="font-medium text-primary hover:underline" href={`/stores/${user.store}/transfers`}>recommended transfer lanes</a> to
        {" "}{user.store}, shipped by that origin store - there&apos;s no way to receive an arbitrary item or quantity
        through this page. Either way, risk score, recommended action, and every stock-dependent number recompute
        immediately from the real model used everywhere else in this app - a receipt or an inbound transfer often
        pushes an item&apos;s risk UP, not down, since ordering or receiving more of something already slow-moving is
        exactly the situation this project exists to catch. Same-state transfer matching itself is a separate,
        batched calculation and doesn&apos;t re-run live against a fresh receipt or transfer; a newly-Critical item
        shows up correctly on the risk board right away, but it only gets a real new transfer candidate on the next
        model run.
      </p>
    </div>
  );
}
