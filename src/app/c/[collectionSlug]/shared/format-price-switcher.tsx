"use client";

import type { StampFormatData } from "@/lib/stamp-formats";
import { TOOLBAR_LABEL_STYLE, TOOLBAR_SELECT_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";

interface FormatPriceSwitcherProps {
  formats: StampFormatData[];
  value: string | null;
  onChange: (formatId: string | null) => void;
}

/**
 * Compact selector controlling which **format's** price fills a list's price column (#343), sitting
 * beside `ConditionPriceSwitcher` — the two together name one cell of the condition × certificate ×
 * format price grid (ADR-0020).
 *
 * Hidden entirely when the collection has no formats: most collections never define one, and a
 * switcher whose only choice is the default is noise.
 *
 * **Single** is the first option and the default. It is not a dictionary row — a null `formatId`
 * *is* the single — so it carries the empty value.
 */
export function FormatPriceSwitcher({ formats, value, onChange }: FormatPriceSwitcherProps) {
  if (formats.length === 0) return null;

  return (
    <label
      style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", whiteSpace: "nowrap" }}
    >
      <span style={TOOLBAR_LABEL_STYLE}>as</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        style={TOOLBAR_SELECT_STYLE}
      >
        <option value="">Single</option>
        {formats.map((f) => (
          <option key={f.id} value={f.id}>
            {f.abbreviation} — {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}
