"use client";

import { useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import type { LinkableSale, WorklistOrder } from "@/lib/allegro-worklist";
import { linkAllegroOrderToSaleAction } from "@/app/actions/allegro";
import { formatDay } from "@/app/c/[collectionSlug]/auctions/auction-format";

/**
 * Point a synced Allegro order at a sale that is **already recorded** (#479).
 *
 * The worklist drops an order the moment a `Sale` carries its id as `externalRef`. That works by
 * itself for a sale recorded from this screen and not at all for one recorded before the sync
 * existed — the two are the same transaction and neither knows about the other. This is the manual
 * fix (copy the order number, open the sale, edit the header, paste) turned into one click.
 *
 * The picker offers **only sales with no order number**: one that already names an order is spoken
 * for, and offering it would be offering to overwrite a link somebody made. Each row shows the date,
 * the total and the buyer, because that is what tells two sales a day apart from each other without
 * opening both.
 */

const MUTED = "var(--color-text-muted)";

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  width: "100%",
  padding: "0.625rem 0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
};

export function LinkSaleDialog({
  collectionId,
  order,
  onClose,
  onLinked,
}: {
  collectionId: string;
  order: WorklistOrder;
  onClose: () => void;
  /** Called after a successful link, so the worklist re-reads and the row leaves the list. */
  onLinked: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  const { data: candidates = [], isLoading } = useQuery<LinkableSale[]>({
    queryKey: ["allegro-link-candidates", collectionId, order.orderId],
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/allegro/link-candidates?orderId=${encodeURIComponent(order.orderId)}`
      );
      if (!res.ok) throw new Error("Failed to load candidate sales");
      return (await res.json()).items;
    },
  });

  function link(saleId: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await linkAllegroOrderToSaleAction(collectionId, order.orderId, saleId);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      onLinked();
      onClose();
    });
  }

  return (
    <DialogShell title="Link to an existing sale" onClose={onClose} maxWidth="34rem">
      <DialogBody>
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: MUTED, lineHeight: 1.5 }}>
          Order <strong>{order.orderId}</strong>
          {order.totalPaid ? ` · ${order.totalPaid} ${order.currency}` : ""}
          {order.buyerLogin ? ` · ${order.buyerLogin}` : ""}. Choosing a sale writes this order
          number onto it — nothing else about the sale is touched.
        </p>

        {error && <ErrorBubble>{error}</ErrorBubble>}

        {isLoading ? (
          <p style={{ color: MUTED, fontSize: "0.875rem" }}>Loading…</p>
        ) : candidates.length === 0 ? (
          // Two reasons land here and the collector cannot tell them apart from the outside, so the
          // message names both rather than saying "none found".
          <p style={{ color: MUTED, fontSize: "0.8125rem", lineHeight: 1.5, margin: 0 }}>
            No sale is available to link. Either every sale near this order&rsquo;s date already
            carries an order number, or the sale has not been recorded yet — in which case{" "}
            <strong>Record sale</strong> on the row is what you want.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {candidates.map((sale) => (
              <button
                key={sale.id}
                type="button"
                style={{ ...ROW, opacity: isPending ? 0.6 : 1 }}
                disabled={isPending}
                onClick={() => link(sale.id)}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>Sale #{sale.saleNo}</span>
                  <span style={{ color: MUTED }}>
                    {" "}
                    · {formatDay(sale.soldAt)} · {sale.lineCount} line
                    {sale.lineCount === 1 ? "" : "s"}
                  </span>
                  {sale.buyerName && (
                    <span style={{ display: "block", fontSize: "0.75rem", color: MUTED }}>
                      {sale.buyerName} · {sale.platformName}
                    </span>
                  )}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {sale.total} {sale.currency}
                </span>
              </button>
            ))}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
      </DialogFooter>
    </DialogShell>
  );
}
