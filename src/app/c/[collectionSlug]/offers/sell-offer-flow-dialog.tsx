"use client";

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import { useSellableOffers, useSalesInfinite, useInvalidateSales } from "@/app/c/[collectionSlug]/sales/use-sales-query";
import { useInvalidateOffers } from "./use-offers-query";
import { SaleFormDialog } from "@/app/c/[collectionSlug]/sales/sale-form-dialog";
import { saleStatusChipStyle, saleStatusMeta } from "@/app/c/[collectionSlug]/sales/sale-status";
import { UNSENT_SALE_STATUSES } from "@/lib/sale-status";
import { Icon } from "@/app/icons";
import { useToast } from "@/app/toast-provider";
import { planOfferSale, saleTargetOf, soldIntoSaleMessage } from "@/lib/offer-sale-plan";

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
  /** The offer's short number — what the toast and the list of offers left out name it by. */
  offerNo: number;
  /** The stored listing title, or null — the derived `label` is what the dialog falls back to. */
  name: string | null;
  label: string;
  platformId: string;
  platformName: string;
  price: string;
  currency: string;
  /** The offer's Facebook group, when it is a Facebook offer (#1777): its buyer is then named by their
   *  Facebook profile in the new-sale step. Absent off Facebook. */
  facebookGroupId?: string | null;
  /** Known to have nothing to sell — withdrawn, sold, or no set — when it is one of several ticked
   *  (#2050): named in the dialog as left out, and no part of choosing the sale's platform. */
  closed?: boolean;
}

export interface SellOfferFlowDialogProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  /** Server-computed "today" for the new-sale step's date field. */
  today: string;
  /** The offer being sold — or, from a selection (#2050), the ticked offers, sold into one sale. */
  offers: readonly SellableOfferSubject[];
  /** Sell **one set** of the offer rather than every set it still has (#473). The set is named by
   * its `OfferSet` id and by how it reads on the offer screen; everything else about the flow — the
   * destination picker, the price, the toast — is identical, because selling one set and
   * selling all of them are the same transaction with a different number of lines. Only with one
   * offer. */
  set?: { id: string; label: string };
  /** The offers that went into the sale, once they have — a selection unticks them (#2050). */
  onSold?: (offerIds: string[]) => void;
  onClose: () => void;
}

/**
 * Quick-sell (#225): action that records a sale directly from the Offer list — and from the offer's
 * own detail screen (#390) — without going through the offer's compose screen. Picks a destination — an existing sale already on this
 * offer's platform (in the same currency), or a brand-new one — then adds the offer's still-
 * sellable sets to it at their asking price. Reuses {@link SaleFormDialog} for the new-sale header
 * and `addSaleLinesAction` for the line-add, same as the detail screen's "Add sold sets" flow
 * (ADR-0013), just pre-scoped to one offer instead of a platform-wide picker.
 *
 * A Facebook offer is sold here too, auctions and quick buys alike (#1777): the new sale's buyer is
 * named by their Facebook profile, found or created as `facebook-sales.ts` says, and the sale is in
 * the offer's own currency, which a group may set apart from the platform's.
 *
 * Several ticked offers are sold the same way into **one** sale (#2050), each with every set it still
 * has at its own price; those the sale cannot take — another platform or currency, or nothing left —
 * are named and left out (`offer-sale-plan.ts`).
 *
 * **It never navigates** (#2049): the collector stays where *Sell* was pressed — selling a run of
 * offers down a list, or lot after lot on a post — and a toast names the sale, linking to it.
 *
 * Only sales **still open** are offered to add to (#1950) — *Ordered*, *Paid* or *Packed*, newest
 * first. A sale already sent is never what the collector means, and the old ones buried the open
 * ones; *Show sent sales too* brings them back for the rare correction, and is also what tells the
 * server a sent sale is meant (`toSentSale`), so nothing adds to one by accident.
 */
export function SellOfferFlowDialog({
  collectionId,
  collectionSlug,
  baseCurrency,
  today,
  offers,
  set,
  onSold,
  onClose,
}: SellOfferFlowDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"pick" | "newSaleHeader">("pick");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [showSent, setShowSent] = useState(false);
  const { invalidateAll: invalidateSales } = useInvalidateSales();
  const { invalidateAll: invalidateOffers } = useInvalidateOffers();

  const target = useMemo(() => saleTargetOf(offers), [offers]);
  const { data: sellableOffers = [], isLoading: loadingSets } = useSellableOffers(
    collectionId,
    target?.platformId,
    target !== null
  );
  const { data: salesPages, isLoading: loadingSales } = useSalesInfinite(collectionId, {
    platformId: target?.platformId,
    // The list's own order is newest first; with the switch off it holds only unsent sales.
    statuses: showSent ? undefined : [...UNSENT_SALE_STATUSES],
  });
  const existingSales = useMemo(
    () => (salesPages?.pages.flatMap((p) => p.items) ?? []).filter((s) => s.currency === target?.currency),
    [salesPages, target?.currency]
  );

  const setId = set?.id ?? null;
  // Scoped to one set when the flow was opened from a set (#473); otherwise every set each offer
  // still has to sell, which is what the offer-level action has always meant.
  const plan = useMemo(
    () =>
      planOfferSale(
        offers,
        target,
        new Map(sellableOffers.map((o) => [o.offerId, o.sets])),
        setId
      ),
    [offers, target, sellableOffers, setId]
  );
  const { lines, sold, skipped } = plan;
  const several = offers.length > 1;
  const single = offers[0];
  const platformName = target?.platformName ?? single?.platformName ?? "";
  const currency = target?.currency ?? single?.currency ?? "";

  /** Add the lines, then stay: the offers redraw sold and a toast leads to the sale (#2049). Returns
   *  why the sets could not be added, or null once they are. */
  async function addLinesTo(saleId: string): Promise<string | null> {
    const { addSaleLinesAction } = await import("@/app/actions/sales");
    const result = await addSaleLinesAction(saleId, lines, { toSentSale: showSent });
    invalidateSales(collectionId);
    invalidateOffers(collectionId);
    if (result.status !== "success") return result.message;
    onSold?.(sold.map((o) => o.id));
    toast({
      message: soldIntoSaleMessage({
        offerNos: sold.map((o) => o.offerNo),
        oneSet: setId !== null,
        saleNo: result.saleNo,
        buyerName: result.buyerName,
      }),
      href: `/c/${collectionSlug}/sales/${saleId}`,
      linkLabel: "Open sale",
    });
    onClose();
    return null;
  }

  function sellToExisting(saleId: string) {
    setError(undefined);
    startTransition(async () => {
      const failed = await addLinesTo(saleId);
      if (failed) setError(failed);
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
        initialPlatform={{ id: target?.platformId ?? "", name: platformName, platformCurrency: currency }}
        platformLocked
        buyerByFacebookProfile={sold.some((o) => !!o.facebookGroupId)}
        isPending={isPending}
        error={error}
        onClose={() => {
          if (!isPending) setStep("pick");
        }}
        onSubmit={(raw) => {
          setError(undefined);
          startTransition(async () => {
            const { createSaleAction } = await import("@/app/actions/sales");
            // Every offer sold shares the sale's currency, so any of them says what it is (#1777).
            const created = await createSaleAction(collectionId, raw, { forOfferId: sold[0]?.id });
            if (created.status !== "success") {
              setError(created.message);
              return;
            }
            const failed = await addLinesTo(created.id);
            if (!failed) return;
            // The sale header exists even though the line-add failed — the dialog has no form left
            // that could fix it, so say so with a link to the sale, where the sets can be added.
            toast({
              message: `The sale was started, but its sets could not be added: ${failed}`,
              tone: "error",
              href: `/c/${collectionSlug}/sales/${created.id}`,
              linkLabel: "Open sale",
            });
            onClose();
          });
        }}
      />,
      document.body
    );
  }

  const noSets = !loadingSets && lines.length === 0;

  return createPortal(
    <DialogShell
      title={set ? "Sell set" : several ? `Sell ${offers.length} offers` : "Sell"}
      onClose={onClose}
      minHeight="18rem"
      maxWidth="30rem"
    >
      <DialogBody>
        {several ? (
          <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
            Record one sale for the ticked offers — every set each still has, at its own price. Add
            them to an open sale on {platformName}, or start a new one.
          </p>
        ) : (
          <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
            Record a sale for{" "}
            <strong>{set ? set.label : (single.name ?? single.label)}</strong>
            {set && <> from <strong>{single.name ?? single.label}</strong></>} — add it to an open
            sale on {platformName}, or start a new one.
          </p>
        )}

        {/* What a selection cannot sell, named one per line (#2050) — a run reports its refusals per
            offer. Only once the sets are read: until then every offer would look empty. */}
        {several && !loadingSets && skipped.length > 0 && (
          <div
            role="status"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
              margin: "0 0 1rem",
              fontSize: "0.8125rem",
              color: "var(--color-warning)",
            }}
          >
            {skipped.map(({ offer, reason }) => (
              <span key={offer.id}>
                Offer #{offer.offerNo} {reason} — not sold.
              </span>
            ))}
          </div>
        )}

        {noSets ? (
          <p style={{ fontSize: "0.875rem", color: MUTED }}>
            {set
              ? "This set has already sold."
              : several
                ? "None of the ticked offers can be sold."
                : "Nothing left to sell on this offer — every set has already sold."}
          </p>
        ) : (
          <>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                margin: "0 0 0.5rem",
                fontSize: "0.8125rem",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showSent}
                disabled={isPending}
                onChange={(e) => setShowSent(e.target.checked)}
              />
              Show sent sales too
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {loadingSales ? (
                <p style={{ fontSize: "0.8125rem", color: MUTED, margin: 0 }}>Loading sales…</p>
              ) : existingSales.length === 0 ? (
                <p style={{ fontSize: "0.8125rem", color: MUTED, margin: 0 }}>
                  {showSent
                    ? `No existing sale on ${platformName} in ${currency} yet.`
                    : `No open sale on ${platformName} in ${currency}.`}
                </p>
              ) : (
                existingSales.map((s) => {
                  const status = saleStatusMeta(s.status);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={isPending || loadingSets}
                      onClick={() => sellToExisting(s.id)}
                      style={{ ...ROW_STYLE, opacity: isPending ? 0.6 : 1 }}
                    >
                      <span>
                        {s.buyerName ?? "Unknown buyer"}
                        {s.externalRef ? ` · ${s.externalRef}` : ""}
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
      <DialogFooter error={error}>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
