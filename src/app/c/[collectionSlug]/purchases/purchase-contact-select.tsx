"use client";

import { useState, useTransition } from "react";
import {
  Autocomplete,
  useDebouncedValue,
  type AutocompleteAction,
} from "@/app/c/[collectionSlug]/shared/autocomplete";
import {
  usePurchaseContactSearch,
  useInvalidatePurchases,
} from "./use-purchases-query";

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
  /** Hidden input the form submits — `contactId` for supplier, `platformId` for platform. */
  fieldName: string;
  initialContactId?: string | null;
  initialContactName?: string | null;
  inputId?: string;
  placeholder: string;
  /** Narrows suggestions to contacts carrying this role (platform picker), and tags a
   * newly created contact with it. Omit for the plain supplier picker. */
  role?: "platform";
  disabled?: boolean;
}

/** Create-on-type contact picker for the purchase dialog, shared by the supplier and
 * platform fields. A single always-editable text input: searches existing contacts (#107)
 * and, on a new name, offers a "Create" option that creates the contact (tagged with
 * `role` when given) and links it. The linked contact id is written to the hidden
 * `fieldName` input; editing the text clears the link, and a blank input means "none". */
export function PurchaseContactSelect({
  collectionId,
  fieldName,
  initialContactId,
  initialContactName,
  inputId,
  placeholder,
  role,
  disabled,
}: PurchaseContactSelectProps) {
  const [selectedId, setSelectedId] = useState(initialContactId ?? "");
  const [value, setValue] = useState(initialContactName ?? "");
  const [createError, setCreateError] = useState<string | undefined>();
  const [isCreating, startCreate] = useTransition();
  const debouncedQuery = useDebouncedValue(value);

  const { data: suggestions = [] } = usePurchaseContactSearch(
    collectionId,
    debouncedQuery,
    role
  );
  const { invalidateContacts } = useInvalidatePurchases();

  function handleValueChange(next: string) {
    setSelectedId("");
    setCreateError(undefined);
    setValue(next);
  }

  function pick(contact: { id: string; name: string }) {
    setSelectedId(contact.id);
    setValue(contact.name);
    setCreateError(undefined);
  }

  const trimmed = value.trim();
  const exactMatch = suggestions.some(
    (c) => c.name.toLocaleLowerCase("en") === trimmed.toLocaleLowerCase("en")
  );
  const canCreate = trimmed.length > 0 && !exactMatch && !selectedId;

  function createAndSelect() {
    const name = trimmed;
    if (!name) return;
    startCreate(async () => {
      const { createContactAction } = await import("@/app/actions/contacts");
      const fd = new FormData();
      fd.set("name", name);
      if (role) fd.set(role, "true");
      const result = await createContactAction(collectionId, fd);
      if (result.status === "success") {
        invalidateContacts(collectionId);
        pick({ id: result.contact.id, name: result.contact.name });
      } else if (result.status === "error") {
        setCreateError(result.message);
      }
    });
  }

  const actions: AutocompleteAction[] = canCreate
    ? [
        {
          key: "__create__",
          node: isCreating ? "Creating…" : `Create “${trimmed}”`,
          onSelect: createAndSelect,
          style: {
            borderTop:
              suggestions.length > 0 ? "1px solid var(--color-border)" : undefined,
            color: "var(--color-accent)",
            fontWeight: 500,
          },
        },
      ]
    : [];

  return (
    <>
      <input type="hidden" name={fieldName} value={selectedId} />
      <Autocomplete
        value={value}
        onValueChange={handleValueChange}
        items={suggestions}
        getItemKey={(c) => c.id}
        renderItem={(c) => (
          <span style={{ fontWeight: c.id === selectedId ? 600 : 400 }}>{c.name}</span>
        )}
        onSelect={(c) => pick({ id: c.id, name: c.name })}
        actions={actions}
        placeholder={placeholder}
        inputStyle={INPUT_STYLE}
        inputId={inputId}
        disabled={disabled || isCreating}
      />
      {createError && (
        <p style={{ marginTop: "0.375rem", fontSize: "0.75rem", color: "var(--color-error)" }}>
          {createError}
        </p>
      )}
    </>
  );
}
