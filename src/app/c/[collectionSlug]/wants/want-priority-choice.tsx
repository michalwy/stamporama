"use client";

import {
  WANT_PRIORITIES,
  WANT_PRIORITY_CHIP,
  WANT_PRIORITY_LABEL,
  type WantPriority,
} from "@/lib/want-rules";

/**
 * Priority as **three chips**, one chosen, rather than a `<select>`.
 *
 * They are drawn in the very colours the list row uses (`WANT_PRIORITY_CHIP`), which is the reason
 * to spend the width: the thing being picked here is the thing that will be recognised there, and a
 * dropdown showed the word without the signal. Three options is also exactly the size at which a
 * closed menu costs more than it saves — the whole vocabulary fits on one line.
 *
 * A `radiogroup`, not a row of toggles: the answers are mutually exclusive, so a screen reader
 * should be told that one of three is selected rather than that three things are separately pressed.
 *
 * Shared rather than declared inside the want form, because the bulk *add missing* dialog (#695)
 * asks the same question over a whole issue: one urgency, applied to every want the run writes. Two
 * copies of a control this small drift in exactly the way that made the bulk dialog lack it at all.
 */
export function WantPriorityChoice({
  value,
  onChange,
  disabled,
}: {
  value: WantPriority;
  onChange: (next: WantPriority) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Priority"
      style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", minHeight: "2rem", alignItems: "center" }}
    >
      {WANT_PRIORITIES.map((p) => {
        const active = p === value;
        const chip = WANT_PRIORITY_CHIP[p];
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(p)}
            style={{
              padding: "0.25rem 0.625rem",
              borderRadius: "0.375rem",
              fontSize: "0.8125rem",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              // Unchosen chips stay plain: three coloured chips side by side would say that all
              // three are the answer, and the colour is what marks the one that is.
              background: active ? chip.background : "transparent",
              color: active ? chip.color : "var(--color-text-muted)",
              border: `1px solid ${active ? chip.border : "var(--color-border-strong)"}`,
              fontWeight: active ? 600 : 400,
            }}
          >
            {WANT_PRIORITY_LABEL[p]}
          </button>
        );
      })}
    </div>
  );
}
