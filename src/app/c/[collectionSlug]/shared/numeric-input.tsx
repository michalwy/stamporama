"use client";

import { forwardRef } from "react";
import { normalizeDecimalInput, sanitizeDecimalInput } from "@/lib/decimal-input";

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
 * Drop-in for the money `<input>`s across the app: it forwards every input prop and calls through
 * the given `onChange` after rewriting the DOM value, so it works both controlled
 * (`value`/`onChange`) and uncontrolled (`name`/`defaultValue`, read back via `FormData`).
 */
export const NumericInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(function NumericInput({ onChange, onBlur, inputMode = "decimal", ...rest }, ref) {
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
      onBlur={(e) => {
        const el = e.currentTarget;
        const evaluated = normalizeDecimalInput(el.value);
        if (evaluated !== el.value) {
          el.value = evaluated;
          // A blur event carries the same target, so a controlled parent reads the new value off
          // it exactly as it would from a change — without this the state keeps the expression.
          onChange?.(e as unknown as React.ChangeEvent<HTMLInputElement>);
        }
        onBlur?.(e);
      }}
    />
  );
});
