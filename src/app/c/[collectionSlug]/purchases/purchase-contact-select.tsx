"use client";

import { useState } from "react";
import {
  Autocomplete,
  useDebouncedValue,
} from "@/app/c/[collectionSlug]/shared/autocomplete";
import { usePurchaseContactSearch } from "./use-purchases-query";
import { formControl } from "@/app/control-style";

const INPUT_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

interface PurchaseContactSelectProps {
  collectionId: string;
  /** Hidden input carrying the picked contact id — `contactId` (supplier), `buyerId`, … */
  idFieldName: string;
  /** Hidden input carrying the typed name, so the server can find-or-create on save —
   * `contactName` (supplier), `buyerName`, … */
  nameFieldName: string;
  initialContactId?: string | null;
  initialContactName?: string | null;
  inputId?: string;
  placeholder: string;
  /** Narrows suggestions to contacts carrying this role, and (server-side) tags a newly
   * created contact with it: `seller` for suppliers. Omitted, every contact is suggested — a price
   * observation's auction house (#1633) may be filed under `seller` from the collector's own
   * bidding, and the role it gets on creation is the server's to set. A platform is not a contact:
   * its field is a `PlatformSelect` (#2432). */
  role?: "seller" | "buyer";
  disabled?: boolean;
  /** The field's style, when it is not the desk form's — the phone's *Sell* (#2009) draws it at a
   *  thumb's height. */
  inputStyle?: React.CSSProperties;
  /** Notified whenever the selection changes: the picked contact id (`""` when the text was
   * edited to a name that has not been matched to a suggestion) and the current text. */
  onSelectionChange?: (contactId: string, name: string) => void;
}

/** Create-on-type contact picker — the supplier, seller, buyer and auction-house fields. A single always-editable text input: it searches existing contacts of
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
  inputStyle = INPUT_STYLE,
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
    // Editing the text detaches any picked contact; the server will resolve the new name.
    setSelectedId("");
    setValue(next);
    onSelectionChange?.("", next);
  }

  function pick(contact: { id: string; name: string }) {
    setSelectedId(contact.id);
    setValue(contact.name);
    onSelectionChange?.(contact.id, contact.name);
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
        onSelect={(c) => pick({ id: c.id, name: c.name })}
        placeholder={placeholder}
        inputStyle={inputStyle}
        inputId={inputId}
        disabled={disabled}
      />
    </>
  );
}
