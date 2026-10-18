"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { InlineText } from "@/app/c/[collectionSlug]/shared/inline-text";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { IssueHeader } from "@/lib/issues";
import type { SaleCopyRef, SaleDetail, SaleSuppliesData } from "@/lib/sales";
import type { PackingSupplyData } from "@/lib/packing-supplies";
import { describeUncostedSupplies } from "@/lib/supply-stock";
import type { SaleBuyerMessage } from "@/lib/sale-buyer-message";
import {
  describeEstimated,
  describeLeftOut,
  explainWithoutCost,
  type EstimatedProfitFigures,
} from "@/lib/sale-profit";
import { CopiesWithoutCost } from "./copies-without-cost";
import { COST_ESTIMATE_STYLE } from "@/app/c/[collectionSlug]/shared/cost-estimate-text";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { CUSTOM_SHIPPING_OPTION, shipmentGoingBy } from "@/lib/sale-rules";
import type { ShippingOptionData } from "@/lib/shipping-options";
import type { CarrierData } from "@/lib/carriers";
import { getShippingOptionsAction } from "@/app/actions/shipping-options";
import type { SaleShippingRaw } from "@/app/actions/sales";
import { SaleFormDialog } from "../sale-form-dialog";
import { SentAsSelect, findCarrierService } from "../sent-as-select";
import { AddSaleLineDialog } from "../add-sale-line-dialog";
import { AddCopiesDialog } from "./add-copies-dialog";
import { useInvalidateSales } from "../use-sales-query";
import { SoldUnitsView } from "./sold-units-view";
import { SaleApiReviewChip } from "../sale-review-chip";
import { useToast } from "@/app/toast-provider";
import { ChooseSetDialog } from "./choose-set-dialog";
import { SaleShareDialog } from "./sale-share-dialog";
import { BuyerMessageDialog } from "./buyer-message-dialog";
import { PaidTotalDialog } from "./paid-total-dialog";
import { ShipmentDialog } from "./shipment-dialog";
import { UnpackedCopiesDialog } from "./unpacked-copies-dialog";
import { SaleSuppliesCard } from "./sale-supplies-card";
import { SALE_STATUS_ORDER, SALE_STATUS_META, type SaleStatus } from "../sale-status";
import { asksAboutUnpackedCopies, asksForShipment, isSaleStatus } from "@/lib/sale-status";
import { Icon } from "@/app/icons";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const PRIMARY_BTN: React.CSSProperties = {
  cursor: "pointer",
  fontWeight: 600,
  color: "#fff",
  background: "var(--color-action-primary)",
  border: "none",
  borderRadius: "0.375rem",
  padding: "0.375rem 0.875rem",
  fontSize: "0.8125rem",
};

const SECONDARY_BTN: React.CSSProperties = {
  cursor: "pointer",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  padding: "0.375rem 0.875rem",
  fontSize: "0.8125rem",
};

function todayIso(): string {
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tz).toISOString().slice(0, 10);
}

function formatDate(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** Show an FX rate with up to 6 decimals, trailing zeros trimmed (the stored rate carries full
 * `DECIMAL(65,30)` precision, which is noise on screen). */
function formatRate(rate: string): string {
  return Number(rate)
    .toFixed(6)
    .replace(/\.?0+$/, "");
}

type Dialog =
  | { kind: "none" }
  | { kind: "editHeader" }
  | { kind: "addLines" }
  | { kind: "addCopies" }
  | { kind: "removeLine"; lineId: string; label: string }
  | { kind: "chooseSet"; lineId: string }
  | { kind: "share" }
  | { kind: "buyerMessage" }
  | { kind: "paidTotal" }
  | { kind: "shipment"; mode: "sent" | "edit" }
  | { kind: "unpacked"; next: SaleStatus };

interface SaleDetailPanelProps {
  collectionId: string;
  sale: SaleDetail;
  /** The collection's carriers (#491) — what the shipment dialog picks from. */
  carriers: CarrierData[];
  /** The collection's packing supplies (#1898) — what a supply line of the parcel can name. */
  packingSupplies: PackingSupplyData[];
  /** The message to the buyer rendered for this sale (#1815), or null when its platform has no
   *  template — and then there is no *Message to buyer* at all. */
  buyerMessage: SaleBuyerMessage | null;
  areas: CollectionAreaData[];
  locations: LocationData[];
  issueHeaderById: Record<string, IssueHeader>;
}

export function SaleDetailPanel({
  collectionId,
  sale,
  carriers,
  packingSupplies,
  buyerMessage,
  areas,
  locations,
  issueHeaderById,
}: SaleDetailPanelProps) {
  const router = useRouter();
  const params = useParams<{ collectionSlug: string }>();
  const { invalidateAll } = useInvalidateSales();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [error, setError] = useState<string | undefined>();

  const soldDate = formatDate(sale.soldAt);

  // Fulfillment status controls (#191): the inline select saves immediately; the advance button
  // steps one place along the fixed lifecycle (hidden at the terminal `received`).
  const statusIdx = SALE_STATUS_ORDER.indexOf(sale.status as SaleStatus);
  const nextStatus =
    statusIdx >= 0 && statusIdx < SALE_STATUS_ORDER.length - 1
      ? SALE_STATUS_ORDER[statusIdx + 1]
      : null;
  // "All packed" hint (#192): every copy is packed but the sale hasn't reached `packed` yet. A
  // suggestion only — the collector advances the status manually; it never changes on its own.
  const packedIdx = SALE_STATUS_ORDER.indexOf("packed");
  const showPackedHint = sale.allItemsPacked && statusIdx >= 0 && statusIdx < packedIdx;

  /**
   * The other direction of the same fact (#973): the sale is being moved to `packed` **or past
   * it** while copies are still unmarked, so ask before it goes.
   *
   * `packed` *or past it*, rather than `packed` alone, because the select can jump a sale straight
   * from `paid` to `sent` — the same situation and the worse one, since the parcel has supposedly
   * gone. Decided by the user on 2026-09-08 against asking only on `packed`.
   *
   * Forward moves only: putting a sale *back* to `packed` from `sent` is a correction, and
   * stopping a correction to ask about packing would be noise.
   *
   * Nothing is asked when every copy is already packed, or when the sale has no copies at all —
   * that is #192's hint territory and it must not gain a dialog.
   */
  function needsPackingCheck(next: SaleStatus): boolean {
    return asksAboutUnpackedCopies(sale.status, next, sale.unpackedItemCount);
  }

  // Moving to `paid` is the moment the money is known, and #205's buyer handling is derived from
  // it — so a sale whose buyer side has no anchor yet is asked for the total right here (#443)
  // instead of sending the collector to the amounts card. A sale that already carries either
  // anchor (a stored total, or a handling entered directly) has answered the question; re-asking
  // would silently overwrite that choice, since the two are mutually exclusive.
  const buyerSideUnanchored = sale.buyerPaidTotal == null && sale.buyerHandling == null;

  // How many units still have nobody's decision on which set left (#697) — what the buyer's link
  // (#699) would be asking about, and what decides whether the header offers one.
  const pendingSetCount = sale.lines.filter((l) => l.setChoicePending).length;

  /** Both controls that move the status come through here (#973): the inline select and the
   *  advance button. A guard added to one and not the other is a guard the button walks past. */
  function applyStatus(next: string) {
    if (next === sale.status) return;
    // The packing question comes first, because it is the only one that can abandon the move
    // altogether. Answering it hands the transition on to the prompts below, so a jump to `sent`
    // still asks for the tracking number afterwards.
    if (isSaleStatus(next) && needsPackingCheck(next)) {
      setError(undefined);
      setDialog({ kind: "unpacked", next });
      return;
    }
    proceedWithStatus(next);
  }

  /** The transition once the packing question (#973) has been answered, or was never asked. */
  function proceedWithStatus(next: string) {
    if (next === "paid" && buyerSideUnanchored) {
      setError(undefined);
      setDialog({ kind: "paidTotal" });
      return;
    }
    // Sending the parcel is the moment the tracking number exists and is in hand (#491) — the same
    // reasoning as the total on `paid` above. Only asked when the sale carries none: one already
    // recorded has answered, and re-asking would invite overwriting it.
    if (asksForShipment(next, sale.trackingCode)) {
      setError(undefined);
      setDialog({ kind: "shipment", mode: "sent" });
      return;
    }
    setStatus(next);
  }

  function setStatus(next: string, onDone?: () => void) {
    run(async () => {
      const { setSaleStatusAction } = await import("@/app/actions/sales");
      return setSaleStatusAction(sale.id, next);
    }, onDone);
  }

  // Base-currency equivalents for the sale-currency amounts (#208), at the sale's frozen rate. Only
  // shown when the sale currency differs from base and a rate is known; shipping (already base, #206)
  // and net (a base figure, #206) carry their own base display.
  const saleRate = sale.fxRateToBase == null ? null : Number(sale.fxRateToBase);
  const showBase = sale.currency !== sale.baseCurrency && saleRate != null;
  const toBase = (amt: string | null): string | null =>
    showBase && amt != null && amt !== "" ? (Number(amt) * (saleRate as number)).toFixed(2) : null;

  /** Run a mutation, then refresh the server component and the client caches (the sellable-offers
   * picker is a client query, so a server refresh alone won't reflect line/offer changes). */
  function run(
    fn: () => Promise<{ status: string; message?: string }>,
    onDone?: () => void
  ) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        router.refresh();
        invalidateAll(collectionId);
        onDone?.();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Header */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          background: "var(--color-bg-elevated)",
          padding: "1.25rem 1.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {sale.platformName}
          </h2>
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            {sale.buyerName ? `to ${sale.buyerName}` : "buyer unknown"}
          </span>
          {/* **Ask the buyer** (#699): a link that lets them pick which of the interchangeable copies
              they get. Drawn while there is something to ask about — or while a link is already out
              there, since a seller who has sent one needs a way back to it to check or withdraw it
              even after the last unit has been settled. */}
          {/* **Message to buyer** (#1815): what to pay, where, and what happens next, from the
              platform's template — offered only where the platform has one (#1692). */}
          {buyerMessage && (
            <Tooltip
              content="Read and copy the message for the buyer — what to pay and what happens next"
              style={{ marginLeft: "auto" }}
            >
              <button
                type="button"
                onClick={() => {
                  setError(undefined);
                  setDialog({ kind: "buyerMessage" });
                }}
                disabled={isPending}
                style={SECONDARY_BTN}
              >
                <Icon name="copy" size="sm" /> Message to buyer
              </button>
            </Tooltip>
          )}
          {(pendingSetCount > 0 || sale.share) && (
            <Tooltip
              content={
                pendingSetCount > 0
                  ? "Send the buyer a link and let them choose which copy they get"
                  : "This sale has a buyer link out — open it to check or withdraw it"
              }
              style={buyerMessage ? undefined : { marginLeft: "auto" }}
            >
              <button
                type="button"
                onClick={() => {
                  setError(undefined);
                  setDialog({ kind: "share" });
                }}
                disabled={isPending}
                style={SECONDARY_BTN}
              >
                <Icon name="share" size="sm" /> Ask the buyer
              </button>
            </Tooltip>
          )}
          {/* Printable packing list (#330) — a paper checklist of the sold copies, in shelf order. */}
          <Link
            href={`/c/${params.collectionSlug}/sales/${sale.id}/packing-list`}
            style={{
              ...SECONDARY_BTN,
              marginLeft: buyerMessage || pendingSetCount > 0 || sale.share ? undefined : "auto",
              textDecoration: "none",
              display: "inline-block",
            }}
            title="Open a print-friendly packing list for this sale"
          >
            <Icon name="print" size="sm" /> Packing list
          </Link>
          <button
            type="button"
            onClick={() => {
              setError(undefined);
              setDialog({ kind: "editHeader" });
            }}
            disabled={isPending}
            style={SECONDARY_BTN}
          >
            Edit header
          </button>
        </div>
        <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={CHIP}>{soldDate}</span>
          <span style={CHIP}>{sale.currency}</span>
          {/* Recorded through the agent API, not yet confirmed (#1948) — the list row's chip, off
              the same columns. *Confirm* beside it is the only thing that takes it off: editing
              anything on this screen leaves it standing. */}
          <SaleApiReviewChip mark={sale.apiReview} chipStyle={CHIP} />
          {sale.apiReview && (
            <Tooltip content="You have reviewed what the agent API recorded — remove the To review mark from this sale.">
              <button
                type="button"
                onClick={() =>
                  run(
                    async () => {
                      const { confirmSaleReviewAction } = await import("@/app/actions/sales");
                      return confirmSaleReviewAction(sale.id);
                    },
                    () => toast({ message: `Sale s${sale.saleNo} confirmed` })
                  )
                }
                disabled={isPending}
                style={SECONDARY_BTN}
              >
                <Icon name="check" size="sm" /> Confirm
              </button>
            </Tooltip>
          )}
          {sale.externalRef && (
            <Tooltip content="Order number in the marketplace">
              <span style={CHIP}># {sale.externalRef}</span>
            </Tooltip>
          )}
          {/* Transaction link (#292): the order page on the marketplace. Editable whatever the
              fulfillment status is — the order page is most often what you come back to *after* the
              sale completed (#213). When set, the link opens on click and a separate pencil edits
              it, so the click-to-open is never hijacked (#214). */}
          <InlineText
            value={sale.transactionUrl ?? ""}
            placeholder="Add transaction link"
            display={
              sale.transactionUrl ? (
                <Tooltip content="Open the transaction on the marketplace">
                  <a
                    href={sale.transactionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ ...CHIP, color: "var(--color-accent)", textDecoration: "none" }}
                  >
                    <Icon name="externalLink" size="sm" /> Transaction
                  </a>
                </Tooltip>
              ) : (
                <span style={{ ...CHIP, color: "var(--color-text-muted)", cursor: "text" }}>
                  Add transaction link
                </span>
              )
            }
            editable
            editControl={!!sale.transactionUrl}
            editAriaLabel="Edit transaction link"
            isPending={isPending}
            inputType="url"
            onSave={(v) =>
              run(async () => {
                const { updateSaleTransactionUrlAction } = await import("@/app/actions/sales");
                return updateSaleTransactionUrlAction(sale.id, v);
              })
            }
          />
          {/* The parcel (#491): who carried it and its tracking number. A link only when the carrier
              in force has a tracking address; otherwise the number is shown plain, which is still
              what you read out to a buyer who asks. Both are edited in the same dialog the Sent
              transition raises — the carrier is decided at the same counter as the number, so
              editing one without the other is not a thing anybody wants to do. */}
          {sale.trackingCode ? (
            <>
              {sale.trackingUrl ? (
                <Tooltip
                  content={`Track this parcel${sale.carrierName ? ` with ${sale.carrierName}` : ""}`}
                >
                  <a
                    href={sale.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...CHIP, color: "var(--color-accent)", textDecoration: "none" }}
                  >
                    <Icon name="parcel" size="sm" /> {sale.trackingCode}
                  </a>
                </Tooltip>
              ) : (
                <Tooltip
                  content={
                    sale.carrierName
                      ? `${sale.carrierName} has no tracking address recorded — add one in Settings → Carriers`
                      : "No carrier is recorded for this parcel, so there is nothing to link to"
                  }
                >
                  <span style={CHIP}><Icon name="parcel" size="sm" /> {sale.trackingCode}</span>
                </Tooltip>
              )}
              <button
                type="button"
                aria-label="Edit shipment"
                title="Edit carrier and tracking number"
                onClick={() => {
                  setError(undefined);
                  setDialog({ kind: "shipment", mode: "edit" });
                }}
                disabled={isPending}
                style={{
                  border: "none",
                  background: "none",
                  cursor: isPending ? "default" : "pointer",
                  color: "var(--color-text-muted)",
                  fontSize: "0.75rem",
                  padding: "0 0.125rem",
                }}
              >
                <Icon name="edit" size="sm" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(undefined);
                setDialog({ kind: "shipment", mode: "edit" });
              }}
              disabled={isPending}
              style={{
                ...CHIP,
                color: "var(--color-text-muted)",
                cursor: isPending ? "default" : "pointer",
              }}
            >
              Add tracking number
            </button>
          )}
          {sale.fxRateToBase && (
            <Tooltip content={`Frozen FX rate to ${sale.baseCurrency}: ${sale.fxRateToBase}`}>
              <span style={CHIP}>
                → {sale.baseCurrency} @ {formatRate(sale.fxRateToBase)}
              </span>
            </Tooltip>
          )}
          <Tooltip content="Net proceeds (base currency)" align="end" style={{ marginLeft: "auto" }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {sale.netProceeds} {sale.baseCurrency}
            </span>
          </Tooltip>
        </div>
        {sale.fxRateToBase == null && sale.currency !== sale.baseCurrency && (
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "var(--color-warning, var(--color-text-muted))" }}>
            No exchange rate to {sale.baseCurrency} is known for this sale yet, so base-currency
            profit/loss cannot be computed. Add a rate first.
          </p>
        )}

        {/* Fulfillment status (#191): inline select + one-click advance along the lifecycle. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginTop: "0.9rem",
            paddingTop: "0.9rem",
            borderTop: "1px solid var(--color-border)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Status
          </span>
          <select
            aria-label="Sale fulfillment status"
            value={sale.status}
            onChange={(e) => applyStatus(e.target.value)}
            disabled={isPending}
            style={{
              padding: "0.375rem 0.625rem",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.375rem",
              fontSize: "0.8125rem",
              color: "var(--color-text-primary)",
              background: "var(--color-bg-elevated)",
              cursor: "pointer",
            }}
          >
            {SALE_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {SALE_STATUS_META[s].label}
              </option>
            ))}
          </select>
          {nextStatus && (
            <Tooltip content={`Advance to ${SALE_STATUS_META[nextStatus as SaleStatus].label}`}>
              <button
                type="button"
                onClick={() => applyStatus(nextStatus)}
                disabled={isPending}
                style={SECONDARY_BTN}
              >
                → {SALE_STATUS_META[nextStatus as SaleStatus].label}
              </button>
            </Tooltip>
          )}
          {showPackedHint && (
            <Tooltip content="Every copy on this sale is packed">
              <span
                style={{
                  fontSize: "0.75rem",
                  color: "var(--color-accent)",
                  background: "var(--color-accent-soft, var(--color-bg-page))",
                  border: "1px solid var(--color-accent-border, var(--color-border))",
                  borderRadius: "0.375rem",
                  padding: "0.125rem 0.5rem",
                }}
              >
                All copies packed — advance to Packed?
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Amounts summary — at the top so the proceeds are visible at a glance. Gross + net are
          derived; the three shared amounts are editable in place (click the value, ✎). */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          background: "var(--color-bg-elevated)",
          padding: "1rem 1.25rem",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            columnGap: "1.25rem",
            rowGap: "0.125rem",
            alignItems: "center",
            fontSize: "0.8125rem",
          }}
        >
          {/* Gross (read-only) */}
          <div style={ROW_LABEL}>Gross proceeds</div>
          <div style={ORIG_CELL}>
            <span style={{ paddingRight: VALUE_INSET }}>
              {sale.grossProceeds} {sale.currency}
            </span>
          </div>
          <div style={BASE_CELL}>{baseEqText(toBase(sale.grossProceeds), sale.baseCurrency)}</div>

          {sale.buyerPaidTotal != null ? (
            // Total-anchored (#205): the buyer-paid total is the editable anchor and handling is
            // derived (total − gross), shown read-only and recomputed as sold units change.
            <>
              <EditableAmountRow
                label="Total paid by buyer"
                value={sale.buyerPaidTotal}
                currency={sale.currency}
                baseEquivalent={toBase(sale.buyerPaidTotal)}
                baseCurrency={sale.baseCurrency}
                disabled={isPending}
                onSave={(next) =>
                  run(async () => {
                    const { updateSaleAmountAction } = await import("@/app/actions/sales");
                    return updateSaleAmountAction(sale.id, "buyerPaidTotal", next);
                  })
                }
              />
              {/* Derived handling (read-only) */}
              <div style={ROW_LABEL}>+ Buyer handling</div>
              {/* The tooltip wrapper *is* the grid cell here: wrapping the cell instead would put a
                  stretched span between the grid and it, and `justifySelf: end` on a non-item does
                  nothing — the amount would drift to the left of the column the others end at. */}
              <Tooltip content="Derived from the total paid minus the offer prices" align="end" style={ORIG_CELL}>
                <span style={{ paddingRight: VALUE_INSET }}>
                  {sale.buyerHandling} {sale.currency}
                </span>
              </Tooltip>
              <div style={BASE_CELL}>{baseEqText(toBase(sale.buyerHandling), sale.baseCurrency)}</div>
              {sale.totalBelowGross && (
                <p style={{ gridColumn: "1 / -1", margin: "0.125rem 0 0.25rem", fontSize: "0.75rem", color: "var(--color-error)" }}>
                  Total paid is below the offer prices ({sale.grossProceeds} {sale.currency}). Handling
                  is held at 0 — raise the total or remove some sold units.
                </p>
              )}
            </>
          ) : (
            <EditableAmountRow
              label="+ Buyer handling"
              value={sale.buyerHandling}
              currency={sale.currency}
              baseEquivalent={toBase(sale.buyerHandling)}
              baseCurrency={sale.baseCurrency}
              disabled={isPending}
              onSave={(next) =>
                run(async () => {
                  const { updateSaleAmountAction } = await import("@/app/actions/sales");
                  return updateSaleAmountAction(sale.id, "buyerHandling", next);
                })
              }
            />
          )}
          <EditableShippingRow
            // With supply lines the typed amount is the postage alone, and the supplies follow it
            // (#1898); a sale without them shows the row it always had.
            label={sale.supplies.lines.length > 0 ? "− Postage" : "− My shipping"}
            platformId={sale.platformId}
            optionId={sale.shippingOptionId}
            optionName={sale.shippingOptionName}
            carriers={carriers}
            sentAsServiceId={sale.sentAsServiceId}
            sentAsLabel={sale.sentAsDiffers && sale.sentAs ? `${sale.sentAs.carrierName}: ${sale.sentAs.serviceName}` : null}
            amount={sale.shippingCost}
            currency={sale.shippingCurrency ?? sale.currency}
            saleCurrency={sale.currency}
            baseCurrency={sale.baseCurrency}
            baseEquivalent={sale.shippingBase}
            baseColumnInUse={showBase}
            rateMissing={sale.shippingRateMissing}
            disabled={isPending}
            onSave={(shipping) =>
              run(async () => {
                const { updateSaleShippingAction } = await import("@/app/actions/sales");
                return updateSaleShippingAction(sale.id, shipping);
              })
            }
          />
          {sale.supplies.lines.length > 0 && (
            <SuppliesRow supplies={sale.supplies} baseCurrency={sale.baseCurrency} showBase={showBase} />
          )}
          <EditableAmountRow
            label="− Commission"
            value={sale.commission}
            currency={sale.currency}
            baseEquivalent={toBase(sale.commission)}
            baseCurrency={sale.baseCurrency}
            disabled={isPending}
            onSave={(next) =>
              run(async () => {
                const { updateSaleAmountAction } = await import("@/app/actions/sales");
                return updateSaleAmountAction(sale.id, "commission", next);
              })
            }
          />

          {/* Net (always base currency). When the sale currency differs from base it belongs in the
              base column; for a single-currency sale it sits in the value column with everything else. */}
          <div style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--color-border)", marginTop: "0.25rem" }} />
          <div style={{ ...ROW_LABEL, fontWeight: 600, color: "var(--color-text-primary)" }}>Net proceeds</div>
          {showBase ? (
            <>
              <div style={ORIG_CELL} />
              <div style={{ ...BASE_CELL, fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
                {sale.netProceeds} {sale.baseCurrency}
              </div>
            </>
          ) : (
            <>
              <div style={{ ...ORIG_CELL, fontSize: "0.875rem", fontWeight: 600 }}>
                <span style={{ paddingRight: VALUE_INSET }}>
                  {sale.netProceeds} {sale.baseCurrency}
                </span>
              </div>
              <div style={BASE_CELL} />
            </>
          )}

          {/* Profit and loss (#168): the net against what the sold copies cost. */}
          {sale.lines.length > 0 && (
            <ProfitRows
              profit={sale.profit}
              copiesWithoutCost={sale.copiesWithoutCost}
              supplies={sale.supplies}
              baseCurrency={sale.baseCurrency}
              showBase={showBase}
            />
          )}
        </div>
      </div>

      {/* The parcel's packing supplies (#1898): with the postage, what my shipping is. */}
      <SaleSuppliesCard
        saleId={sale.id}
        supplies={sale.supplies}
        postageBase={sale.shippingRateMissing ? null : sale.shippingBase}
        myShippingBase={sale.myShippingBase}
        baseCurrency={sale.baseCurrency}
        dictionary={packingSupplies}
        isPending={isPending}
        error={error}
        run={run}
        clearError={() => setError(undefined)}
      />

      {/* Sold units */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Sold units
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {/* Copies that were never listed (#2021): one set with its own price, no offer made. */}
          <Tooltip content="Sell copies that are on no offer — picked from stock, they become one set on this sale with the price you type">
            <button
              type="button"
              onClick={() => {
                setError(undefined);
                setDialog({ kind: "addCopies" });
              }}
              disabled={isPending}
              style={SECONDARY_BTN}
            >
              Add copies
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={() => {
              setError(undefined);
              setDialog({ kind: "addLines" });
            }}
            disabled={isPending}
            style={PRIMARY_BTN}
          >
            Add sold units
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: "0.8125rem", color: "var(--color-error)" }}>{error}</div>}

      <SoldUnitsView
        collectionId={collectionId}
        saleId={sale.id}
        currency={sale.currency}
        baseCurrency={sale.baseCurrency}
        lines={sale.lines}
        areas={areas}
        locations={locations}
        issueHeaderById={issueHeaderById}
        onRemove={(lineId, label) => setDialog({ kind: "removeLine", lineId, label })}
        onChooseSet={(lineId) => {
          setError(undefined);
          setDialog({ kind: "chooseSet", lineId });
        }}
        onEditPrice={(lineId, price) =>
          run(async () => {
            const { updateSaleLinePriceAction } = await import("@/app/actions/sales");
            return updateSaleLinePriceAction(lineId, price);
          })
        }
      />

      {/* Dialogs */}
      {dialog.kind === "editHeader" && (
        <SaleFormDialog
          mode="edit"
          collectionId={collectionId}
          baseCurrency={sale.baseCurrency}
          today={todayIso()}
          initial={{
            platformId: sale.platformId,
            platformName: sale.platformName,
            buyerId: sale.buyerId,
            buyerName: sale.buyerName,
            externalRef: sale.externalRef ?? "",
            transactionUrl: sale.transactionUrl ?? "",
            soldAt: soldDate,
            currency: sale.currency,
            buyerHandling: sale.buyerPaidTotal != null ? "" : (sale.buyerHandling ?? ""),
            buyerPaidTotal: sale.buyerPaidTotal ?? "",
            commission: sale.commission ?? "",
            // A stored option id means a listed option; a name without one is the one-off (#468).
            shippingOptionId:
              sale.shippingOptionId ?? (sale.shippingOptionName ? CUSTOM_SHIPPING_OPTION : ""),
            shippingOptionName: sale.shippingOptionName ?? "",
            sentAsServiceId: sale.sentAsServiceId ?? "",
            shippingCost: sale.shippingCost ?? "",
            shippingCurrency: sale.shippingCurrency ?? sale.currency,
          }}
          platformLocked={sale.lines.length > 0}
          grossProceeds={sale.grossProceeds}
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) {
              setDialog({ kind: "none" });
              setError(undefined);
            }
          }}
          onSubmit={(raw) =>
            run(
              async () => {
                const { updateSaleHeaderAction } = await import("@/app/actions/sales");
                return updateSaleHeaderAction(collectionId, sale.id, raw);
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}

      {dialog.kind === "addLines" && (
        <AddSaleLineDialog
          collectionId={collectionId}
          platformId={sale.platformId}
          currency={sale.currency}
          baseCurrency={sale.baseCurrency}
          areas={areas}
          locations={locations}
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) {
              setDialog({ kind: "none" });
              setError(undefined);
            }
          }}
          onSubmit={(lines) =>
            run(
              async () => {
                const { addSaleLinesAction } = await import("@/app/actions/sales");
                // The collector opened this very sale, so a sent one takes the sets too (#1950).
                return addSaleLinesAction(sale.id, lines, { toSentSale: true });
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}

      {dialog.kind === "addCopies" && (
        <AddCopiesDialog
          collectionId={collectionId}
          currency={sale.currency}
          baseCurrency={sale.baseCurrency}
          areas={areas}
          locations={locations}
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) {
              setDialog({ kind: "none" });
              setError(undefined);
            }
          }}
          onSubmit={(set) =>
            run(
              async () => {
                const { addSaleCopySetAction } = await import("@/app/actions/sales");
                // This very sale was opened, so a sent one takes the copies too — the sold sets' rule (#1950).
                return addSaleCopySetAction(sale.id, set, { toSentSale: true });
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}

      {/* Some copies are not packed, asked for on the way to `packed` or past it (#973). Two runs
          rather than one, unlike the prompts below: marking the copies and moving the sale are two
          facts about the world, and a refused status change leaves behind copy marks that are true
          anyway — they *were* packed, which is what the collector just said. Handing the move back
          to `proceedWithStatus` is what keeps a jump to `sent` asking for the tracking number
          afterwards, instead of the packing question swallowing it. */}
      {dialog.kind === "unpacked" && (
        <UnpackedCopiesDialog
          unpackedCount={sale.unpackedItemCount}
          targetLabel={SALE_STATUS_META[dialog.next].label}
          isPending={isPending}
          error={error}
          onClose={() => {
            // *Do nothing*: the status stays put and no copy flag changes.
            if (!isPending) {
              setDialog({ kind: "none" });
              setError(undefined);
            }
          }}
          onAdvanceAnyway={() => {
            const next = dialog.next;
            setDialog({ kind: "none" });
            proceedWithStatus(next);
          }}
          onMarkPacked={() => {
            const next = dialog.next;
            run(
              async () => {
                const { markSaleCopiesPackedAction } = await import("@/app/actions/sales");
                return markSaleCopiesPackedAction(sale.id);
              },
              () => {
                setDialog({ kind: "none" });
                proceedWithStatus(next);
              }
            );
          }}
        />
      )}

      {/* Total paid, asked for on the way to `paid` (#443). Saving the amount and the transition
          are one run: a refused amount leaves the status alone, so the two never disagree. */}
      {dialog.kind === "paidTotal" && (
        <PaidTotalDialog
          grossProceeds={sale.grossProceeds}
          currency={sale.currency}
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) {
              setDialog({ kind: "none" });
              setError(undefined);
            }
          }}
          onSkip={() => setStatus("paid", () => setDialog({ kind: "none" }))}
          onSubmit={(totalPaid) =>
            run(
              async () => {
                const { updateSaleAmountAction, setSaleStatusAction } = await import(
                  "@/app/actions/sales"
                );
                const saved = await updateSaleAmountAction(sale.id, "buyerPaidTotal", totalPaid);
                if (saved.status !== "success") return saved;
                return setSaleStatusAction(sale.id, "paid");
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}

      {/* The parcel, asked for on the way to `sent` (#491) and reopenable to correct. Saving and
          the transition are one run, like the paid prompt above: a refused save leaves the status
          alone, so the sale never says "sent" over a number that was never stored. */}
      {dialog.kind === "shipment" && (
        <ShipmentDialog
          mode={dialog.mode}
          goingBy={shipmentGoingBy({
            sentAsDiffers: sale.sentAsDiffers,
            sentAsServiceName: sale.sentAs?.serviceName ?? null,
            shippingOptionName: sale.shippingOptionName,
          })}
          carriers={carriers}
          carrierId={sale.carrierId}
          trackingCode={sale.trackingCode}
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) {
              setDialog({ kind: "none" });
              setError(undefined);
            }
          }}
          onSkip={() => setStatus("sent", () => setDialog({ kind: "none" }))}
          onSubmit={(carrierId, trackingCode) =>
            run(
              async () => {
                const { updateSaleShipmentAction, setSaleStatusAction } = await import(
                  "@/app/actions/sales"
                );
                const saved = await updateSaleShipmentAction(sale.id, carrierId, trackingCode);
                if (saved.status !== "success" || dialog.mode === "edit") return saved;
                return setSaleStatusAction(sale.id, "sent");
              },
              () => setDialog({ kind: "none" })
            )
          }
        />
      )}

      {dialog.kind === "buyerMessage" && buyerMessage && (
        <BuyerMessageDialog message={buyerMessage} onClose={() => setDialog({ kind: "none" })} />
      )}

      {/* The buyer's own pick of which copy they get (#699). Mint, copy, and withdraw — the trade
          share dialog's shape, minus the figures switch a sale page has no figures for. */}
      {dialog.kind === "share" && (
        <SaleShareDialog
          saleId={sale.id}
          share={sale.share}
          pendingCount={pendingSetCount}
          onClose={() => {
            if (!isPending) {
              setDialog({ kind: "none" });
              setError(undefined);
            }
          }}
          onChanged={() => {
            router.refresh();
            invalidateAll(collectionId);
          }}
        />
      )}

      {/* Which of the offer's interchangeable sets actually left (#697). The line, its price and its
          place on the sale all stand — only the copies move — so this is deliberately not a
          confirm-and-destroy dialog like the removal below it. */}
      {dialog.kind === "chooseSet" && (
        <ChooseSetDialog
          collectionId={collectionId}
          lineId={dialog.lineId}
          areas={areas}
          locations={locations}
          baseCurrency={sale.baseCurrency}
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) {
              setDialog({ kind: "none" });
              setError(undefined);
            }
          }}
          onSubmit={(offerSetId) => {
            const lineId = dialog.lineId;
            run(
              async () => {
                const { swapSaleLineSetAction } = await import("@/app/actions/sales");
                return swapSaleLineSetAction(lineId, offerSetId);
              },
              () => setDialog({ kind: "none" })
            );
          }}
        />
      )}

      {dialog.kind === "removeLine" && (
        <ConfirmDialog
          title="Remove sold unit"
          message={`Remove “${dialog.label}” from this sale? Its copies become available again, and if this was the last unit of its offer, the offer returns to active.`}
          actionLabel="Remove"
          pendingLabel="Removing…"
          variant="destructive"
          isPending={isPending}
          error={error}
          onClose={() => {
            if (!isPending) {
              setDialog({ kind: "none" });
              setError(undefined);
            }
          }}
          onConfirm={() => {
            const lineId = dialog.lineId;
            run(
              async () => {
                const { removeSaleLineAction } = await import("@/app/actions/sales");
                return removeSaleLineAction(lineId);
              },
              () => setDialog({ kind: "none" })
            );
          }}
        />
      )}
    </div>
  );
}

// The Amounts breakdown is a 3-column grid (#208): label · original currency · base currency, so the
// numbers line up in their own right-aligned columns. Row components emit exactly these three cells
// (via a fragment); full-width items use `gridColumn: 1 / -1`.
const VALUE_INSET = "0.375rem";

/** Column 1: the row label. */
const ROW_LABEL: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  minHeight: "1.75rem",
  color: "var(--color-text-secondary)",
};

/** Column 2: the amount in the sale's own (transaction) currency, right-aligned. */
const ORIG_CELL: React.CSSProperties = {
  justifySelf: "end",
  display: "inline-flex",
  alignItems: "center",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
};

/** Column 3: the base-currency equivalent, right-aligned and muted. */
const BASE_CELL: React.CSSProperties = {
  justifySelf: "end",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  color: "var(--color-text-muted)",
  fontSize: "0.6875rem",
  paddingRight: VALUE_INSET,
};

/** The muted "≈ X BASE" text for a base-currency column cell (#208), or null when none applies. */
function baseEqText(value: string | null | undefined, currency: string): string | null {
  return value ? `≈ ${value} ${currency}` : null;
}

const PROFIT_NOTE: React.CSSProperties = {
  gridColumn: "1 / -1",
  margin: "0.125rem 0 0.25rem",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

/** The cost and profit rows under the net (#168), in the net's own column. A profit that cannot be
 * computed says why instead of showing a figure; one over only some of the copies says how many it
 * left out, and why. One counting a copy at its open lot's estimate (#1814) reads as an estimate —
 * `~`, muted italic, on both the cost and the profit — and says how many copies are estimated. One
 * counting a copy with no cost recorded (#1875) is incomplete and a ceiling — `≤` on the profit — and
 * names those copies, each leading to its own page. */
function ProfitRows({
  profit,
  copiesWithoutCost,
  supplies,
  baseCurrency,
  showBase,
}: {
  profit: EstimatedProfitFigures;
  copiesWithoutCost: readonly SaleCopyRef[];
  /** The parcel's packing supplies (#1898): units without a cost leave *my shipping* low, so the
   * profit is incomplete and a ceiling, as with a copy without cost. */
  supplies: SaleSuppliesData;
  baseCurrency: string;
  showBase: boolean;
}) {
  // The net sits in the base column when the sale is in another currency; its cost and profit
  // follow it there, so the three read down one column.
  function amount(content: React.ReactNode, style: React.CSSProperties = {}) {
    return showBase ? (
      <>
        <div style={ORIG_CELL} />
        <div style={{ ...BASE_CELL, fontSize: "0.8125rem", color: "var(--color-text-primary)", ...style }}>
          {content}
        </div>
      </>
    ) : (
      <>
        <div style={{ ...ORIG_CELL, ...style }}>
          <span style={{ paddingRight: VALUE_INSET }}>{content}</span>
        </div>
        <div style={BASE_CELL} />
      </>
    );
  }
  const reasons = describeLeftOut(profit.leftOut).join(", ");

  if (profit.profit == null) {
    return (
      <>
        <div style={ROW_LABEL}>Profit / loss</div>
        {amount("cannot be computed", { color: "var(--color-text-muted)" })}
        <p style={PROFIT_NOTE}>
          {profit.leftOut.noRate > 0
            ? `No exchange rate to ${baseCurrency} is known for this sale or its shipping, so none of its copies has a figure in ${baseCurrency}.`
            : `None of the ${profit.copyCount} sold ${profit.copyCount === 1 ? "copy" : "copies"} can be counted: ${reasons}.`}
        </p>
      </>
    );
  }

  const n = Number(profit.profit);
  const leftOut = profit.countedCount < profit.copyCount;
  const withoutCost = copiesWithoutCost.length > 0;
  const uncostedSupplies = supplies.incomplete ? describeUncostedSupplies(supplies) : null;
  const incomplete = leftOut || withoutCost || uncostedSupplies != null;
  const estimateNote = describeEstimated(profit.estimatedCount);
  const mark = estimateNote ? "~" : "";
  const ceiling = withoutCost || uncostedSupplies != null ? "≤ " : "";
  const estimateStyle = estimateNote ? COST_ESTIMATE_STYLE : {};
  const qualifiers = [incomplete && "incomplete", estimateNote && "estimated"].filter(Boolean);
  return (
    <>
      <div style={ROW_LABEL}>
        {leftOut
          ? "− Cost of the counted copies"
          : withoutCost
            ? "− Recorded cost of copies sold"
            : "− Cost of copies sold"}
      </div>
      {amount(`${mark}${profit.cost} ${baseCurrency}`, estimateStyle)}
      <div style={{ ...ROW_LABEL, fontWeight: 600, color: "var(--color-text-primary)" }}>
        {qualifiers.length > 0 ? `Profit / loss (${qualifiers.join(", ")})` : "Profit / loss"}
      </div>
      {amount(`${ceiling}${mark}${signedAmount(profit.profit)} ${baseCurrency}`, {
        fontSize: "0.875rem",
        fontWeight: 600,
        color: n > 0 ? "var(--color-success)" : n < 0 ? "var(--color-error)" : "var(--color-text-primary)",
        ...estimateStyle,
      })}
      {estimateNote && <p style={PROFIT_NOTE}>{estimateNote}.</p>}
      {withoutCost && (
        <p style={PROFIT_NOTE}>
          <CopiesWithoutCost copies={copiesWithoutCost} align="start" /> —{" "}
          {explainWithoutCost(copiesWithoutCost.length).toLowerCase()}.
        </p>
      )}
      {uncostedSupplies && (
        <p style={PROFIT_NOTE}>
          Packing supplies: {uncostedSupplies} — my shipping leaves their cost out, so the profit is
          overstated by it until a purchase of the supply covers them.
        </p>
      )}
      {leftOut && (
        <p style={PROFIT_NOTE}>
          Counted over {profit.countedCount} of {profit.copyCount} copies, whose proceeds are{" "}
          {profit.proceeds} {baseCurrency}. Left out: {reasons}.
        </p>
      )}
    </>
  );
}

/** The "− Packing supplies" row under the postage (#1898): what the parcel's supplies cost, in the
 * base currency — they are costed from stock there. Edited on the supplies card, not here. One
 * leaving units out says so, since *my shipping* is then low by their cost. */
function SuppliesRow({
  supplies,
  baseCurrency,
  showBase,
}: {
  supplies: SaleSuppliesData;
  baseCurrency: string;
  showBase: boolean;
}) {
  const uncosted = supplies.incomplete ? describeUncostedSupplies(supplies) : null;
  const figure = (
    <>
      {supplies.costBase} {baseCurrency}
      {uncosted && (
        <Tooltip content={`Incomplete: ${uncosted}`} align="end">
          <span style={{ marginLeft: "0.375rem", color: "var(--color-warning)" }}>+ ?</span>
        </Tooltip>
      )}
    </>
  );
  return (
    <>
      <div style={ROW_LABEL}>− Packing supplies</div>
      {showBase ? (
        <>
          <div style={ORIG_CELL} />
          <div style={BASE_CELL}>{figure}</div>
        </>
      ) : (
        <>
          <div style={ORIG_CELL}>
            <span style={{ paddingRight: VALUE_INSET }}>{figure}</span>
          </div>
          <div style={BASE_CELL} />
        </>
      )}
    </>
  );
}

/** `+` printed on a surplus, a typographic `−` on a loss. */
function signedAmount(amount: string): string {
  const n = Number(amount);
  return n < 0 ? `−${Math.abs(n).toFixed(2)}` : `+${n.toFixed(2)}`;
}

function EditableAmountRow({
  label,
  value,
  currency,
  baseEquivalent,
  baseCurrency,
  disabled,
  onSave,
}: {
  label: string;
  value: string | null;
  currency: string;
  baseEquivalent?: string | null;
  baseCurrency?: string;
  disabled: boolean;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState("");
  const cancelRef = useRef(false);

  function open() {
    if (disabled) return;
    setDraft(value ?? "");
    cancelRef.current = false;
    setEditing(true);
  }

  function commit() {
    if (cancelRef.current) {
      cancelRef.current = false;
      setEditing(false);
      return;
    }
    setEditing(false);
    // Skip a no-op write (server stores 2-dp, so compare against the shown value).
    if (draft.trim() === (value ?? "")) return;
    onSave(draft);
  }

  return (
    <>
      <div style={ROW_LABEL}>{label}</div>
      <div style={ORIG_CELL}>
        {editing ? (
          <NumericInput
            kind="amount"
            placeholder="0.00"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                cancelRef.current = true;
                e.currentTarget.blur();
              }
            }}
            style={{ ...INPUT_STYLE, width: "8rem", textAlign: "right", padding: "0.125rem 0.375rem" }}
          />
        ) : (
          <Tooltip content="Click to edit">
            <button
              type="button"
              onClick={open}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              disabled={disabled}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                border: "none",
                background: hovered && !disabled ? "var(--color-bg-muted)" : "transparent",
                cursor: disabled ? "default" : "pointer",
                padding: `0.125rem ${VALUE_INSET}`,
                borderRadius: "0.25rem",
                fontVariantNumeric: "tabular-nums",
                fontSize: "0.8125rem",
                color: value ? "var(--color-text-primary)" : "var(--color-text-muted)",
              }}
            >
              <span aria-hidden style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", opacity: hovered ? 1 : 0.55 }}>
                <Icon name="edit" size="sm" />
              </span>
              <span>{value ? `${value} ${currency}` : "Set"}</span>
            </button>
          </Tooltip>
        )}
      </div>
      <div style={BASE_CELL}>{baseEqText(baseEquivalent, baseCurrency ?? "")}</div>
    </>
  );
}

const SHIP_ICON_BTN: React.CSSProperties = {
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  borderRadius: "0.25rem",
  cursor: "pointer",
  fontSize: "0.75rem",
  lineHeight: 1,
  padding: "0.25rem 0.375rem",
  color: "var(--color-text-secondary)",
};

/** The "− My shipping" row (#206/#468): the **shipping option** the parcel went by, its cost, and
 * the currency that cost was paid in — shipping can be paid in a currency other than the sale's.
 * Read-only it shows the option name beside the amount and — when the currency differs from base —
 * the base-currency equivalent (or a "no rate" flag when unconvertible). Editing commits all of it
 * together via explicit ✓/✕ (a `select` can't share the blur-to-commit trick the single-value rows
 * use).
 *
 * Picking one of the platform's options re-fills the cost with what its carrier service normally
 * costs (#1909), exactly as the header form does — the figure is a default, not a reading. */
function EditableShippingRow({
  label,
  platformId,
  optionId,
  optionName,
  carriers,
  sentAsServiceId,
  sentAsLabel,
  amount,
  currency,
  saleCurrency,
  baseCurrency,
  baseEquivalent,
  baseColumnInUse,
  rateMissing,
  disabled,
  onSave,
}: {
  label: string;
  platformId: string;
  optionId: string | null;
  optionName: string | null;
  /** The rate list *Sent as* picks from (#1923). */
  carriers: CarrierData[];
  /** The sale's own *Sent as*, or null for *as the option*. */
  sentAsServiceId: string | null;
  /** *Sent as* to show beside the option — only when it is not the option's own service. */
  sentAsLabel: string | null;
  amount: string | null;
  currency: string;
  saleCurrency: string;
  baseCurrency: string;
  baseEquivalent: string | null;
  /** Whether the surrounding grid's base column carries anything at all — see the render below. */
  baseColumnInUse: boolean;
  rateMissing: boolean;
  disabled: boolean;
  onSave: (shipping: SaleShippingRaw) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [draftAmount, setDraftAmount] = useState("");
  const [draftCcy, setDraftCcy] = useState(saleCurrency);
  const [draftOption, setDraftOption] = useState("");
  const [draftOptionName, setDraftOptionName] = useState("");
  const [draftSentAs, setDraftSentAs] = useState("");
  const [options, setOptions] = useState<ShippingOptionData[]>([]);

  /** The stored option as the select's value: a listed option's id, the custom token when only a
   * name was kept, or "" for a sale that says nothing about how it went. */
  const storedOptionValue = optionId ?? (optionName ? CUSTOM_SHIPPING_OPTION : "");

  // The options are loaded when the row is opened, not with the screen: most visits to a sale
  // never touch shipping, and the list is only ever needed inside this editor.
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    getShippingOptionsAction(platformId)
      .then((rows) => {
        if (!cancelled) setOptions(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [editing, platformId]);

  function open() {
    if (disabled) return;
    setDraftAmount(amount ?? "");
    setDraftCcy(currency || saleCurrency);
    setDraftOption(storedOptionValue);
    setDraftOptionName(optionName ?? "");
    setDraftSentAs(sentAsServiceId ?? "");
    setEditing(true);
  }
  const optionService = options.find((o) => o.id === draftOption)?.service ?? null;
  function pickOption(next: string) {
    setDraftOption(next);
    const option = options.find((o) => o.id === next);
    // A parcel sent as another service (#1923) keeps that service's postage.
    if (!option || draftSentAs) return;
    // An option linked to no carrier service leaves the postage to be entered.
    setDraftAmount(option.service?.cost ?? "");
    if (option.service) setDraftCcy(option.service.currency);
  }
  /** *Sent as* (#1923) fills the postage from the service picked — back to blank, the option's. */
  function pickSentAs(next: string) {
    setDraftSentAs(next);
    const service = next ? findCarrierService(carriers, next) : optionService;
    if (!service) return;
    setDraftAmount(service.cost);
    setDraftCcy(service.currency);
  }
  function commit() {
    setEditing(false);
    // Skip a no-op write (compare against everything the row is showing).
    if (
      draftAmount.trim() === (amount ?? "") &&
      draftCcy === (currency || saleCurrency) &&
      draftOption === storedOptionValue &&
      draftOptionName.trim() === (optionName ?? "") &&
      draftSentAs === (sentAsServiceId ?? "")
    ) {
      return;
    }
    onSave({
      optionId: draftOption,
      optionName: draftOptionName,
      cost: draftAmount,
      currency: draftCcy,
      sentAsServiceId: draftSentAs,
    });
  }

  return (
    <>
      <div style={ROW_LABEL}>{label}</div>
      <div style={ORIG_CELL}>
        {editing ? (
          <span style={{ display: "inline-flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
            {/* The option leads: picking one answers the two fields after it. */}
            <select
              aria-label="Shipping option"
              value={draftOption}
              onChange={(e) => pickOption(e.target.value)}
              style={{ ...INPUT_STYLE, width: "11rem", padding: "0.125rem 0.375rem", cursor: "pointer" }}
            >
              <option value="">— no option —</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — {o.price} {o.currency}
                </option>
              ))}
              <option value={CUSTOM_SHIPPING_OPTION}>Custom…</option>
            </select>
            {draftOption === CUSTOM_SHIPPING_OPTION && (
              <TextInput
                aria-label="Custom option name"
                placeholder="Option name"
                value={draftOptionName}
                onChange={(e) => setDraftOptionName(e.target.value)}
                style={{ ...INPUT_STYLE, width: "9rem", padding: "0.125rem 0.375rem" }}
              />
            )}
            <SentAsSelect
              carriers={carriers}
              value={draftSentAs}
              optionService={
                optionService && { id: optionService.id, name: optionService.name, carrierName: optionService.carrierName }
              }
              style={{ ...INPUT_STYLE, width: "13rem", padding: "0.125rem 0.375rem" }}
              onChange={pickSentAs}
            />
            <NumericInput
              kind="amount"
              placeholder="0.00"
              autoFocus
              value={draftAmount}
              onChange={(e) => setDraftAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              style={{ ...INPUT_STYLE, width: "6rem", textAlign: "right", padding: "0.125rem 0.375rem" }}
            />
            <select
              aria-label="Shipping currency"
              value={draftCcy}
              onChange={(e) => setDraftCcy(e.target.value)}
              style={{ ...INPUT_STYLE, width: "5.5rem", padding: "0.125rem 0.375rem", cursor: "pointer" }}
            >
              {COMMON_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Tooltip content="Save">
              <button type="button" onClick={commit} aria-label="Save shipping" style={SHIP_ICON_BTN}>
                <Icon name="check" size="sm" />
              </button>
            </Tooltip>
            <Tooltip content="Cancel">
              <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" style={SHIP_ICON_BTN}>
                <Icon name="close" size="sm" />
              </button>
            </Tooltip>
          </span>
        ) : (
          <Tooltip content="Click to edit">
            <button
              type="button"
              onClick={open}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              disabled={disabled}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                border: "none",
                background: hovered && !disabled ? "var(--color-bg-muted)" : "transparent",
                cursor: disabled ? "default" : "pointer",
                padding: `0.125rem ${VALUE_INSET}`,
                borderRadius: "0.25rem",
                fontVariantNumeric: "tabular-nums",
                fontSize: "0.8125rem",
                color: amount ? "var(--color-text-primary)" : "var(--color-text-muted)",
              }}
            >
              <span aria-hidden style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", opacity: hovered ? 1 : 0.55 }}>
                <Icon name="edit" size="sm" />
              </span>
              {/* The option is the fact the row leads with once there is one — the cost answers
                  "how much", the option answers "how it went", and a sale often has the second
                  before the postage receipt turns up. */}
              {optionName && (
                <span style={{ color: "var(--color-text-secondary)" }}>{optionName}</span>
              )}
              {/* How it actually went (#1923), named only when not as the buyer chose. */}
              {sentAsLabel && (
                <span style={{ color: "var(--color-text-muted)" }}>sent as {sentAsLabel}</span>
              )}
              <span>{amount ? `${amount} ${currency}` : optionName || sentAsLabel ? "" : "Set"}</span>
            </button>
          </Tooltip>
        )}
      </div>
      <div style={rateMissing ? { ...BASE_CELL, color: "var(--color-error)" } : BASE_CELL}>
        {rateMissing ? (
          <Tooltip
            content={`No exchange rate from ${currency} to ${baseCurrency} is known yet, so this cost is not in the base net.`}
          >
            <span>no rate</span>
          </Tooltip>
        ) : !baseEquivalent ? null : currency !== baseCurrency ? (
          baseEqText(baseEquivalent, baseCurrency)
        ) : baseColumnInUse ? (
          // Paid in base already, so this is exact, not a conversion — no "≈". It is repeated here
          // only to keep the base column complete when the other rows are converting into it.
          `${baseEquivalent} ${baseCurrency}`
        ) : null}
      </div>
    </>
  );
}
