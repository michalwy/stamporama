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
import type { SaleDetail } from "@/lib/sales";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { CUSTOM_SHIPPING_METHOD } from "@/lib/sale-rules";
import type { ShippingMethodData } from "@/lib/shipping-methods";
import { getShippingMethodsAction } from "@/app/actions/shipping-methods";
import type { SaleShippingRaw } from "@/app/actions/sales";
import { SaleFormDialog } from "../sale-form-dialog";
import { AddSaleLineDialog } from "../add-sale-line-dialog";
import { useInvalidateSales } from "../use-sales-query";
import { SoldUnitsView } from "./sold-units-view";
import { PaidTotalDialog } from "./paid-total-dialog";
import { SALE_STATUS_ORDER, SALE_STATUS_META, type SaleStatus } from "../sale-status";

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
  | { kind: "removeLine"; lineId: string; label: string }
  | { kind: "paidTotal" };

interface SaleDetailPanelProps {
  collectionId: string;
  sale: SaleDetail;
  areas: CollectionAreaData[];
  locations: LocationData[];
  issueHeaderById: Record<string, IssueHeader>;
}

export function SaleDetailPanel({ collectionId, sale, areas, locations, issueHeaderById }: SaleDetailPanelProps) {
  const router = useRouter();
  const params = useParams<{ collectionSlug: string }>();
  const { invalidateAll } = useInvalidateSales();
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

  // Moving to `paid` is the moment the money is known, and #205's buyer handling is derived from
  // it — so a sale whose buyer side has no anchor yet is asked for the total right here (#443)
  // instead of sending the collector to the amounts card. A sale that already carries either
  // anchor (a stored total, or a handling entered directly) has answered the question; re-asking
  // would silently overwrite that choice, since the two are mutually exclusive.
  const buyerSideUnanchored = sale.buyerPaidTotal == null && sale.buyerHandling == null;

  function applyStatus(next: string) {
    if (next === sale.status) return;
    if (next === "paid" && buyerSideUnanchored) {
      setError(undefined);
      setDialog({ kind: "paidTotal" });
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
          {/* Printable packing list (#330) — a paper checklist of the sold copies, in shelf order. */}
          <Link
            href={`/c/${params.collectionSlug}/sales/${sale.id}/packing-list`}
            style={{ ...SECONDARY_BTN, marginLeft: "auto", textDecoration: "none", display: "inline-block" }}
            title="Open a print-friendly packing list for this sale"
          >
            🖨 Packing list
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
                    🔗 Transaction
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
              <Tooltip content="Derived from the total paid minus the offer prices" style={{ display: "block" }}>
                <div style={ORIG_CELL}>
                  <span style={{ paddingRight: VALUE_INSET }}>
                    {sale.buyerHandling} {sale.currency}
                  </span>
                </div>
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
            platformId={sale.platformId}
            methodId={sale.shippingMethodId}
            methodName={sale.shippingMethodName}
            amount={sale.shippingCost}
            currency={sale.shippingCurrency ?? sale.currency}
            saleCurrency={sale.currency}
            baseCurrency={sale.baseCurrency}
            baseEquivalent={sale.shippingBase}
            rateMissing={sale.shippingRateMissing}
            disabled={isPending}
            onSave={(shipping) =>
              run(async () => {
                const { updateSaleShippingAction } = await import("@/app/actions/sales");
                return updateSaleShippingAction(sale.id, shipping);
              })
            }
          />
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
        </div>
      </div>

      {/* Sold units */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Sold units
        </h3>
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

      {error && <div style={{ fontSize: "0.8125rem", color: "var(--color-error)" }}>{error}</div>}

      {sale.lines.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          No sold units yet. Add the offers that sold on this platform.
        </p>
      ) : (
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
          onEditPrice={(lineId, price) =>
            run(async () => {
              const { updateSaleLinePriceAction } = await import("@/app/actions/sales");
              return updateSaleLinePriceAction(lineId, price);
            })
          }
        />
      )}

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
            // A stored method id means a dictionary row; a name without one is the one-off (#468).
            shippingMethodId:
              sale.shippingMethodId ?? (sale.shippingMethodName ? CUSTOM_SHIPPING_METHOD : ""),
            shippingMethodName: sale.shippingMethodName ?? "",
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
                return addSaleLinesAction(sale.id, lines);
              },
              () => setDialog({ kind: "none" })
            )
          }
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
                ✎
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

/** The "− My shipping" row (#206/#468): the **method** the parcel went by, its cost, and the
 * currency that cost was paid in — shipping can be paid in a currency other than the sale's.
 * Read-only it shows the method name beside the amount and — when the currency differs from base —
 * the base-currency equivalent (or a "no rate" flag when unconvertible). Editing commits all of it
 * together via explicit ✓/✕ (a `select` can't share the blur-to-commit trick the single-value rows
 * use).
 *
 * Picking a method from the platform's dictionary re-fills the cost with what that method normally
 * costs, exactly as the header form does — the figure is a default, not a reading. */
function EditableShippingRow({
  platformId,
  methodId,
  methodName,
  amount,
  currency,
  saleCurrency,
  baseCurrency,
  baseEquivalent,
  rateMissing,
  disabled,
  onSave,
}: {
  platformId: string;
  methodId: string | null;
  methodName: string | null;
  amount: string | null;
  currency: string;
  saleCurrency: string;
  baseCurrency: string;
  baseEquivalent: string | null;
  rateMissing: boolean;
  disabled: boolean;
  onSave: (shipping: SaleShippingRaw) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [draftAmount, setDraftAmount] = useState("");
  const [draftCcy, setDraftCcy] = useState(saleCurrency);
  const [draftMethod, setDraftMethod] = useState("");
  const [draftMethodName, setDraftMethodName] = useState("");
  const [methods, setMethods] = useState<ShippingMethodData[]>([]);

  /** The stored method as the select's value: a dictionary id, the custom token when only a name
   * was kept, or "" for a sale that says nothing about how it went. */
  const storedMethodValue = methodId ?? (methodName ? CUSTOM_SHIPPING_METHOD : "");

  // The dictionary is loaded when the row is opened, not with the screen: most visits to a sale
  // never touch shipping, and the list is only ever needed inside this editor.
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    getShippingMethodsAction(platformId)
      .then((rows) => {
        if (!cancelled) setMethods(rows);
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
    setDraftMethod(storedMethodValue);
    setDraftMethodName(methodName ?? "");
    setEditing(true);
  }
  function pickMethod(next: string) {
    setDraftMethod(next);
    const method = methods.find((m) => m.id === next);
    if (method) {
      setDraftAmount(method.cost);
      setDraftCcy(method.currency);
    }
  }
  function commit() {
    setEditing(false);
    // Skip a no-op write (compare against everything the row is showing).
    if (
      draftAmount.trim() === (amount ?? "") &&
      draftCcy === (currency || saleCurrency) &&
      draftMethod === storedMethodValue &&
      draftMethodName.trim() === (methodName ?? "")
    ) {
      return;
    }
    onSave({
      methodId: draftMethod,
      methodName: draftMethodName,
      cost: draftAmount,
      currency: draftCcy,
    });
  }

  return (
    <>
      <div style={ROW_LABEL}>− My shipping</div>
      <div style={ORIG_CELL}>
        {editing ? (
          <span style={{ display: "inline-flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
            {/* The method leads: picking one answers the two fields after it. */}
            <select
              aria-label="Shipping method"
              value={draftMethod}
              onChange={(e) => pickMethod(e.target.value)}
              style={{ ...INPUT_STYLE, width: "11rem", padding: "0.125rem 0.375rem", cursor: "pointer" }}
            >
              <option value="">— no method —</option>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {m.cost} {m.currency}
                </option>
              ))}
              <option value={CUSTOM_SHIPPING_METHOD}>Custom…</option>
            </select>
            {draftMethod === CUSTOM_SHIPPING_METHOD && (
              <input
                type="text"
                aria-label="Custom method name"
                placeholder="Method name"
                value={draftMethodName}
                onChange={(e) => setDraftMethodName(e.target.value)}
                style={{ ...INPUT_STYLE, width: "9rem", padding: "0.125rem 0.375rem" }}
              />
            )}
            <NumericInput
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
                ✓
              </button>
            </Tooltip>
            <Tooltip content="Cancel">
              <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" style={SHIP_ICON_BTN}>
                ✕
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
                ✎
              </span>
              {/* The method is the fact the row leads with once there is one — the cost answers
                  "how much", the method answers "how it went", and a sale often has the second
                  before the postage receipt turns up. */}
              {methodName && (
                <span style={{ color: "var(--color-text-secondary)" }}>{methodName}</span>
              )}
              <span>{amount ? `${amount} ${currency}` : methodName ? "" : "Set"}</span>
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
        ) : baseEquivalent ? (
          // The base column always carries the shipping cost in base (#208/#206) — shown even when
          // paid in the base currency, but then it's exact, so no "≈".
          currency === baseCurrency ? (
            `${baseEquivalent} ${baseCurrency}`
          ) : (
            baseEqText(baseEquivalent, baseCurrency)
          )
        ) : null}
      </div>
    </>
  );
}
