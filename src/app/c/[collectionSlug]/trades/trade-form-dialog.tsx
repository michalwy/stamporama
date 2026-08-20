"use client";

import { useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import type { TradeListItem } from "@/lib/trades";
import { TradePartnerSelect } from "./trade-partner-select";

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

const FIELD_GAP: React.CSSProperties = { marginBottom: "1rem" };

const HINT: React.CSSProperties = {
  margin: "0.25rem 0 0",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

/** A catalog vendor as the dialog needs it — Michel, StampWorld, Fischer. **A vendor, not one of
 * its books**: *Michel Deutschland* prices nothing Polish, and a trade routinely holds material from
 * several areas, so agreeing on a single `CatalogName` would leave half the lines unvaluable. Which
 * book a given line is read in follows from its stamp's area, exactly as everywhere else. */
export interface TradeCatalogVendor {
  id: string;
  name: string;
  abbreviation: string;
}

export interface TradeFormDialogProps {
  mode: "add" | "edit";
  collectionId: string;
  /** Default trade currency — the collection's base currency, which is what a first trade is most
   * likely negotiated in and always a better guess than an empty select. */
  baseCurrency: string;
  /** The catalog vendors this collection knows, for the "agreed catalog" field. */
  catalogVendors: TradeCatalogVendor[];
  /** The row being edited; add mode leaves it undefined. Every field below is already on the loaded
   * list row, so editing needs no extra fetch. */
  trade?: TradeListItem;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

/**
 * Add / edit a trade's header (#646): the partner, the currency the partner's figures are in, the
 * agreed catalog, and how the trade is to be balanced.
 *
 * Its **status is not here**. A lifecycle move has rules — the transition table, and the `agreed`
 * lock over the contents — and a select on a form is exactly the control that lets someone type past
 * them. It is a row action instead, offering only the moves that are legal from where the trade is.
 *
 * Its **sections and lines are not here either**: those are the trade's own screen (#637). A trade
 * is created with one section so there is always somewhere for a line to go.
 */
export function TradeFormDialog({
  mode,
  collectionId,
  baseCurrency,
  catalogVendors,
  trade,
  isPending,
  error,
  onClose,
  onSubmit,
}: TradeFormDialogProps) {
  // The tolerance that is meaningful depends on the mode, so the form follows the radio rather than
  // showing both and leaving the reader to work out which one counts.
  const [balanceByValue, setBalanceByValue] = useState(trade?.balanceByValue ?? false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  const title = mode === "add" ? "Add trade" : "Edit trade";
  const actionLabel = isPending
    ? mode === "add"
      ? "Adding…"
      : "Saving…"
    : mode === "add"
      ? "Add trade"
      : "Save changes";

  return (
    <DialogShell title={title} onClose={onClose} minHeight="22rem" maxWidth="34rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="trade-partner">Exchange partner</LabelWithError>
            <TradePartnerSelect
              collectionId={collectionId}
              initialPartnerId={trade?.partnerId}
              initialPartnerName={trade?.partnerName}
              inputId="trade-partner"
              disabled={isPending}
            />
          </div>

          <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="trade-currency">Partner&rsquo;s currency</LabelWithError>
              <select
                id="trade-currency"
                name="currency"
                defaultValue={trade?.currency ?? baseCurrency}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <p style={HINT}>
                What the partner&rsquo;s figures are quoted in. Your own valuation stays in{" "}
                {baseCurrency}.
              </p>
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="trade-catalog">Agreed catalog</LabelWithError>
              <select
                id="trade-catalog"
                name="catalogVendorId"
                defaultValue={trade?.catalogVendorId ?? ""}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                <option value="">None</option>
                {catalogVendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.abbreviation})
                  </option>
                ))}
              </select>
              <p style={HINT}>
                The catalog both sides speak in — the publisher, not one of its volumes, so a trade
                spanning several countries is still priceable. Optional, and independent of the
                balancing mode below.
              </p>
            </div>
          </div>

          {/* Balancing. Two modes, one tolerance each — pieces or percent, never one number whose
              unit depends on a radio somewhere else on the form. */}
          <fieldset
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              padding: "0.75rem",
              margin: `0 0 1rem`,
            }}
          >
            <legend
              style={{
                fontSize: "0.6875rem",
                fontWeight: 600,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                padding: "0 0.25rem",
              }}
            >
              Balance
            </legend>
            <input type="hidden" name="balanceByValue" value={String(balanceByValue)} />
            <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: "0.375rem", alignItems: "center", fontSize: "0.875rem" }}>
                <input
                  type="radio"
                  name="balanceMode"
                  value="count"
                  checked={!balanceByValue}
                  onChange={() => setBalanceByValue(false)}
                  disabled={isPending}
                />
                By piece count
              </label>
              <label style={{ display: "flex", gap: "0.375rem", alignItems: "center", fontSize: "0.875rem" }}>
                <input
                  type="radio"
                  name="balanceMode"
                  value="value"
                  checked={balanceByValue}
                  onChange={() => setBalanceByValue(true)}
                  disabled={isPending}
                />
                By value
              </label>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="trade-count-tolerance">
                  {balanceByValue ? "Tolerance (%)" : "Tolerance (pieces)"}
                </LabelWithError>
                {/* Only the tolerance the current mode uses is editable, but the other is still
                    submitted, unchanged: switching to piece count to look at it and switching back
                    must not quietly zero the percentage that was agreed. */}
                {balanceByValue ? (
                  <>
                    <NumericInput
                      id="trade-count-tolerance"
                      name="valueTolerancePct"
                      placeholder="0"
                      defaultValue={trade ? String(trade.valueTolerancePct) : ""}
                      disabled={isPending}
                      style={INPUT_STYLE}
                    />
                    <input
                      type="hidden"
                      name="countTolerance"
                      value={trade ? String(trade.countTolerance) : "0"}
                    />
                  </>
                ) : (
                  <>
                    <input
                      id="trade-count-tolerance"
                      name="countTolerance"
                      type="number"
                      min={0}
                      step={1}
                      placeholder="0"
                      defaultValue={trade ? String(trade.countTolerance) : ""}
                      disabled={isPending}
                      style={INPUT_STYLE}
                    />
                    <input
                      type="hidden"
                      name="valueTolerancePct"
                      value={trade ? String(trade.valueTolerancePct) : "0"}
                    />
                  </>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="trade-own-warn">Warn on skew (%)</LabelWithError>
                <NumericInput
                  id="trade-own-warn"
                  name="ownValueWarnPct"
                  placeholder="25"
                  defaultValue={trade ? String(trade.ownValueWarnPct) : ""}
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
                <p style={HINT}>
                  Against your own valuation. A warning, never a block — an uneven trade can be
                  entirely deliberate.
                </p>
              </div>
            </div>
          </fieldset>

          <div>
            <LabelWithError htmlFor="trade-notes">Notes</LabelWithError>
            <textarea
              id="trade-notes"
              name="notes"
              rows={3}
              defaultValue={trade?.notes ?? ""}
              disabled={isPending}
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          onCancel={onClose}
          disabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
