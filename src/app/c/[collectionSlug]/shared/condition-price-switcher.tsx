"use client";

import type { StampConditionData } from "@/lib/conditions";

interface ConditionPriceSwitcherProps {
  conditions: StampConditionData[];
  value: string | null;
  onChange: (conditionId: string) => void;
}

/**
 * Compact selector controlling which condition's price fills a list's price
 * column. Hidden when the collection has no conditions (nothing to pick). See #95.
 */
export function ConditionPriceSwitcher({
  conditions,
  value,
  onChange,
}: ConditionPriceSwitcherProps) {
  if (conditions.length === 0) return null;

  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        fontSize: "0.8125rem",
        color: "var(--color-text-muted)",
        whiteSpace: "nowrap",
      }}
    >
      Price for
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "0.25rem 0.5rem",
          border: "1px solid var(--color-border-strong)",
          borderRadius: "0.375rem",
          fontSize: "0.8125rem",
          color: "var(--color-text-primary)",
          background: "var(--color-bg-elevated)",
          cursor: "pointer",
        }}
      >
        {conditions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.abbreviation} — {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
