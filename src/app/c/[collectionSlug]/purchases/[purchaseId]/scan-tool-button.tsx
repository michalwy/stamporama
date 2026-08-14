"use client";

import { Icon, type IconName } from "@/app/icons";

/**
 * One control in a scan surface's toolbar — zoom, fit, 1:1, merge, split, which side is showing.
 *
 * Shared by the cut editor (#579) and the tile viewer (#585) because they are the same toolbar over
 * the same picture: a collector who has learned that **Fit** is the lit one on a card must not have
 * to learn a second vocabulary one dialog away.
 */
export function ScanToolButton({
  icon,
  label,
  hint,
  disabled,
  active,
  onClick,
}: {
  /** Optional: `1:1` is its own picture, and the vocabulary is deliberately not the place to invent
   * a glyph for a ratio that reads perfectly well as two characters. */
  icon?: IconName;
  label: string;
  hint: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        padding: "0.3125rem 0.625rem",
        borderRadius: "0.375rem",
        fontSize: "0.8125rem",
        border: "1px solid var(--color-border-strong)",
        background: active ? "var(--color-action-primary)" : "var(--color-bg-elevated)",
        color: active ? "#fff" : "var(--color-text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon && <Icon name={icon} size="sm" />}
      {label}
    </button>
  );
}
