"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { IssueHeader } from "@/lib/issues";
import type { SaleDetail } from "@/lib/sales";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { SaleFormDialog } from "../sale-form-dialog";
import { AddSaleLineDialog } from "../add-sale-line-dialog";
import { useInvalidateSales } from "../use-sales-query";
import { SoldUnitsView } from "./sold-units-view";

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
  | { kind: "removeLine"; lineId: string; label: string };

interface SaleDetailPanelProps {
  collectionId: string;
  sale: SaleDetail;
  areas: CollectionAreaData[];
  locations: LocationData[];
  issueHeaderById: Record<string, IssueHeader>;
}

export function SaleDetailPanel({ collectionId, sale, areas, locations, issueHeaderById }: SaleDetailPanelProps) {
  const router = useRouter();
  const { invalidateAll } = useInvalidateSales();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [error, setError] = useState<string | undefined>();

  const soldDate = formatDate(sale.soldAt);

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
          <button
            type="button"
            onClick={() => {
              setError(undefined);
              setDialog({ kind: "editHeader" });
            }}
            disabled={isPending}
            style={{ ...SECONDARY_BTN, marginLeft: "auto" }}
          >
            Edit header
          </button>
        </div>
        <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={CHIP}>{soldDate}</span>
          <span style={CHIP}>{sale.currency}</span>
          {sale.externalRef && (
            <span style={CHIP} title="Order number in the marketplace">
              # {sale.externalRef}
            </span>
          )}
          {sale.fxRateToBase && (
            <span style={CHIP} title={`Frozen FX rate to ${sale.baseCurrency}: ${sale.fxRateToBase}`}>
              → {sale.baseCurrency} @ {formatRate(sale.fxRateToBase)}
            </span>
          )}
          <span
            style={{ marginLeft: "auto", fontSize: "0.9375rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
            title="Net proceeds (base currency)"
          >
            {sale.netProceeds} {sale.baseCurrency}
          </span>
        </div>
        {sale.fxRateToBase == null && sale.currency !== sale.baseCurrency && (
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "var(--color-warning, var(--color-text-muted))" }}>
            No exchange rate to {sale.baseCurrency} is known for this sale yet, so base-currency
            profit/loss cannot be computed. Add a rate first.
          </p>
        )}
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
              <div style={ORIG_CELL} title="Derived from the total paid minus the offer prices">
                <span style={{ paddingRight: VALUE_INSET }}>
                  {sale.buyerHandling} {sale.currency}
                </span>
              </div>
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
            amount={sale.shippingCost}
            currency={sale.shippingCurrency ?? sale.currency}
            saleCurrency={sale.currency}
            baseCurrency={sale.baseCurrency}
            baseEquivalent={sale.shippingBase}
            rateMissing={sale.shippingRateMissing}
            disabled={isPending}
            onSave={(amount, ccy) =>
              run(async () => {
                const { updateSaleShippingAction } = await import("@/app/actions/sales");
                return updateSaleShippingAction(sale.id, amount, ccy);
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
            soldAt: soldDate,
            currency: sale.currency,
            buyerHandling: sale.buyerPaidTotal != null ? "" : (sale.buyerHandling ?? ""),
            buyerPaidTotal: sale.buyerPaidTotal ?? "",
            commission: sale.commission ?? "",
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
          <button
            type="button"
            onClick={open}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            disabled={disabled}
            title="Click to edit"
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

/** The "− My shipping" row (#206): editable amount **plus a currency selector**, since shipping can
 * be paid in a currency other than the sale's. Read-only it shows the entered amount and — when the
 * currency differs from base — its base-currency equivalent (or a "no rate" flag when unconvertible).
 * Editing commits amount + currency together via explicit ✓/✕ (a currency `select` can't share the
 * blur-to-commit trick the single-value rows use). */
function EditableShippingRow({
  amount,
  currency,
  saleCurrency,
  baseCurrency,
  baseEquivalent,
  rateMissing,
  disabled,
  onSave,
}: {
  amount: string | null;
  currency: string;
  saleCurrency: string;
  baseCurrency: string;
  baseEquivalent: string | null;
  rateMissing: boolean;
  disabled: boolean;
  onSave: (amount: string, currency: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [draftAmount, setDraftAmount] = useState("");
  const [draftCcy, setDraftCcy] = useState(saleCurrency);

  function open() {
    if (disabled) return;
    setDraftAmount(amount ?? "");
    setDraftCcy(currency || saleCurrency);
    setEditing(true);
  }
  function commit() {
    setEditing(false);
    // Skip a no-op write (compare against the shown amount + currency).
    if (draftAmount.trim() === (amount ?? "") && draftCcy === (currency || saleCurrency)) return;
    onSave(draftAmount, draftCcy);
  }

  return (
    <>
      <div style={ROW_LABEL}>− My shipping</div>
      <div style={ORIG_CELL}>
        {editing ? (
          <span style={{ display: "inline-flex", gap: "0.375rem", alignItems: "center" }}>
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
            <button type="button" onClick={commit} title="Save" aria-label="Save shipping" style={SHIP_ICON_BTN}>
              ✓
            </button>
            <button type="button" onClick={() => setEditing(false)} title="Cancel" aria-label="Cancel" style={SHIP_ICON_BTN}>
              ✕
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={open}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            disabled={disabled}
            title="Click to edit"
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
            <span>{amount ? `${amount} ${currency}` : "Set"}</span>
          </button>
        )}
      </div>
      <div style={rateMissing ? { ...BASE_CELL, color: "var(--color-error)" } : BASE_CELL}>
        {rateMissing ? (
          <span title={`No exchange rate from ${currency} to ${baseCurrency} is known yet, so this cost is not in the base net.`}>
            no rate
          </span>
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
