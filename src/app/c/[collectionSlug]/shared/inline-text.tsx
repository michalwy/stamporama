"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "./tooltip";

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
  background: "none",
  border: "none",
  padding: "0 0.125rem",
  cursor: "pointer",
  color: "var(--color-text-muted)",
  fontSize: "0.75rem",
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
  onSave,
}: {
  value: string;
  placeholder: string;
  display: React.ReactNode;
  editable: boolean;
  isPending: boolean;
  inputType: "url" | "number" | "text";
  suffix?: string;
  editControl?: boolean;
  editAriaLabel?: string;
  /** Select the existing value when edit mode opens (#329), so the first keystroke replaces it
   *  instead of landing beside it — the pattern the picker's search field uses (#183). For a short
   *  value that is typically retyped whole, like a price; not for a URL you came back to amend. */
  selectOnEdit?: boolean;
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
              ✎
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

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
      <input
        ref={inputRef}
        autoFocus
        type={inputType}
        value={draft}
        placeholder={placeholder}
        disabled={isPending}
        min={inputType === "number" ? "0" : undefined}
        step={inputType === "number" ? "0.01" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        style={{ ...INLINE_INPUT, width: inputType === "url" ? "16rem" : inputType === "text" ? "20rem" : "6rem", textAlign: inputType === "number" ? "right" : "left" }}
      />
      {suffix && <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{suffix}</span>}
    </span>
  );
}
