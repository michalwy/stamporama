"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { IssueHeader } from "@/lib/issues";
import type { SaleDetail } from "@/lib/sales";
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
            title="Net proceeds (transaction currency)"
          >
            {sale.netProceeds} {sale.currency}
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
        <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          <AmountLine label="Gross proceeds">
            <span style={READONLY_VALUE_STYLE}>
              {sale.grossProceeds} {sale.currency}
            </span>
          </AmountLine>
          <EditableAmountRow
            label="+ Buyer handling"
            value={sale.buyerHandling}
            currency={sale.currency}
            disabled={isPending}
            onSave={(next) =>
              run(async () => {
                const { updateSaleAmountAction } = await import("@/app/actions/sales");
                return updateSaleAmountAction(sale.id, "buyerHandling", next);
              })
            }
          />
          <EditableAmountRow
            label="− My shipping"
            value={sale.shippingCost}
            currency={sale.currency}
            disabled={isPending}
            onSave={(next) =>
              run(async () => {
                const { updateSaleAmountAction } = await import("@/app/actions/sales");
                return updateSaleAmountAction(sale.id, "shippingCost", next);
              })
            }
          />
          <EditableAmountRow
            label="− Commission"
            value={sale.commission}
            currency={sale.currency}
            disabled={isPending}
            onSave={(next) =>
              run(async () => {
                const { updateSaleAmountAction } = await import("@/app/actions/sales");
                return updateSaleAmountAction(sale.id, "commission", next);
              })
            }
          />
          <AmountLine label="Net proceeds" bold topBorder>
            <span style={{ ...READONLY_VALUE_STYLE, color: "var(--color-text-primary)" }}>
              {sale.netProceeds} {sale.currency}
            </span>
          </AmountLine>
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
            buyerHandling: sale.buyerHandling ?? "",
            commission: sale.commission ?? "",
          }}
          platformLocked={sale.lines.length > 0}
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

// Shared right-hand value geometry so read-only and editable rows line their numbers up in the
// same column (identical horizontal inset on both).
const VALUE_INSET = "0.375rem";
const READONLY_VALUE_STYLE: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-primary)",
  padding: `0.125rem ${VALUE_INSET}`,
};

/** One breakdown row: label on the left, a value node on the right. `bold` / `topBorder` style
 * the net-proceeds total. */
function AmountLine({
  label,
  bold,
  topBorder,
  children,
}: {
  label: string;
  bold?: boolean;
  topBorder?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        minHeight: "1.75rem",
        fontWeight: bold ? 600 : undefined,
        ...(topBorder
          ? { borderTop: "1px solid var(--color-border)", paddingTop: "0.5rem", marginTop: "0.25rem" }
          : {}),
      }}
    >
      <span style={{ color: bold ? "var(--color-text-primary)" : undefined }}>{label}</span>
      {children}
    </div>
  );
}

/** A breakdown row whose amount is editable in place: shows the value (or a muted "Set" when
 * empty) with a pencil affordance; clicking opens a compact number input that commits on
 * Enter/blur and reverts on Escape. The number's right edge matches the read-only rows. */
function EditableAmountRow({
  label,
  value,
  currency,
  disabled,
  onSave,
}: {
  label: string;
  value: string | null;
  currency: string;
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
    <AmountLine label={label}>
      {editing ? (
        <input
          type="number"
          min="0"
          step="0.01"
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
    </AmountLine>
  );
}
