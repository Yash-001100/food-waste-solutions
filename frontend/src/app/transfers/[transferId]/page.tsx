"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError, StockTransfer } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatUSD } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  in_transit: "In transit",
  received: "Received",
  cancelled: "Cancelled",
};

/**
 * A printable receipt for one store-to-store transfer - the paper trail an
 * associate on either end can point to, built entirely from the same real
 * stock_transfers row and transfer_allocations economics already shown on
 * the Transfers and Receive Stock pages (see backend/app/routers/transfers.py's
 * get_transfer). Viewable by anyone signed in, since the underlying GET is
 * public like every other read in this app; only Confirm/Cancel below are
 * gated to the right store.
 */
export default function TransferReceiptPage() {
  const params = useParams<{ transferId: string }>();
  const transferId = Number(params.transferId);
  const { user, token } = useAuth();
  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // What the destination is about to confirm actually arrived - a string so
  // the field can be blanked while typing. Set from transfer.qty once it
  // loads (see the effect below), so it starts as "everything shipped".
  const [confirmQty, setConfirmQty] = useState<string>("");

  function load() {
    api
      .getTransfer(transferId)
      .then(setTransfer)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this transfer."));
  }

  useEffect(() => {
    if (!Number.isFinite(transferId)) {
      setError("That's not a valid transfer id.");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferId]);

  useEffect(() => {
    if (transfer && transfer.status === "in_transit") setConfirmQty(String(transfer.qty));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfer?.id]);

  async function handleConfirm() {
    if (!token || !transfer) return;
    setActing(true);
    setActionError(null);
    try {
      // Untouched/blank/equal-to-shipped -> confirm the full qty (no
      // override sent); otherwise report the real, lower count that arrived.
      const override =
        confirmQty === "" || Number(confirmQty) === transfer.qty ? undefined : Number(confirmQty);
      setTransfer(await api.confirmTransfer(token, transfer.id, override));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't reach the API.");
    } finally {
      setActing(false);
    }
  }

  async function handleCancel() {
    if (!token || !transfer) return;
    setActing(true);
    setActionError(null);
    try {
      setTransfer(await api.cancelTransfer(token, transfer.id));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't reach the API.");
    } finally {
      setActing(false);
    }
  }

  if (error) {
    return <p className="text-sm text-error">{error}</p>;
  }
  if (!transfer) {
    return <p className="text-sm text-on-surface-variant">Loading...</p>;
  }

  const statusStyle =
    transfer.status === "received"
      ? "bg-secondary-container text-on-secondary-container"
      : transfer.status === "cancelled"
      ? "bg-error-container text-on-error-container"
      : "bg-surface-container text-on-surface";

  const canConfirm = transfer.status === "in_transit" && user?.store === transfer.destination_store;
  const canCancel = transfer.status === "in_transit" && user?.store === transfer.origin_store;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between print:hidden">
        {user && (
          <Link href={`/stores/${user.store}/transfers`} className="text-sm font-medium text-primary hover:underline">
            ← Back to transfers
          </Link>
        )}
        <button
          onClick={() => window.print()}
          className="ml-auto rounded-md border border-outline-variant px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-on-surface-variant hover:border-primary hover:text-primary"
        >
          Print
        </button>
      </div>

      <div className="rounded-lg border border-outline-variant bg-surface p-6">
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant pb-4">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 22 }}>
              eco
            </span>
            <div>
              <p className="text-xs uppercase tracking-wide text-on-surface-variant">Transfer receipt</p>
              <h1 className="text-2xl font-bold text-on-surface">#{transfer.id}</h1>
            </div>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle}`}>
            {STATUS_LABEL[transfer.status] ?? transfer.status}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-on-surface-variant">Item</p>
            <p className="mt-0.5 font-semibold text-on-surface">{transfer.product_name}</p>
            <p className="text-xs text-on-surface-variant">{transfer.barcode ?? transfer.item_id}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-on-surface-variant">Quantity &amp; value</p>
            <p className="mt-0.5 font-semibold tabular-nums text-on-surface">{transfer.qty.toLocaleString()} units shipped</p>
            {transfer.item_value != null && (
              <p className="text-xs tabular-nums text-on-surface-variant">
                {formatUSD(transfer.item_value)} at {formatUSD(transfer.full_price ?? 0)} each
              </p>
            )}
            {transfer.qty_confirmed != null && transfer.qty_confirmed < transfer.qty && (
              <p className="mt-1 text-xs font-medium text-error">
                Only {transfer.qty_confirmed.toLocaleString()} confirmed received -{" "}
                {(transfer.qty - transfer.qty_confirmed).toLocaleString()} lost in transit
              </p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-on-surface-variant">Route</p>
            <p className="mt-0.5 flex items-center gap-1.5 font-semibold text-on-surface">
              {transfer.origin_store}
              <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 16 }}>
                arrow_forward
              </span>
              {transfer.destination_store}
            </p>
            {transfer.distance_miles != null && (
              <p className="text-xs tabular-nums text-on-surface-variant">
                {transfer.distance_miles.toLocaleString()} mi
                {transfer.shipment_cost != null && ` · ${formatUSD(transfer.shipment_cost)} shipment`}
              </p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-on-surface-variant">Timeline</p>
            <p className="mt-0.5 text-sm text-on-surface">
              Shipped by <span className="font-semibold">{transfer.shipped_by}</span>
              <br />
              <span className="text-xs text-on-surface-variant">{transfer.shipped_at.split(".")[0]}</span>
            </p>
            <p className="mt-2 text-sm">
              {transfer.status === "received" ? (
                <>
                  Received by <span className="font-semibold text-on-surface">{transfer.received_by}</span>
                  {" "}
                  {transfer.qty_confirmed != null && (
                    <span className="tabular-nums">({transfer.qty_confirmed.toLocaleString()} confirmed)</span>
                  )}
                  <br />
                  <span className="text-xs text-on-surface-variant">{transfer.received_at?.split(".")[0]}</span>
                </>
              ) : transfer.status === "cancelled" ? (
                <span className="font-medium text-error">Cancelled before it was received</span>
              ) : (
                <span className="text-on-surface-variant">Awaiting confirmation at {transfer.destination_store}</span>
              )}
            </p>
          </div>
        </div>

        <p className="mt-6 border-t border-outline-variant pt-4 text-xs text-on-surface-variant">
          Item, quantity, and route come straight from the model&apos;s own recommended transfer lane for this
          shipment, not typed in by hand - the same numbers the Transfers page showed before this was ever shipped.
          Value is this shipment&apos;s real quantity at the item&apos;s real full price.
        </p>
      </div>

      {(canConfirm || canCancel) && (
        <div className="print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            {canConfirm && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                  Actually received
                  <input
                    type="number"
                    min={0}
                    max={transfer.qty}
                    value={confirmQty}
                    onChange={(e) => setConfirmQty(e.target.value)}
                    className="w-20 rounded-md border border-outline-variant bg-surface px-2 py-1 text-right text-xs tabular-nums text-on-surface"
                  />
                  <span>/ {transfer.qty.toLocaleString()}</span>
                </label>
                <button
                  onClick={handleConfirm}
                  disabled={acting}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {acting ? "Confirming..." : "Confirm receipt"}
                </button>
              </>
            )}
            {canCancel && (
              <button
                onClick={handleCancel}
                disabled={acting}
                className="rounded-md border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant hover:border-error hover:text-error disabled:opacity-50"
              >
                {acting ? "Cancelling..." : "Cancel shipment"}
              </button>
            )}
          </div>
          {actionError && <p className="mt-2 text-sm text-error">{actionError}</p>}
        </div>
      )}
    </div>
  );
}
