"use client";

import { useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { StampPickerAutocomplete } from "./stamp-picker-autocomplete";
import { StampPickerBrowser } from "./stamp-picker-browser";
import { fromSearchItem, type PickedStamp } from "./stamp-picker-shared";

export type { PickedStamp } from "./stamp-picker-shared";
export { stampNodeLabel } from "./stamp-picker-shared";

const BROWSE_BUTTON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  fontSize: "0.8125rem",
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/**
 * Inventory stamp/variant picker (#104). Two entry modes filling the same hidden
 * `stampId`: an inline autocomplete (catalog-number/name/issue search) and a
 * "Browse" popup (area → issue → stamp/variant tree). Once a stamp is chosen it
 * collapses to a labeled summary with a "Change" affordance. `initial` prefills
 * the summary in edit mode.
 */
export function StampSelect({
  collectionId,
  areas,
  selectedStampId,
  onSelectedStampIdChange,
  initial,
  disabled,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  selectedStampId: string;
  onSelectedStampIdChange: (id: string) => void;
  initial?: PickedStamp;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<PickedStamp | null>(initial ?? null);
  const [browsing, setBrowsing] = useState(false);

  function pick(picked: PickedStamp) {
    setSelected(picked);
    onSelectedStampIdChange(picked.stampId);
    setBrowsing(false);
  }

  function clear() {
    setSelected(null);
    onSelectedStampIdChange("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {selected ? (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.5rem",
            padding: "0.5rem 0.625rem",
            background: "var(--color-bg-page)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.375rem",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-text-primary)" }}>
              {selected.primary}
              {selected.unknownVariant && (
                <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>
                  {" "}
                  — unknown variant
                </span>
              )}
            </div>
            {selected.secondary && (
              <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.125rem" }}>
                {selected.secondary}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            style={{
              flexShrink: 0,
              background: "none",
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              color: "var(--color-accent)",
              fontSize: "0.75rem",
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <StampPickerAutocomplete
              collectionId={collectionId}
              onPick={(item) => pick(fromSearchItem(item))}
              inputId="copy-stamp-search"
              disabled={disabled}
            />
          </div>
          <button
            type="button"
            onClick={() => setBrowsing(true)}
            disabled={disabled}
            style={{
              ...BROWSE_BUTTON_STYLE,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            Browse…
          </button>
        </div>
      )}

      <input type="hidden" name="stampId" value={selectedStampId} />

      {browsing && (
        <StampPickerBrowser
          collectionId={collectionId}
          areas={areas}
          onPick={pick}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}
