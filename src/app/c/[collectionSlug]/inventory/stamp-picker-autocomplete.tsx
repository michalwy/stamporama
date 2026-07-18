"use client";

import { useState } from "react";
import {
  Autocomplete,
  useDebouncedValue,
} from "@/app/c/[collectionSlug]/shared/autocomplete";
import type { StampSearchItem } from "@/lib/stamps";
import { useStampPickerSearch } from "./use-inventory-query";
import { issueLabel } from "./stamp-picker-shared";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

/** Detailed suggestion row: catalog numbers + name on top, issue/area context
 * below, so a stamp is identifiable without opening it (#104). */
function SuggestionRow({ item }: { item: StampSearchItem }) {
  const cat = item.catalogNumbers.join(", ");
  const context = [
    item.issueName || item.issueYear ? issueLabel(item.issueName, item.issueYear) : null,
    item.areaName,
    item.issuedYear ? String(item.issuedYear) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const isUnknownVariant = !item.isVariant && item.hasVariants;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
      <span style={{ color: "var(--color-text-primary)" }}>
        {cat && (
          <span style={{ fontWeight: 600 }}>{cat}</span>
        )}
        {cat && (item.name || isUnknownVariant) ? " · " : ""}
        {item.name && <span>{item.name}</span>}
        {isUnknownVariant && (
          <span style={{ color: "var(--color-text-muted)" }}> — unknown variant</span>
        )}
        {!cat && !item.name && (
          <span style={{ color: "var(--color-text-muted)" }}>(unnamed stamp)</span>
        )}
      </span>
      {context && (
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{context}</span>
      )}
    </div>
  );
}

/** Inline stamp/variant search field for the inventory picker. Owns only its own
 * query text; selection is lifted to the parent via `onPick`. */
export function StampPickerAutocomplete({
  collectionId,
  onPick,
  inputId,
  disabled,
}: {
  collectionId: string;
  onPick: (item: StampSearchItem) => void;
  inputId?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const debouncedQuery = useDebouncedValue(value);
  const { data: suggestions = [] } = useStampPickerSearch(collectionId, debouncedQuery);

  return (
    <Autocomplete
      value={value}
      onValueChange={setValue}
      items={suggestions}
      getItemKey={(s) => s.stampId}
      renderItem={(s) => <SuggestionRow item={s} />}
      onSelect={(s) => {
        setValue("");
        onPick(s);
      }}
      placeholder="Search by catalog no. (e.g. Mi PL200), name, or issue…"
      inputStyle={INPUT_STYLE}
      inputId={inputId}
      disabled={disabled}
    />
  );
}
