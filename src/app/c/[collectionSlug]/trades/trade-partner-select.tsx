"use client";

import { useState } from "react";
import {
  Autocomplete,
  useDebouncedValue,
} from "@/app/c/[collectionSlug]/shared/autocomplete";
import { useExchangePartnerSearch } from "./use-trades-query";

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

/**
 * Create-on-type partner picker for the trade dialog (#646).
 *
 * The same shape as the purchase dialog's supplier field: one always-editable text input that
 * searches existing contacts and lets you pick one, but never *requires* it — whatever name is left
 * in the box is submitted alongside the picked id, and the server resolves it on save, creating the
 * contact with the `exchangePartner` role when the name is new. Editing the text clears any picked
 * id.
 *
 * Its own component rather than the purchase one with a fourth role: that picker carries the
 * platform's offer defaults (currency, starting price, listing type) into its parent, and none of
 * that means anything to a person you swap stamps with.
 */
export function TradePartnerSelect({
  collectionId,
  initialPartnerId,
  initialPartnerName,
  inputId,
  disabled,
}: {
  collectionId: string;
  initialPartnerId?: string | null;
  initialPartnerName?: string | null;
  inputId?: string;
  disabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(initialPartnerId ?? "");
  const [value, setValue] = useState(initialPartnerName ?? "");
  const debouncedQuery = useDebouncedValue(value);

  const { data: suggestions = [] } = useExchangePartnerSearch(collectionId, debouncedQuery);

  return (
    <>
      {/* Both are submitted: the id wins when a suggestion was picked, otherwise the server
          find-or-creates a partner from the name. */}
      <input type="hidden" name="partnerId" value={selectedId} />
      <input type="hidden" name="partnerName" value={value} />
      <Autocomplete
        value={value}
        onValueChange={(next) => {
          setSelectedId("");
          setValue(next);
        }}
        items={suggestions}
        getItemKey={(c) => c.id}
        renderItem={(c) => (
          <span style={{ fontWeight: c.id === selectedId ? 600 : 400 }}>{c.name}</span>
        )}
        onSelect={(c) => {
          setSelectedId(c.id);
          setValue(c.name);
        }}
        placeholder="Search or add an exchange partner…"
        inputStyle={INPUT_STYLE}
        inputId={inputId}
        disabled={disabled}
      />
    </>
  );
}
