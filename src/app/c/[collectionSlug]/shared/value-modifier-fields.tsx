"use client";

import { useState } from "react";
import { LabelWithError } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import type { ValueModifier } from "@/lib/valuation";
import {
  parseValueModifierInput,
  valueModifierLabel,
  valueModifierSummary,
  type ValueModifierDraft,
} from "@/lib/value-modifier";
import { NO_AUTOFILL } from "./no-autofill";
import { NumericInput } from "./numeric-input";
import { TextInput } from "./text-input";
import { Tooltip } from "./tooltip";

// A copy's value modifier (#2357) where a copy's value is worked out (#2398) — identification and the
// piece's Valuation window — as the copy's Edit dialog asks it: the same three fields, the same hint,
// read by the same `parseValueModifierInput`, folded behind the same `ValueModifierDisclosure` line
// (#2404). The Edit dialog keeps its own uncontrolled fields; these are held as text by the surface,
// which values what is typed before it is saved.

/** The value modifier's hover (#2357) — the Edit dialog's, and every other place that asks it. */
export const VALUE_MODIFIER_HINT =
  "A catalogue exception this copy carries — a cancellation surcharge, a rare usage. Its catalog value is multiplied by the percentage, then the amount is added (in the catalog's own currency), and only then do faults take their reduction. The note says why, and is shown wherever the modifier is. Leave both figures empty for none.";

/**
 * The modifier behind one line (#2404): most copies never take one, so its fields stay folded under
 * *Value modifier* until opened — and a modifier that is set is named on that line, *Value modifier
 * +200 % · Stempel Danzig*, so it is never hidden. Folded, the fields stay mounted and are only not
 * drawn, so a surrounding form still submits them and an uncontrolled field keeps what was typed. An
 * error holds it open: a refusal is never folded away.
 */
export function ValueModifierDisclosure({
  draft,
  currency,
  defaultOpen = false,
  error,
  children,
}: {
  /** What the fields hold now — the line names it once it reads as a modifier. */
  draft: ValueModifierDraft;
  /** The currency of the figure the amount adjusts; null where none is known. */
  currency: string | null;
  /** Open on arriving — a copy that already has a modifier, in Edit and its Valuation window. */
  defaultOpen?: boolean;
  /** Why what is typed is not saved, if it is not. */
  error?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = open || Boolean(error);
  const parsed = parseValueModifierInput(draft.percent, draft.amount, draft.note);
  const summary = !parsed.ok
    ? "not a valid modifier"
    : parsed.value
      ? valueModifierSummary(parsed.value, currency)
      : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setOpen(!shown)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          width: "fit-content",
          padding: 0,
          border: "none",
          background: "none",
          font: "inherit",
          fontSize: "0.875rem",
          fontWeight: 500,
          textAlign: "left",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "inline-flex", color: "var(--color-text-muted)" }}>
          <Icon name={shown ? "collapse" : "expand"} size="sm" />
        </span>
        <span>Value modifier</span>
        {summary && (
          <span
            style={{
              fontWeight: 400,
              color: parsed.ok ? "var(--color-text-primary)" : "var(--color-error)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {summary}
          </span>
        )}
      </button>
      <div style={shown ? { display: "flex", flexDirection: "column", gap: "0.375rem" } : { display: "none" }}>
        {children}
      </div>
    </div>
  );
}

/** The three fields, named as the copy form names them so a surrounding form submits them. */
export function ValueModifierFields({
  idPrefix,
  value,
  onChange,
  disabled,
  inputStyle,
  error,
}: {
  idPrefix: string;
  value: ValueModifierDraft;
  onChange: (next: ValueModifierDraft) => void;
  disabled?: boolean;
  inputStyle: React.CSSProperties;
  /** Why what is typed is not a modifier, beside the first label. */
  error?: string;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "6.5rem 7.5rem 1fr", gap: "0.75rem" }}>
      <div>
        <LabelWithError htmlFor={`${idPrefix}-percent`}>
          {/* The label is a block; the tooltip's default `inline-flex` wrapper would drop it (#1752). */}
          <Tooltip content={VALUE_MODIFIER_HINT} style={{ display: "flex", width: "fit-content" }}>
            <span>Value modifier</span>
          </Tooltip>
        </LabelWithError>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <NumericInput
            kind="number"
            inputMode="text"
            id={`${idPrefix}-percent`}
            name="valueModifierPercent"
            placeholder="None"
            value={value.percent}
            onChange={(e) => onChange({ ...value, percent: e.target.value })}
            disabled={disabled}
            {...NO_AUTOFILL}
            style={{ ...inputStyle, textAlign: "right" }}
          />
          <span style={{ color: "var(--color-text-muted)" }}>%</span>
        </div>
      </div>
      <div>
        <LabelWithError htmlFor={`${idPrefix}-amount`}>Amount</LabelWithError>
        <NumericInput
          kind="amount"
          inputMode="text"
          id={`${idPrefix}-amount`}
          name="valueModifierAmount"
          placeholder="None"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          disabled={disabled}
          {...NO_AUTOFILL}
          style={{ ...inputStyle, textAlign: "right" }}
        />
      </div>
      <div style={{ minWidth: 0 }}>
        <LabelWithError htmlFor={`${idPrefix}-note`} error={error}>
          Modifier note
        </LabelWithError>
        <TextInput
          id={`${idPrefix}-note`}
          name="valueModifierNote"
          placeholder="e.g. Stempel Danzig +200 %"
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          disabled={disabled}
          {...NO_AUTOFILL}
          style={inputStyle}
        />
      </div>
    </div>
  );
}

/**
 * What the modifier comes to: the figure it adjusts, the modifier with its note, and the value it
 * makes — before the faults' reduction. *Catalog value 10.00 EUR · +200 % (Stempel Danzig) →
 * 30.00 EUR*.
 */
export function ValueModifierResult({
  from,
  fullAmount,
  amount,
  currency,
  modifier,
}: {
  /** What the adjusted figure is called: *Catalog value*, *Computed value*. */
  from: string;
  fullAmount: string;
  amount: string;
  currency: string | null;
  modifier: ValueModifier;
}) {
  const cur = currency ? ` ${currency}` : "";
  return (
    <div style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
      {from}{" "}
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {fullAmount}
        {cur}
      </span>{" "}
      · {valueModifierLabel(modifier, currency)}
      {modifier.note ? ` (${modifier.note})` : ""} →{" "}
      <strong style={{ color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
        {amount}
        {cur}
      </strong>
    </div>
  );
}
