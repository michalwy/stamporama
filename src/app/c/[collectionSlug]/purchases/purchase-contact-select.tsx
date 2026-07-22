"use client";

import { useState } from "react";
import {
  Autocomplete,
  useDebouncedValue,
} from "@/app/c/[collectionSlug]/shared/autocomplete";
import { usePurchaseContactSearch } from "./use-purchases-query";

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

interface PurchaseContactSelectProps {
  collectionId: string;
  /** Hidden input carrying the picked contact id — `contactId` (supplier) / `platformId`. */
  idFieldName: string;
  /** Hidden input carrying the typed name, so the server can find-or-create on save —
   * `contactName` (supplier) / `platformName`. */
  nameFieldName: string;
  initialContactId?: string | null;
  initialContactName?: string | null;
  inputId?: string;
  placeholder: string;
  /** Narrows suggestions to contacts carrying this role, and (server-side) tags a newly
   * created contact with it: `seller` for suppliers, `platform` for platforms. */
  role: "platform" | "seller" | "buyer";
  disabled?: boolean;
  /** Notified whenever the selection changes: the picked contact id (`""` when the text was
   * edited to a name that has not been matched to a suggestion), the current text, and — when a
   * suggestion was picked — that contact's fixed platform currency (#196; `null` when unset,
   * `undefined` when no suggestion is matched). Lets a parent react live to the choice — e.g. the
   * offer dialog's collision check (#165) and the derived-currency lock (#196). */
  onSelectionChange?: (
    contactId: string,
    name: string,
    platformCurrency?: string | null
  ) => void;
}

/** Create-on-type contact picker for the purchase dialog, shared by the supplier and
 * platform fields. A single always-editable text input: it searches existing contacts of
 * the given `role` (#107) and lets you pick one. You do NOT have to pick — whatever name is
 * left in the box is submitted alongside the picked id (if any), and the server resolves it
 * on save: an existing contact of that name is reused, otherwise a new one is created with
 * the role (#120). Editing the text clears any picked id; a blank box means "none". */
export function PurchaseContactSelect({
  collectionId,
  idFieldName,
  nameFieldName,
  initialContactId,
  initialContactName,
  inputId,
  placeholder,
  role,
  disabled,
  onSelectionChange,
}: PurchaseContactSelectProps) {
  const [selectedId, setSelectedId] = useState(initialContactId ?? "");
  const [value, setValue] = useState(initialContactName ?? "");
  const debouncedQuery = useDebouncedValue(value);

  const { data: suggestions = [] } = usePurchaseContactSearch(
    collectionId,
    debouncedQuery,
    role
  );

  function handleValueChange(next: string) {
    // Editing the text detaches any picked contact; the server will resolve the new name. The
    // platform currency is unknown until a suggestion is matched, so it is left undefined (#196).
    setSelectedId("");
    setValue(next);
    onSelectionChange?.("", next, undefined);
  }

  function pick(contact: { id: string; name: string; platformCurrency: string | null }) {
    setSelectedId(contact.id);
    setValue(contact.name);
    onSelectionChange?.(contact.id, contact.name, contact.platformCurrency);
  }

  return (
    <>
      {/* Both are submitted: the id wins when a suggestion was picked, otherwise the
          server find-or-creates a contact from the name. */}
      <input type="hidden" name={idFieldName} value={selectedId} />
      <input type="hidden" name={nameFieldName} value={value} />
      <Autocomplete
        value={value}
        onValueChange={handleValueChange}
        items={suggestions}
        getItemKey={(c) => c.id}
        renderItem={(c) => (
          <span style={{ fontWeight: c.id === selectedId ? 600 : 400 }}>{c.name}</span>
        )}
        onSelect={(c) => pick({ id: c.id, name: c.name, platformCurrency: c.platformCurrency })}
        placeholder={placeholder}
        inputStyle={INPUT_STYLE}
        inputId={inputId}
        disabled={disabled}
      />
    </>
  );
}
