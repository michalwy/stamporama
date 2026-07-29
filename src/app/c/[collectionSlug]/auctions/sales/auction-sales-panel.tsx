"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { STICKY_TOOLBAR_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import {
  AUCTION_SALE_STATUSES,
  AUCTION_SALE_STATUS_LABEL,
  type AuctionSaleStatus,
} from "@/lib/auction-rules";
import { useAuctionSales, useInvalidateAuctions, type AuctionSaleView } from "../use-auctions-query";
import { AuctionSaleFormDialog } from "../auction-sale-form-dialog";
import { AuctionSaleRow } from "./auction-sale-row";
import { CONTROL_STYLE, FilterChip } from "../auction-controls";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; sale: AuctionSaleView }
  | { kind: "delete"; sale: AuctionSaleView };

interface AuctionSalesPanelProps {
  collectionId: string;
  collectionSlug: string;
}

/**
 * The sale list — one row per settlement, for paying for parcels rather than for browsing.
 *
 * It leads with the **all-in total**: what leaves the bank account for this parcel, premium and
 * shipping included, over the lots that are actually payable (`watching` + `won`). A lot that was
 * lost costs nothing, so counting it here could only distort the figure the collector is deciding
 * against.
 */
export function AuctionSalesPanel({ collectionId, collectionSlug }: AuctionSalesPanelProps) {
  const router = useRouter();
  const [status, setStatus] = useState<AuctionSaleStatus | undefined>();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateAuctions();
  const { data: sales = [], isLoading } = useAuctionSales(collectionId, status);

  function closeDialog() {
    if (!isPending) {
      setDialog({ kind: "none" });
      setActionError(undefined);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      <div
        style={{
          ...STICKY_TOOLBAR_STYLE,
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          padding: "0.5rem 0",
          background: "var(--color-bg-page)",
        }}
      >
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
          {AUCTION_SALE_STATUSES.map((value) => (
            <FilterChip
              key={value}
              label={AUCTION_SALE_STATUS_LABEL[value]}
              active={status === value}
              onClick={() => setStatus(status === value ? undefined : value)}
            />
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {actionError && (
            <span style={{ fontSize: "0.8125rem", color: "var(--color-error)" }}>{actionError}</span>
          )}
          <button
            type="button"
            onClick={() => setDialog({ kind: "add" })}
            style={{
              ...CONTROL_STYLE,
              cursor: "pointer",
              fontWeight: 600,
              color: "#fff",
              background: "var(--color-action-primary)",
              border: "none",
              padding: "0.375rem 0.875rem",
            }}
          >
            New sale
          </button>
        </div>
      </div>

      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          flex: 1,
          minHeight: "20rem",
          background: "var(--color-bg-elevated)",
        }}
      >
        {isLoading && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            Loading sales…
          </div>
        )}

        {!isLoading && sales.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {status
              ? "No sales in this status."
              : "No auction sales yet. One is started for you when you add a lot; create one here when a house sale is known up front."}
          </div>
        )}

        {sales.map((sale, idx) => (
          <AuctionSaleRow
            key={sale.id}
            sale={sale}
            collectionSlug={collectionSlug}
            isLast={idx === sales.length - 1}
            onEdit={(row) => setDialog({ kind: "edit", sale: row })}
            onDelete={(row) => setDialog({ kind: "delete", sale: row })}
          />
        ))}
      </div>

      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <AuctionSaleFormDialog
          mode={dialog.kind}
          collectionId={collectionId}
          sale={dialog.kind === "edit" ? dialog.sale : undefined}
          onClose={closeDialog}
          onSaved={(saleId) => {
            const created = dialog.kind === "add";
            setDialog({ kind: "none" });
            invalidateAll(collectionId);
            // A sale created here is a house sale about to be filled with lots, so go straight to it.
            if (created) router.push(`/c/${collectionSlug}/auctions/sales/${saleId}`);
          }}
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete auction sale"
          message="This removes the settlement record. It holds no lots, so no bidding history is lost."
          actionLabel="Delete sale"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            setActionError(undefined);
            startTransition(async () => {
              const { deleteAuctionSaleAction } = await import("@/app/actions/auctions");
              const result = await deleteAuctionSaleAction(dialog.sale.id);
              if (result.status === "success") {
                setDialog({ kind: "none" });
                invalidateAll(collectionId);
              } else setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}
