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
 *
 * It did drift, and that is why this docblock says so: the auction screens carried their own copy
 * from #351 until #1075, and by then the two had diverged in both directions — the shared one had
 * grown `alarm` and `toggle`, the auctions one #558's non-breaking rule below, and neither knew
 * about the other. The copy is gone; this is the only `FilterChip`.
 */
export function FilterChip({
  label,
  count,
  alarm,
  active,
  toggle = false,
  onClick,
}: {
  label: string;
  /** Matching rows, or undefined for a chip that carries no count (and while the first count fetch
   *  is still in flight — the chip renders bare rather than flashing a zero). */
  count?: number;
  /** Render in the error tint — an alarm the user should not have to click to notice. */
  alarm?: boolean;
  active: boolean;
  /**
   * This chip is one of several **independent** toggles rather than one of a set of which exactly
   * one is chosen (#772, the issue tree's checklist filter) — so it announces `aria-pressed` and a
   * reader is told which chips are on.
   *
   * Off by default, and deliberately not derived from {@link active}: on the status filters this
   * component was written for (#332, #392) the chips are a **one-of** choice, where a row of
   * pressed/unpressed toggles would describe the control wrongly. Where the tint is the only state
   * a sighted collector needs, it is not the only state a reader needs, which is why this exists at
   * all — the control it replaced on that filter was a checkbox list and announced its ticks.
   */
  toggle?: boolean;
  onClick: () => void;
}) {
  // The active selection keeps the accent treatment; an alarming chip takes the error tint only
  // while it is not the current selection, so "which filter am I on" stays readable.
  const tint = active ? "accent" : alarm ? "error" : null;
  return (
    <button
      type="button"
      aria-pressed={toggle ? active : undefined}
      onClick={onClick}
      style={{
        ...FILTER_CONTROL_STYLE,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        // A chip is one word for one filter: it may leave the row, but it must not break in half
        // (#558). Its label is what it is, so there is nothing to gain by letting a squeezed
        // toolbar reflow it into two lines of a control two lines tall. Carried here from the
        // auction copy this component absorbed (#1075) — the rule is about chips rather than about
        // that screen, and the toolbars already on this component have labels long enough to break
        // (`Sold, not recorded`, `Changed since listed`, `No catalog value`).
        whiteSpace: "nowrap",
        flexShrink: 0,
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
