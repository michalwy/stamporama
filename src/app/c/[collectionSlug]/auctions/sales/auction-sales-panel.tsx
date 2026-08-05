"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { STICKY_TOOLBAR_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import {
  ListSearchBox,
  useDebouncedSearch,
} from "@/app/c/[collectionSlug]/shared/list-search-box";
import {
  AUCTION_SALE_STATUSES,
  AUCTION_SALE_STATUS_LABEL,
  isAuctionSaleStatus,
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
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateAuctions();

  // Both selections are remembered per collection (#496) with the URL winning whenever it carries
  // one — the lot list's rule (#325/#351), so a shared link still means exactly what it says. Until
  // now the status lived in `useState` and was lost on every navigation away from the screen, which
  // on a settlement list is the wrong default: "what do I still owe for" is the question one comes
  // back to, not one asked once.
  const [storedStatus, rememberStatus] = usePersistedCollectionValue(
    "auction-sale-status",
    collectionId
  );
  const [storedSearch, rememberSearch] = usePersistedCollectionValue(
    "auction-sale-search",
    collectionId
  );

  const statusRaw = searchParams.has("status")
    ? (searchParams.get("status") ?? "")
    : (storedStatus ?? "");
  const status = isAuctionSaleStatus(statusRaw) ? statusRaw : undefined;
  const search = (searchParams.has("search") ? searchParams.get("search") : storedSearch) || "";

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/auctions/sales${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const [localSearch, setLocalSearch] = useDebouncedSearch(search, (value) => {
    rememberSearch(value);
    updateParams({ search: value });
  });

  const { data: sales = [], isLoading } = useAuctionSales(
    collectionId,
    status,
    search || undefined
  );

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
          {/* Find one settlement by what it is called or who it is with (#484). A sale's identifier
              is part of its name, so `Köhler 385` is found by either half of it. */}
          <ListSearchBox
            value={localSearch}
            onChange={setLocalSearch}
            placeholder="Search sale, seller, platform…"
            label="Search sales"
            width="16rem"
          />
          <span
            style={{
              width: "1px",
              height: "1.25rem",
              background: "var(--color-border)",
              margin: "0 0.25rem",
            }}
          />
          {AUCTION_SALE_STATUSES.map((value) => (
            <FilterChip
              key={value}
              label={AUCTION_SALE_STATUS_LABEL[value]}
              active={status === value}
              onClick={() => {
                const next = status === value ? "" : value;
                rememberStatus(next);
                updateParams({ status: next });
              }}
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
            {search
              ? "No sales match your search."
              : status
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
