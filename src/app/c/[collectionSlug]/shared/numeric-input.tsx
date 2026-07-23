"use client";

import { forwardRef } from "react";
import { sanitizeDecimalInput } from "@/lib/decimal-input";

/**
 * A decimal amount field that accepts both "," and "." as the decimal separator, regardless of
 * the user's locale (#233). Native `type="number"` can't do this — a comma is silently dropped in
 * period-locale browsers — so this is a `type="text"` input with `inputMode="decimal"` that
 * live-sanitises its value (commas → periods, non-numeric characters stripped) as you type.
 *
 * Drop-in for the money `<input>`s across the app: it forwards every input prop and calls through
 * the given `onChange` after rewriting the DOM value, so it works both controlled
 * (`value`/`onChange`) and uncontrolled (`name`/`defaultValue`, read back via `FormData`).
 */
export const NumericInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(function NumericInput({ onChange, inputMode = "decimal", ...rest }, ref) {
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
    />
  );
});
