"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";
import { NumericInput } from "./numeric-input";
import { TextInput } from "./text-input";

const INLINE_INPUT: React.CSSProperties = {
  padding: "0.125rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const EDIT_CONTROL: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  background: "none",
  border: "none",
  padding: "0 0.125rem",
  cursor: "pointer",
  color: "var(--color-text-muted)",
  lineHeight: 1,
};

/** A click-to-edit inline field: shows `display`, and on click swaps to an input that commits on
 * Enter / blur and reverts on Escape. Used for the offer's price and listing URL and the sale's
 * transaction link (#292). When `editControl` is set, the display is left interactive (e.g. a link
 * that opens) and a separate pencil button beside it enters edit mode, so the display's own click
 * is never hijacked (#214). */
export function InlineText({
  value,
  placeholder,
  display,
  editable,
  isPending,
  inputType,
  suffix,
  editControl = false,
  editAriaLabel = "Edit",
  selectOnEdit = false,
  inputStyle,
  onSave,
}: {
  value: string;
  placeholder: string;
  display: React.ReactNode;
  editable: boolean;
  isPending: boolean;
  /** `"amount"` is money: the shared amount field, so a comma, a small sum and two decimals once the
   *  field is left all behave as they do in every other amount field (#233, #580, #1231). */
  inputType: "url" | "amount" | "text";
  suffix?: string;
  editControl?: boolean;
  editAriaLabel?: string;
  /** Select the existing value when edit mode opens (#329), so the first keystroke replaces it
   *  instead of landing beside it — the pattern the picker's search field uses (#183). For a short
   *  value that is typically retyped whole, like a price; not for a URL you came back to amend. */
  selectOnEdit?: boolean;
  /**
   * Overrides for the input box, merged over the shared one. For a field whose *display* is smaller
   * than the default input — the base-currency line under an auction amount (#498) — where the
   * standard box would make the row taller the moment editing starts, and shorter again when it
   * ends. Give it the metrics of the text it replaces and nothing on the screen moves.
   */
  inputStyle?: React.CSSProperties;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // On entering edit mode only — not on every focus — so clicking back into the field to fix one
  // digit still puts the caret where it was clicked.
  useEffect(() => {
    if (editing && selectOnEdit) inputRef.current?.select();
  }, [editing, selectOnEdit]);

  if (!editable) return <>{display}</>;

  function startEditing() {
    setDraft(value);
    setEditing(true);
  }

  if (!editing) {
    if (editControl) {
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          {display}
          <Tooltip content={editAriaLabel}>
            <button
              type="button"
              onClick={startEditing}
              disabled={isPending}
              aria-label={editAriaLabel}
              style={EDIT_CONTROL}
            >
              <Icon name="edit" size="sm" />
            </button>
          </Tooltip>
        </span>
      );
    }
    return (
      <Tooltip content="Click to edit">
        <span
          role="button"
          tabIndex={0}
          onClick={startEditing}
          onKeyDown={(e) => {
            if (e.key === "Enter") startEditing();
          }}
          style={{ cursor: "text", display: "inline-flex", alignItems: "center" }}
        >
          {display}
        </span>
      </Tooltip>
    );
  }

  // Read off the element rather than off `draft`: an amount field settles its figure into the input on
  // blur and only then calls this, so the state from this render still holds the keystrokes.
  function commit(e: React.FocusEvent<HTMLInputElement>) {
    const next = e.currentTarget.value;
    setEditing(false);
    if (next !== value) onSave(next);
  }

  const fieldProps = {
    ref: inputRef,
    autoFocus: true,
    value: draft,
    placeholder,
    disabled: isPending,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") e.currentTarget.blur();
      else if (e.key === "Escape") {
        setDraft(value);
        setEditing(false);
      }
    },
    style: {
      ...INLINE_INPUT,
      width: inputType === "url" ? "16rem" : inputType === "text" ? "20rem" : "6rem",
      textAlign: inputType === "amount" ? "right" : "left",
      ...inputStyle,
    } satisfies React.CSSProperties,
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
      {inputType === "amount" ? (
        <NumericInput kind="amount" {...fieldProps} />
      ) : (
        <TextInput type={inputType} {...fieldProps} />
      )}
      {suffix && <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{suffix}</span>}
    </span>
  );
}
