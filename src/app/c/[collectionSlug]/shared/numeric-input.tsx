"use client";

import { forwardRef } from "react";
import {
  formatAmountInput,
  normalizeDecimalInput,
  sanitizeDecimalInput,
} from "@/lib/decimal-input";

/**
 * A decimal amount field that accepts both "," and "." as the decimal separator, regardless of
 * the user's locale (#233). Native `type="number"` can't do this — a comma is silently dropped in
 * period-locale browsers — so this is a `type="text"` input with `inputMode="decimal"` that
 * live-sanitises its value (commas → periods, stray characters stripped) as you type.
 *
 * It also takes a **simple arithmetic expression** (#580) — `1+2`, `12.50*3`, `(4,20+1,80)/2` —
 * and replaces it with the result when the field loses focus, so summing a few prices or applying
 * a discount needs no calculator. An expression that doesn't parse is left exactly as typed and
 * fails validation like any other unparseable amount. The same evaluation runs server-side
 * (`normalizeDecimalInput`), which covers a form submitted before the field was ever blurred.
 *
 * **`kind` is required**, so no field can skip the question (#1231). An `"amount"` — money of any
 * sort — is shown at exactly two decimal places the moment the collector leaves it, by Tab, a click
 * elsewhere or Enter (`formatAmountInput`); a `"number"` — a percentage, a quantity — is only
 * evaluated. Nothing is rewritten while the field is still being typed in.
 *
 * Drop-in for the money `<input>`s across the app: it forwards every input prop and calls through
 * the given `onChange` after rewriting the DOM value, so it works both controlled
 * (`value`/`onChange`) and uncontrolled (`name`/`defaultValue`, read back via `FormData`).
 */
export const NumericInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { kind: "amount" | "number" }
>(function NumericInput({ kind, onChange, onBlur, onKeyDown, inputMode = "decimal", ...rest }, ref) {
  // Rewrites the field to what leaving it means, and tells a controlled parent: a blur or key event
  // carries the same target, so the parent reads the new value off it exactly as it would from a
  // change — without this the state keeps the keystrokes while the DOM shows the result.
  const settle = (e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const settled = kind === "amount" ? formatAmountInput(el.value) : normalizeDecimalInput(el.value);
    if (settled !== el.value) {
      el.value = settled;
      onChange?.(e as unknown as React.ChangeEvent<HTMLInputElement>);
    }
  };

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode={inputMode}
      onChange={(e) => {
        const el = e.currentTarget;
        const caret = el.selectionStart ?? el.value.length;
        const cleaned = sanitizeDecimalInput(el.value);
        if (cleaned !== el.value) {
          // Keep the caret where the user is typing: its new position is the length of the
          // sanitised prefix up to the old caret.
          const cleanedCaret = sanitizeDecimalInput(el.value.slice(0, caret)).length;
          el.value = cleaned;
          el.setSelectionRange(cleanedCaret, cleanedCaret);
        }
        onChange?.(e);
      }}
      onKeyDown={(e) => {
        // Enter is leaving the field too, and it often submits the form without a blur ever
        // happening — so the amount is settled first, before the caller's handler or the submit
        // reads it.
        if (kind === "amount" && e.key === "Enter") settle(e);
        onKeyDown?.(e);
      }}
      onBlur={(e) => {
        settle(e);
        onBlur?.(e);
      }}
    />
  );
});
