"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import { useSalesInfinite, useInvalidateSales } from "@/app/c/[collectionSlug]/sales/use-sales-query";
import { useInvalidateOffers } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { SaleFormDialog } from "@/app/c/[collectionSlug]/sales/sale-form-dialog";
import { saleStatusChipStyle, saleStatusMeta } from "@/app/c/[collectionSlug]/sales/sale-status";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { UNSENT_SALE_STATUSES } from "@/lib/sale-status";
import { Icon } from "@/app/icons";
import { useInvalidateInventory } from "./use-inventory-query";

const MUTED = "var(--color-text-muted)";

const ROW_STYLE: React.CSSProperties = {
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

const PRICE_STYLE: React.CSSProperties = {
  width: "7rem",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  textAlign: "right",
};

function todayIso(): string {
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tz).toISOString().slice(0, 10);
}

/**
 * *Sell…* on Copies (#2021): the ticked copies, which are on no offer — or on one that does not
 * matter here — sold as **one set** with one price, into an open sale or a new one. No offer is made
 * for them.
 *
 * The offer's *Sell* dialog in shape (`sell-offer-flow-dialog.tsx`) — the open sales as rows to press,
 * newest first, and *Create new sale* under them — with the price on top, since there is no offer to
 * take one from: it starts empty and has to be typed before anything can be pressed. The sales are
 * every platform's, because these copies were never listed anywhere; each row says its platform and
 * the currency the price will be in. Only sales **still open** are offered (#1950): a sent parcel has
 * gone. A new sale's platform decides its currency, as it always does.
 */
export function SellCopiesDialog({
  collectionId,
  collectionSlug,
  baseCurrency,
  itemIds,
  onSold,
  onClose,
}: {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  /** The copies to sell — the ticked copies in view that are in stock (`isInStockForSale`). */
  itemIds: string[];
  /** The copies are on the sale — the list's ticks on them have nothing left to do. */
  onSold: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"pick" | "newSaleHeader">("pick");
  const [price, setPrice] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const { invalidateAll: invalidateSales } = useInvalidateSales();
  const { invalidateAll: invalidateOffers } = useInvalidateOffers();
  const { invalidateList } = useInvalidateInventory();

  const {
    data: salesPages,
    isLoading: loadingSales,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useSalesInfinite(collectionId, { statuses: [...UNSENT_SALE_STATUSES] });
  const openSales = useMemo(() => salesPages?.pages.flatMap((p) => p.items) ?? [], [salesPages]);

  const priced = price.trim() !== "";
  const count = itemIds.length;

  function addTo(saleId: string) {
    return import("@/app/actions/sales").then(({ addSaleCopySetAction }) =>
      addSaleCopySetAction(saleId, { itemIds, price })
    );
  }

  function landOn(saleId: string) {
    onSold();
    invalidateSales(collectionId);
    // A copy also held by an offer flags that offer, and the copies leave the list's stock.
    invalidateOffers(collectionId);
    invalidateList(collectionId);
    router.push(`/c/${collectionSlug}/sales/${saleId}`);
    onClose();
  }

  function sellToExisting(saleId: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await addTo(saleId);
      if (result.status === "success") landOn(saleId);
      else setError(result.message);
    });
  }

  if (typeof document === "undefined") return null;

  if (step === "newSaleHeader") {
    return createPortal(
      <SaleFormDialog
        mode="add"
        collectionId={collectionId}
        baseCurrency={baseCurrency}
        today={todayIso()}
        isPending={isPending}
        error={error}
        onClose={() => {
          if (!isPending) {
            setStep("pick");
            setError(undefined);
          }
        }}
        onSubmit={(raw) => {
          setError(undefined);
          startTransition(async () => {
            const { createSaleAction } = await import("@/app/actions/sales");
            const created = await createSaleAction(collectionId, raw);
            if (created.status !== "success") {
              setError(created.message);
              return;
            }
            // The sale exists even if the copies were refused in the meantime — land on it either
            // way, where they can be added again from *Add copies*.
            await addTo(created.id);
            landOn(created.id);
          });
        }}
      />,
      document.body
    );
  }

  return createPortal(
    <DialogShell title="Sell copies" onClose={onClose} minHeight="18rem" maxWidth="34rem">
      <DialogBody>
        <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
          Record <strong>{count === 1 ? "this copy" : `these ${count} copies`}</strong> as sold — one set
          with one price, added to an open sale or a new one. No offer is made for them.
        </p>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            margin: "0 0 1rem",
            fontSize: "0.875rem",
            color: "var(--color-text-secondary)",
          }}
        >
          Price for the set
          <NumericInput
            kind="amount"
            autoFocus
            value={price}
            placeholder="0.00"
            disabled={isPending}
            onChange={(e) => setPrice(e.target.value)}
            style={PRICE_STYLE}
            aria-label="Price for the set"
          />
          <span style={{ fontSize: "0.8125rem", color: MUTED }}>in the sale&apos;s currency</span>
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {loadingSales ? (
            <p style={{ fontSize: "0.8125rem", color: MUTED, margin: 0 }}>Loading sales…</p>
          ) : openSales.length === 0 ? (
            <p style={{ fontSize: "0.8125rem", color: MUTED, margin: 0 }}>No open sale.</p>
          ) : (
            openSales.map((s) => {
              const status = saleStatusMeta(s.status);
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={isPending || !priced}
                  onClick={() => sellToExisting(s.id)}
                  style={{ ...ROW_STYLE, opacity: isPending || !priced ? 0.6 : 1 }}
                >
                  <span style={{ minWidth: 0 }}>
                    {s.buyerName ?? "Unknown buyer"}
                    {s.externalRef ? ` · ${s.externalRef}` : ""}
                    <span style={{ display: "block", fontSize: "0.75rem", color: MUTED }}>
                      {s.platformName} · {s.currency}
                    </span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.75rem", color: MUTED, fontVariantNumeric: "tabular-nums" }}>
                      {new Date(s.soldAt).toLocaleDateString()}
                    </span>
                    <span style={saleStatusChipStyle(status.token)}>{status.label}</span>
                  </span>
                </button>
              );
            })
          )}
          {hasNextPage && (
            <button
              type="button"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
              style={{ ...ROW_STYLE, justifyContent: "center", color: "var(--color-text-secondary)" }}
            >
              {isFetchingNextPage ? "Loading…" : "Show more sales"}
            </button>
          )}
        </div>

        <button
          type="button"
          disabled={isPending || !priced}
          onClick={() => {
            setError(undefined);
            setStep("newSaleHeader");
          }}
          style={{
            ...ROW_STYLE,
            marginTop: "0.75rem",
            justifyContent: "center",
            fontWeight: 600,
            color: "var(--color-accent)",
            opacity: isPending || !priced ? 0.6 : 1,
          }}
        >
          <Icon name="add" size="sm" /> Create new sale
        </button>
      </DialogBody>
      <DialogFooter error={error}>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
