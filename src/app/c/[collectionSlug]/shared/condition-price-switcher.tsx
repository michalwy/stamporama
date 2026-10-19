"use client";

import type { StampConditionData } from "@/lib/conditions";
import { TOOLBAR_LABEL_STYLE, TOOLBAR_SELECT_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";

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
      style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", whiteSpace: "nowrap" }}
    >
      <span style={TOOLBAR_LABEL_STYLE}>Price for</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={TOOLBAR_SELECT_STYLE}
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
