"use client";

import { Icon, type IconName } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

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
  tint,
  onClick,
}: {
  /** Optional: `1:1` is its own picture, and the vocabulary is deliberately not the place to invent
   * a glyph for a ratio that reads perfectly well as two characters. */
  icon?: IconName;
  label: string;
  hint: string;
  disabled?: boolean;
  active?: boolean;
  /**
   * A CSS colour to wear instead of the accent — for the one kind of control where **the colour is
   * the subject**, not a status: the watermark tool's channel chips (#625), which are the red, the
   * green and the blue of the scan itself.
   *
   * A deliberate exception to the semantic-token rule (`ui-patterns.md`), and it earns it the same
   * way the marker colours on the scan do: `--color-error` means *something is wrong*, and a red
   * chip here means *the red channel*. Borrowing the error token for it would make the two
   * meanings share one colour, and the picture the chip changes is the thing being judged.
   */
  tint?: string;
  onClick: () => void;
}) {
  return (
    // The shared hover control, never the browser's `title`: a hint on a toolbar is read while the
    // hand is already moving, and the native one arrives late, cannot be styled and is invisible on
    // anything without a pointer.
    <Tooltip content={hint}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        padding: "0.3125rem 0.625rem",
        borderRadius: "0.375rem",
        fontSize: "0.8125rem",
        border: `1px solid ${tint ?? "var(--color-border-strong)"}`,
        // Tinted: filled with the colour when it is the one in use, and carrying a wash of it while
        // it is not — so which channel is on reads at a glance, and the three that are not still
        // say what they would be.
        background: active
          ? (tint ?? "var(--color-action-primary)")
          : tint
            ? `color-mix(in srgb, ${tint} 14%, var(--color-bg-elevated))`
            : "var(--color-bg-elevated)",
        color: active ? "#fff" : tint ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      >
        {icon && <Icon name={icon} size="sm" />}
        {label}
      </button>
    </Tooltip>
  );
}
