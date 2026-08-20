"use client";

import { useState, useTransition, type FormEvent } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import type { TradeLineValueRead } from "@/lib/trade-valuation";
import { setTradeLineValueAction } from "@/app/actions/trades";
import { useInvalidateTradeDetail } from "./use-trade-detail-query";
import type { TradeCatalogVendor } from "../trade-form-dialog";

// **What this one line is worth** (#638; ADR-0039 §7) — the two escape hatches, and nothing else.
//
// The dialog exists because of two cases the catalogues cannot answer, and it is deliberately small
// enough that neither becomes a habit:
//
//   - **A manual value.** Material no catalogue in the collection prices must not deadlock a trade,
//     and a zero is not something the app will ever assume on the collector's behalf. But the
//     default reflex has to stay *type the price on the stamp* — a price is a property of the stamp
//     and once entered it is there for good, while a figure typed here describes one line of one
//     trade — so the hint says exactly that, and the number is marked as the collector's own
//     everywhere it is subsequently shown.
//   - **A different publisher for this line.** "This one we look up in Fischer instead." A vendor,
//     not a book: which volume the line is read in still follows from its stamp's area, exactly as
//     it does for the trade's own agreed catalogue.
//
// It shows what the line is currently valued at, and where each figure came from, above both — a
// dialog that asked for an override without saying what it was overriding would be asking blind.

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

const HINT: React.CSSProperties = {
  margin: "0.375rem 0 0",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.5,
};

const LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

/** One valuation as it currently stands: the figure, and the book and edition behind it. Both
 *  halves, because a converted number with no source beside it is one nobody can check. */
function CurrentFigure({
  label,
  value,
  currency,
  catalogName,
  editionYear,
  amount,
  amountCurrency,
  uncertain,
  manual,
  absentNote,
}: {
  label: string;
  value: number | null;
  currency: string;
  catalogName: string | null;
  editionYear: number | null;
  amount: number | null;
  amountCurrency: string | null;
  uncertain: boolean;
  manual: boolean;
  absentNote: string;
}) {
  const source = manual
    ? "your own figure, not a catalogue's"
    : catalogName
      ? `${catalogName}${editionYear ? ` ${editionYear}` : ""}${
          amount !== null && amountCurrency && amountCurrency !== currency
            ? `, ${amount.toFixed(2)} ${amountCurrency}`
            : ""
        }`
      : null;

  return (
    <div>
      <div style={LABEL}>{label}</div>
      <div style={{ fontSize: "0.9375rem", color: "var(--color-text-primary)" }}>
        {value === null ? (
          <span style={{ color: "var(--color-text-muted)" }}>{absentNote}</span>
        ) : (
          <>
            {/* `~` is this app's own mark for *inferred, not recorded* (#238) — an unknown-variant
                rollup is an estimate and says so wherever it is printed. */}
            {uncertain ? "~" : ""}
            {value.toFixed(2)} {currency}
          </>
        )}
      </div>
      {source && <div style={{ ...HINT, margin: "0.2rem 0 0" }}>{source}</div>}
    </div>
  );
}

export function TradeLineValueDialog({
  collectionId,
  line,
  baseCurrency,
  tradeCurrency,
  agreedVendorName,
  catalogVendors,
  onClose,
}: {
  collectionId: string;
  line: TradeLineValueRead;
  baseCurrency: string;
  tradeCurrency: string;
  /** The trade's own agreed catalogue, so *follow the trade* is said in words rather than implied.
   *  Null on a trade that names none — the publisher field is then absent entirely, because there
   *  is no second valuation for it to redirect. */
  agreedVendorName: string | null;
  catalogVendors: TradeCatalogVendor[];
  onClose: () => void;
}) {
  const { invalidateTrade } = useInvalidateTradeDetail();
  const [manualValue, setManualValue] = useState(
    line.manualValue === null ? "" : line.manualValue.toFixed(2)
  );
  const [vendorId, setVendorId] = useState(line.catalogVendorId ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    startTransition(async () => {
      const result = await setTradeLineValueAction(line.lineId, {
        manualValue,
        // Only sent where the trade has an agreed catalogue at all — absent means "leave it alone",
        // which is what a trade with no second valuation should be told.
        ...(agreedVendorName ? { catalogVendorId: vendorId || null } : {}),
      });
      if (result.status === "success") {
        // The whole `trades` key: this line's figure changes its section's verdict, the trade's
        // totals and possibly whether the trade can be shared at all.
        invalidateTrade(collectionId);
        onClose();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <DialogShell title={`Value — ${line.label}`} onClose={onClose} maxWidth="34rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {/* What is being overridden, stated before the controls that override it. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))",
                gap: "1rem",
                padding: "0.75rem",
                borderRadius: "0.5rem",
                background: "var(--color-bg-page)",
                border: "1px solid var(--color-border)",
              }}
            >
              <CurrentFigure
                label="My valuation"
                value={line.own}
                currency={baseCurrency}
                catalogName={line.ownCatalogName}
                editionYear={line.ownEditionYear}
                amount={line.ownAmount}
                amountCurrency={line.ownCurrency}
                uncertain={line.ownUncertain}
                manual={line.ownManual}
                absentNote="No catalogue price at this stamp's condition, certificate and format."
              />
              {agreedVendorName && (
                <CurrentFigure
                  label={`Agreed catalog · ${line.catalogVendorName ?? agreedVendorName}`}
                  value={line.agreed}
                  currency={tradeCurrency}
                  catalogName={line.agreedCatalogName}
                  editionYear={line.agreedEditionYear}
                  amount={line.agreedAmount}
                  amountCurrency={line.agreedCurrency}
                  uncertain={line.agreedUncertain}
                  manual={line.agreedManual}
                  absentNote="That publisher prices nothing at this key for this stamp's area."
                />
              )}
            </div>

            <div>
              <LabelWithError htmlFor="trade-line-manual-value">
                My own value ({baseCurrency})
              </LabelWithError>
              <input
                id="trade-line-manual-value"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                inputMode="decimal"
                autoFocus
                disabled={isPending}
                placeholder="Leave blank to use the catalogues"
                style={INPUT_STYLE}
              />
              <p style={HINT}>
                For material no catalogue of yours prices. Prefer typing the price on the stamp
                itself — that is a fact about the stamp and every screen in the app will use it,
                where this describes one line of one trade. It is always shown as your own figure,
                never as a catalogue&apos;s, and it stands in for both valuations on this line.
              </p>
            </div>

            {agreedVendorName && (
              <div>
                <LabelWithError htmlFor="trade-line-vendor">
                  Look this line up in
                </LabelWithError>
                <select
                  id="trade-line-vendor"
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  disabled={isPending}
                  style={INPUT_STYLE}
                >
                  <option value="">Follow the trade — {agreedVendorName}</option>
                  {catalogVendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
                <p style={HINT}>
                  A publisher, not one of its books — which volume this line is read in still follows
                  from its stamp&apos;s area. Only the agreed valuation changes; what these stamps are
                  worth to you is always read from your own primary catalogue.
                </p>
              </div>
            )}
          </div>
        </DialogBody>

        <DialogActions
          actionLabel={isPending ? "Saving…" : "Save value"}
          disabled={isPending}
          cancelDisabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}
