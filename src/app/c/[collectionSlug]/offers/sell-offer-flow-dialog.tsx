"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import type { SaleLineRaw } from "@/app/actions/sales";
import { useSellableOffers, useSalesInfinite, useInvalidateSales } from "@/app/c/[collectionSlug]/sales/use-sales-query";
import { useInvalidateOffers } from "./use-offers-query";
import { SaleFormDialog } from "@/app/c/[collectionSlug]/sales/sale-form-dialog";
import { Icon } from "@/app/icons";

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

/**
 * What the flow needs to know about the offer it is selling — deliberately a structural subset
 * rather than `OfferListItem`, so the offer's own detail screen can open the same dialog off its
 * `OfferDetail` (#390) instead of a second implementation drifting away from this one.
 */
export interface SellableOfferSubject {
  id: string;
  /** The stored listing title, or null — the derived `label` is what the dialog falls back to. */
  name: string | null;
  label: string;
  platformId: string;
  platformName: string;
  price: string;
  currency: string;
}

export interface SellOfferFlowDialogProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  /** Server-computed "today" for the new-sale step's date field. */
  today: string;
  offer: SellableOfferSubject;
  /** Sell **one set** of the offer rather than every set it still has (#473). The set is named by
   * its `OfferSet` id and by how it reads on the offer screen; everything else about the flow — the
   * destination picker, the price, the landing screen — is identical, because selling one set and
   * selling all of them are the same transaction with a different number of lines. */
  set?: { id: string; label: string };
  onClose: () => void;
}

/**
 * Quick-sell (#225): action that records a sale directly from the Offer list — and from the offer's
 * own detail screen (#390) — without going through the offer's compose screen. Picks a destination — an existing sale already on this
 * offer's platform (in the same currency), or a brand-new one — then adds the offer's still-
 * sellable sets to it at their asking price. Reuses {@link SaleFormDialog} for the new-sale header
 * and `addSaleLinesAction` for the line-add, same as the detail screen's "Add sold sets" flow
 * (ADR-0013), just pre-scoped to one offer instead of a platform-wide picker.
 */
export function SellOfferFlowDialog({
  collectionId,
  collectionSlug,
  baseCurrency,
  today,
  offer,
  set,
  onClose,
}: SellOfferFlowDialogProps) {
  const router = useRouter();
  const [step, setStep] = useState<"pick" | "newSaleHeader">("pick");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const { invalidateAll: invalidateSales } = useInvalidateSales();
  const { invalidateAll: invalidateOffers } = useInvalidateOffers();

  const { data: sellableOffers = [], isLoading: loadingSets } = useSellableOffers(
    collectionId,
    offer.platformId,
    true
  );
  const { data: salesPages, isLoading: loadingSales } = useSalesInfinite(collectionId, {
    platformId: offer.platformId,
  });
  const existingSales = useMemo(
    () => (salesPages?.pages.flatMap((p) => p.items) ?? []).filter((s) => s.currency === offer.currency),
    [salesPages, offer.currency]
  );

  const matched = sellableOffers.find((o) => o.offerId === offer.id);
  const setId = set?.id ?? null;
  const lines: SaleLineRaw[] = useMemo(
    () =>
      (matched?.sets ?? [])
        // Scoped to one set when the flow was opened from a set (#473); otherwise every set the
        // offer still has to sell, which is what the offer-level action has always meant.
        .filter((s) => setId === null || s.offerSetId === setId)
        .map((s) => ({
          offerId: offer.id,
          offerSetId: s.offerSetId,
          price: offer.price,
          itemIds: s.itemIds,
        })),
    [matched, offer.id, offer.price, setId]
  );

  function addLinesTo(saleId: string): Promise<{ status: "success" } | { status: "error"; message: string }> {
    return import("@/app/actions/sales").then(({ addSaleLinesAction }) => addSaleLinesAction(saleId, lines));
  }

  function sellToExisting(saleId: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await addLinesTo(saleId);
      if (result.status === "success") {
        invalidateSales(collectionId);
        invalidateOffers(collectionId);
        router.push(`/c/${collectionSlug}/sales/${saleId}`);
        onClose();
      } else {
        setError(result.message);
      }
    });
  }

  if (typeof document === "undefined") return null;

  if (step === "newSaleHeader") {
    return createPortal(
      <SaleFormDialog
        mode="add"
        collectionId={collectionId}
        baseCurrency={baseCurrency}
        today={today}
        initialPlatform={{ id: offer.platformId, name: offer.platformName, platformCurrency: offer.currency }}
        platformLocked
        isPending={isPending}
        error={error}
        onClose={() => {
          if (!isPending) setStep("pick");
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
            const result = await addLinesTo(created.id);
            invalidateSales(collectionId);
            invalidateOffers(collectionId);
            if (result.status !== "success") {
              // The sale header exists even though the line-add failed — land on its detail
              // screen so the collector can add the sold sets manually from there.
              router.push(`/c/${collectionSlug}/sales/${created.id}`);
              onClose();
              return;
            }
            router.push(`/c/${collectionSlug}/sales/${created.id}`);
            onClose();
          });
        }}
      />,
      document.body
    );
  }

  const noSets = !loadingSets && lines.length === 0;

  return createPortal(
    <DialogShell title={set ? "Sell set" : "Sell"} onClose={onClose} minHeight="18rem" maxWidth="30rem">
      <DialogBody>
        <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
          Record a sale for{" "}
          <strong>{set ? set.label : (offer.name ?? offer.label)}</strong>
          {set && <> from <strong>{offer.name ?? offer.label}</strong></>} — add it to an existing
          sale on {offer.platformName}, or start a new one.
        </p>

        {noSets ? (
          <p style={{ fontSize: "0.875rem", color: MUTED }}>
            {set
              ? "This set has already sold."
              : "Nothing left to sell on this offer — every set has already sold."}
          </p>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {loadingSales ? (
                <p style={{ fontSize: "0.8125rem", color: MUTED, margin: 0 }}>Loading sales…</p>
              ) : existingSales.length === 0 ? (
                <p style={{ fontSize: "0.8125rem", color: MUTED, margin: 0 }}>
                  No existing sale on {offer.platformName} in {offer.currency} yet.
                </p>
              ) : (
                existingSales.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={isPending}
                    onClick={() => sellToExisting(s.id)}
                    style={{ ...ROW_STYLE, opacity: isPending ? 0.6 : 1 }}
                  >
                    <span>
                      {s.buyerName ?? "Unknown buyer"}
                      {s.externalRef ? ` · ${s.externalRef}` : ""}
                    </span>
                    <span style={{ fontSize: "0.75rem", color: MUTED, fontVariantNumeric: "tabular-nums" }}>
                      {new Date(s.soldAt).toLocaleDateString()}
                    </span>
                  </button>
                ))
              )}
            </div>

            <button
              type="button"
              disabled={isPending || loadingSets}
              onClick={() => setStep("newSaleHeader")}
              style={{ ...ROW_STYLE, marginTop: "0.75rem", justifyContent: "center", fontWeight: 600, color: "var(--color-accent)" }}
            >
              <Icon name="add" size="sm" /> Create new sale
            </button>
          </>
        )}
      </DialogBody>
      <DialogFooter>
        {error && <ErrorBubble>{error}</ErrorBubble>}
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
