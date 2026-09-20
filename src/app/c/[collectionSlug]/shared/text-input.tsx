"use client";

import { forwardRef } from "react";
import { trimTextInput } from "@/lib/text-input";

/**
 * The free-text fields (#1357). Every place the collector types text that is saved — a name, a
 * title, a reference, a note, a longer description, a search box — is one of these two rather than
 * a bare `<input>` or `<textarea>`, so the whitespace rule is written once and no field can be
 * left out of it. `tests/unit/text-field-coverage.test.ts` is what keeps that true.
 *
 * **The whitespace around what was typed is removed the moment the field is left** — Tab, a click
 * away, or Enter — so what is on screen is what is stored. That is `NumericInput`'s shape for an
 * amount (#1231) applied to text, and it is the same reasoning: a field that shows one value and
 * saves another is the bug, not the fix. Never while typing, which would fight the caret.
 *
 * **Only the ends.** Line breaks and indentation inside a longer text survive untouched, so a
 * description or an album template is not reflowed — see `src/lib/text-input.ts` for the rule and
 * why a whitespace-only value is left as the empty string rather than turned into a `NULL`.
 *
 * The database applies the same rule to every write (`src/lib/prisma-text-trim.ts`), which covers
 * what no field can: a form submitted before its field was ever blurred, an import, the agent API.
 *
 * Both are drop-in: every input prop is forwarded, and the settled value is written into the
 * element *before* `onChange` is called, so a controlled parent reads the trimmed value off the
 * event target exactly as it would from a keystroke. A consumer committing on blur should read
 * `e.currentTarget.value` rather than its own state, for the reason `InlineText` records: the state
 * captured by that render still holds the keystrokes.
 */

/** The `type`s that hold typed prose. Not `password` — a space in a credential is a character the
 *  collector chose, and silently dropping it would lock them out of their own account. Not
 *  `number`, `date` or `color`, which are not text, and not an amount, which is `NumericInput`. */
type TextInputType = "text" | "search" | "url" | "email" | "tel";

/** Rewrite the element to what leaving it means, and tell a controlled parent. */
function settle<E extends HTMLInputElement | HTMLTextAreaElement>(
  e: React.FocusEvent<E> | React.KeyboardEvent<E>,
  onChange: ((e: React.ChangeEvent<E>) => void) | undefined
) {
  const el = e.currentTarget;
  const trimmed = trimTextInput(el.value);
  if (trimmed === el.value) return;
  el.value = trimmed;
  onChange?.(e as unknown as React.ChangeEvent<E>);
}

export const TextInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { type?: TextInputType }
>(function TextInput({ type = "text", onChange, onBlur, onKeyDown, ...rest }, ref) {
  return (
    <input
      {...rest}
      ref={ref}
      type={type}
      onChange={onChange}
      onKeyDown={(e) => {
        // Enter is leaving the field too, and it often submits the form without a blur ever
        // happening — so the value is settled first, before the caller's handler reads it.
        if (e.key === "Enter") settle(e, onChange);
        onKeyDown?.(e);
      }}
      onBlur={(e) => {
        settle(e, onChange);
        onBlur?.(e);
      }}
    />
  );
});

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ onChange, onBlur, ...rest }, ref) {
  return (
    <textarea
      {...rest}
      ref={ref}
      onChange={onChange}
      // No Enter here: in a multi-line field Enter is a line break, not leaving. Blur is the only
      // moment the collector has finished with it.
      onBlur={(e) => {
        settle(e, onChange);
        onBlur?.(e);
      }}
    />
  );
});
