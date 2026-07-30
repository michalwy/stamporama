"use client";

/** The toolbar control box every list-screen filter shares — chips and selects alike, so a row of
 * them lines up whatever it is made of. */
export const FILTER_CONTROL_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minHeight: "2rem",
};

/**
 * A single toggle chip in a list toolbar (#332) — the offers list's status filter and the sales
 * list's (#392) are one control, so they are one component: a second copy would drift the moment
 * either grew a state.
 */
export function FilterChip({
  label,
  count,
  alarm,
  active,
  onClick,
}: {
  label: string;
  /** Matching rows, or undefined for a chip that carries no count (and while the first count fetch
   *  is still in flight — the chip renders bare rather than flashing a zero). */
  count?: number;
  /** Render in the error tint — an alarm the user should not have to click to notice. */
  alarm?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  // The active selection keeps the accent treatment; an alarming chip takes the error tint only
  // while it is not the current selection, so "which filter am I on" stays readable.
  const tint = active ? "accent" : alarm ? "error" : null;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...FILTER_CONTROL_STYLE,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        fontWeight: active || alarm ? 600 : 400,
        color: tint ? `var(--color-${tint})` : "var(--color-text-secondary)",
        borderColor: tint ? `var(--color-${tint})` : "var(--color-border-strong)",
        background: tint ? `var(--color-${tint}-soft)` : "var(--color-bg-elevated)",
      }}
    >
      {label}
      {count !== undefined && (
        <span
          style={{
            fontSize: "0.75rem",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            opacity: count === 0 ? 0.5 : 0.8,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
