"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import { SaleFormDialog } from "@/app/c/[collectionSlug]/sales/sale-form-dialog";
import { useInvalidateSales } from "@/app/c/[collectionSlug]/sales/use-sales-query";
import { useInvalidateOffers } from "../use-offers-query";
import { recordAllegroOrderSaleAction } from "@/app/actions/allegro";
import { CUSTOM_SHIPPING_METHOD } from "@/lib/sale-rules";
import type { AllegroSalePrefill, AllegroSaleLineInput } from "@/lib/allegro-sale";
import type { SaleHeaderRaw } from "@/app/actions/sales";
import type { WorklistOrder } from "@/lib/allegro-worklist";

/**
 * An Allegro order becoming a sale (#463).
 *
 * Two steps, and the first one is the point of the whole dialog: **what would be written**, said
 * before anything is. The order's own figures fill the sale form behind it, but a form does not show
 * which copies leave the collection — so the review lists every line, what it will record, and, in
 * the collector's own terms, why any of them will not be. A line this app is not sure about is named
 * and left out; it is never guessed at, because a wrong composition is worse than none (#355).
 *
 * The second step is the ordinary {@link SaleFormDialog}, pre-filled. Deliberately the same form the
 * sale is recorded on everywhere else — a pre-fill is a head start, not a separate way of recording
 * a sale — and nothing is saved until the collector presses its own Save.
 *
 * Where a sale already claims this order (the partially recorded case), there is no header step at
 * all: that sale's header is the collector's own record, and this only adds the lines it is missing.
 */

const MUTED = "var(--color-text-muted)";

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "0.75rem",
  padding: "0.5rem 0",
  borderTop: "1px solid var(--color-border)",
  fontSize: "0.8125rem",
};

/** Why a line is being left out, in the collector's terms rather than the domain's tokens. */
const SKIP_REASON: Record<string, { label: string; hint: string }> = {
  unmatched: {
    label: "No offer here",
    hint: "No offer in this collection is tied to that Allegro listing. Paste the listing's address into the offer's Listing URL and sync again.",
  },
  "sold-out": {
    label: "Nothing left to sell",
    hint: "The matched offer has no set left — it has already been recorded as sold, here or on another sale.",
  },
  recorded: {
    label: "Already on the sale",
    hint: "This line is already recorded on the sale carrying this order number.",
  },
  ambiguous: {
    label: "Needs you",
    hint: "The quantity bought does not say which of the offer's remaining sets went. Record this one from the offer's own screen.",
  },
};

function usePrefill(collectionId: string, orderId: string) {
  return useQuery<AllegroSalePrefill>({
    queryKey: ["allegro-sale-prefill", collectionId, orderId],
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/allegro/sale-prefill?orderId=${encodeURIComponent(orderId)}`
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "The order could not be read.");
      }
      return res.json();
    },
    // The live read of the order is the freshest thing in the dialog; re-running it because a window
    // regained focus would spend the collector's Allegro quota on a dialog already open.
    refetchOnWindowFocus: false,
  });
}

export function RecordOrderSaleDialog({
  collectionId,
  collectionSlug,
  baseCurrency,
  today,
  order,
  onClose,
}: {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  today: string;
  order: WorklistOrder;
  onClose: () => void;
}) {
  const router = useRouter();
  const { data: prefill, isLoading, error } = usePrefill(collectionId, order.orderId);
  const [step, setStep] = useState<"review" | "header">("review");
  const [isPending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | undefined>();
  const { invalidateAll: invalidateSales } = useInvalidateSales();
  const { invalidateAll: invalidateOffers } = useInvalidateOffers();

  /** The sets that will actually be recorded, flattened out of the lines. */
  const lines: AllegroSaleLineInput[] = useMemo(
    () =>
      (prefill?.lines ?? []).flatMap((line) =>
        line.offer
          ? line.sets.map((set) => ({
              offerId: line.offer!.id,
              offerSetId: set.offerSetId,
              price: set.price,
              itemIds: set.itemIds,
            }))
          : []
      ),
    [prefill]
  );

  /** The sum of what is being recorded — the sale's gross, which is what the form derives buyer
   *  handling from when the total the buyer paid is the anchor (#205). */
  const gross = useMemo(
    () => lines.reduce((sum, line) => sum + Number(line.price), 0).toFixed(2),
    [lines]
  );

  function record(raw: SaleHeaderRaw, details: { email: string | null; fullName: string | null }) {
    setFailure(undefined);
    startTransition(async () => {
      const result = await recordAllegroOrderSaleAction(
        collectionId,
        order.orderId,
        raw,
        lines,
        details
      );
      if (result.status === "error") {
        setFailure(result.message);
        return;
      }
      invalidateSales(collectionId);
      invalidateOffers(collectionId);
      // The sale's own screen is where a sale is finished — and where the collector sees the lines
      // that did go on when some did not.
      router.push(`/c/${collectionSlug}/sales/${result.saleId}`);
      onClose();
    });
  }

  if (typeof document === "undefined") return null;

  if (step === "header" && prefill) {
    return createPortal(
      <SaleFormDialog
        mode="add"
        collectionId={collectionId}
        baseCurrency={baseCurrency}
        today={today}
        initial={{
          platformId: prefill.platform?.id ?? "",
          platformName: prefill.platform?.name ?? "",
          buyerId: prefill.buyer.contactId,
          buyerName: prefill.buyer.name,
          externalRef: prefill.orderId,
          transactionUrl: prefill.orderUrl,
          soldAt: prefill.soldAt,
          currency: prefill.currency,
          // The order's total is the anchor (#205): it is what actually changed hands, delivery
          // included, so handling is derived from it rather than typed alongside it.
          buyerHandling: "",
          buyerPaidTotal: prefill.totalPaid,
          commission: "",
          shippingMethodId: prefill.shipping
            ? (prefill.shipping.methodId ?? CUSTOM_SHIPPING_METHOD)
            : "",
          shippingMethodName: prefill.shipping?.methodName ?? "",
          shippingCost: prefill.shipping?.cost ?? "",
          shippingCurrency: prefill.shipping?.currency ?? "",
        }}
        initialPlatform={
          prefill.platform
            ? {
                id: prefill.platform.id,
                name: prefill.platform.name,
                platformCurrency: prefill.platform.platformCurrency,
              }
            : undefined
        }
        platformLocked
        grossProceeds={gross}
        isPending={isPending}
        error={failure}
        onClose={() => {
          if (!isPending) setStep("review");
        }}
        onSubmit={(raw) =>
          record(raw, { email: prefill.buyer.email, fullName: prefill.buyer.fullName })
        }
      />,
      document.body
    );
  }

  const existing = prefill?.existingSale ?? null;

  return createPortal(
    <DialogShell
      title="Record sale from order"
      onClose={onClose}
      minHeight="20rem"
      maxWidth="34rem"
    >
      <DialogBody>
        {isLoading ? (
          <p style={{ fontSize: "0.875rem", color: MUTED, margin: 0 }}>Reading the order…</p>
        ) : error || !prefill ? (
          <p style={{ fontSize: "0.875rem", color: "var(--color-error)", margin: 0 }}>
            {error instanceof Error ? error.message : "The order could not be read."}
          </p>
        ) : (
          <>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
              {existing ? (
                <>
                  Order <strong>{prefill.orderId}</strong> is already recorded as sale{" "}
                  <strong>#{existing.saleNo}</strong>. This adds the {lines.length} set
                  {lines.length === 1 ? "" : "s"} it is still missing — nothing else about that sale
                  is touched.
                </>
              ) : (
                <>
                  Order <strong>{prefill.orderId}</strong>, bought{" "}
                  {new Date(prefill.boughtAt).toLocaleDateString()}. Nothing is written until you
                  save the sale on the next step.
                </>
              )}
            </p>

            {/* What the order says about itself, and so what the sale will open with. */}
            {!existing && (
              <dl
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "0.25rem 0.75rem",
                  margin: "0 0 0.75rem",
                  fontSize: "0.8125rem",
                }}
              >
                {/* The buyer is filed under their **Allegro login** — that is how buyers are named
                    in this address book, and filing them under the name on the order would miss the
                    contact already there and quietly make a second one for the same person. The
                    order's name is not lost: it goes to the contact's Full name, which is what the
                    parcel has to carry. */}
                <Term>Buyer</Term>
                <Detail>
                  {prefill.buyer.name ? (
                    <>
                      {prefill.buyer.name}
                      {prefill.buyer.contactId ? (
                        <span style={{ color: MUTED }}>
                          {prefill.buyer.matchedBy === "full-name"
                            ? " · an existing contact, found by their full name"
                            : " · an existing contact"}
                        </span>
                      ) : (
                        <span style={{ color: MUTED }}> · will be added as a new contact</span>
                      )}
                      {prefill.buyer.fullName && (
                        <div style={{ color: MUTED, fontSize: "0.75rem" }}>
                          {prefill.buyer.fullName} — kept as their full name
                          {prefill.buyer.contactId ? ", if they have none recorded" : ""}
                        </div>
                      )}
                    </>
                  ) : (
                    <span style={{ color: MUTED }}>not stated — the sale will be anonymous</span>
                  )}
                </Detail>

                <Term>Paid</Term>
                <Detail>
                  {prefill.totalPaid ? (
                    <>
                      {prefill.totalPaid} {prefill.currency}{" "}
                      <span style={{ color: MUTED }}>in total, delivery included</span>
                    </>
                  ) : (
                    <span style={{ color: MUTED }}>Allegro stated no total</span>
                  )}
                  {prefill.paymentStatus === "paid" ? (
                    <span style={{ color: MUTED }}> · the sale will be recorded as paid</span>
                  ) : (
                    <span style={{ color: MUTED }}> · not paid yet, so the sale starts at ordered</span>
                  )}
                </Detail>

                <Term>Shipping</Term>
                <Detail>
                  {prefill.shipping ? (
                    <>
                      {prefill.shipping.methodName}
                      {prefill.shipping.methodId ? (
                        <span style={{ color: MUTED }}> · from this platform&apos;s methods</span>
                      ) : (
                        <span style={{ color: MUTED }}>
                          {" "}
                          · not in this platform&apos;s methods, so it is recorded as a one-off
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ color: MUTED }}>no delivery method on the order</span>
                  )}
                </Detail>
              </dl>
            )}

            {/* The live read is what carries the delivery method and the buyer's email; without it
                the rest of the prefill still stands, and saying so is better than a quietly
                thinner form. */}
            {prefill.liveReadError && (
              <p
                style={{
                  margin: "0 0 0.75rem",
                  fontSize: "0.75rem",
                  color: "var(--color-warning)",
                }}
              >
                Allegro could not be read just now ({prefill.liveReadError}) — the delivery method and
                the buyer&apos;s email are missing from this pre-fill. Everything else comes from the
                last sync, and you can fill the rest in by hand.
              </p>
            )}

            {!prefill.platform && (
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.75rem", color: "var(--color-warning)" }}>
                No platform here is marked as Allegro, so no offer can be recorded as sold. Set one
                under Settings → Allegro.
              </p>
            )}

            <div style={{ marginTop: "0.25rem" }}>
              {prefill.lines.map((line) => {
                const skip = line.skipped ? SKIP_REASON[line.skipped] : null;
                return (
                  <div key={line.lineId} style={ROW}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{line.title}</div>
                      <div style={{ color: MUTED, fontSize: "0.75rem" }}>
                        {line.quantity} × {line.unitPrice} {line.currency}
                        {line.offer ? ` · #${line.offer.offerNo} ${line.offer.label}` : ""}
                      </div>
                      {/* Named one by one: these are the copies that leave the collection, and the
                          collector is agreeing to exactly them. */}
                      {line.sets.length > 0 && (
                        <ul
                          style={{
                            margin: "0.25rem 0 0",
                            paddingLeft: "1rem",
                            color: "var(--color-text-secondary)",
                            fontSize: "0.75rem",
                          }}
                        >
                          {line.sets.map((set) => (
                            <li key={set.offerSetId}>
                              {set.label} — {set.price} {line.currency}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {skip && (
                      <span
                        title={skip.hint}
                        style={{
                          fontSize: "0.6875rem",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                          padding: "0.125rem 0.375rem",
                          borderRadius: "0.25rem",
                          whiteSpace: "nowrap",
                          color:
                            line.skipped === "recorded" ? "var(--color-success)" : "var(--color-warning)",
                          background:
                            line.skipped === "recorded"
                              ? "var(--color-success-soft)"
                              : "var(--color-warning-soft)",
                        }}
                      >
                        {skip.label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {lines.length === 0 ? (
              <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "var(--color-warning)" }}>
                Nothing on this order can be recorded automatically. Record what sold from the
                offer&apos;s own screen — the lines above say what is in the way.
              </p>
            ) : (
              <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: MUTED }}>
                {lines.length} set{lines.length === 1 ? "" : "s"} will be recorded as sold, for{" "}
                {gross} {prefill.currency} in total.
              </p>
            )}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        {failure && <ErrorBubble>{failure}</ErrorBubble>}
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        {existing ? (
          <DialogPrimaryButton
            type="button"
            onClick={() =>
              // The existing sale's header is left exactly as the collector recorded it, so nothing
              // here resolves a buyer or a platform: only the missing lines go on.
              record(
                {
                  platformId: prefill?.platform?.id ?? null,
                  platformName: null,
                  buyerId: null,
                  buyerName: null,
                  externalRef: prefill?.orderId ?? "",
                  transactionUrl: "",
                  soldAt: prefill?.soldAt ?? today,
                  currency: prefill?.currency ?? baseCurrency,
                  handlingMode: "total",
                  buyerHandling: "",
                  buyerPaidTotal: "",
                  commission: "",
                },
                { email: null, fullName: null }
              )
            }
            disabled={isPending || lines.length === 0}
          >
            {isPending ? "Adding…" : `Add to sale #${existing.saleNo}`}
          </DialogPrimaryButton>
        ) : (
          <DialogPrimaryButton
            type="button"
            onClick={() => setStep("header")}
            disabled={isPending || isLoading || lines.length === 0}
          >
            Review sale details
          </DialogPrimaryButton>
        )}
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return <dt style={{ color: MUTED }}>{children}</dt>;
}

function Detail({ children }: { children: React.ReactNode }) {
  return <dd style={{ margin: 0 }}>{children}</dd>;
}
