"use client";

import { useState, useTransition } from "react";
import {
  Autocomplete,
  useDebouncedValue,
  type AutocompleteAction,
} from "@/app/c/[collectionSlug]/shared/autocomplete";
import { useContactSearch, useInvalidateContacts } from "./use-inventory-query";

// Larger form-field input than the compact autocompletes (0.875rem), so it keeps
// its own style rather than the shared SEARCH_INPUT_STYLE.
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

interface ContactSelectProps {
  collectionId: string;
  /** Selected contact id (edit mode); "" when unset. */
  initialContactId?: string | null;
  initialContactName?: string | null;
  /** id for the visible text input, so an external <label htmlFor> can target it. */
  inputId?: string;
  disabled?: boolean;
}

/** Acquisition-source picker (#108). A single always-editable text input: searches
 * existing contacts via the #107 search API and, on typing a name with no exact
 * match, offers a "Create" option that creates a role-less contact (#107 create
 * action) and links it. The picked contact's name stays in the input (not a chip),
 * so it can be freely re-edited; editing the text clears the link. The linked
 * contact id is written to a hidden `contactId` input the item form submits. */
export function ContactSelect({
  collectionId,
  initialContactId,
  initialContactName,
  inputId,
  disabled,
}: ContactSelectProps) {
  const [selectedId, setSelectedId] = useState(initialContactId ?? "");
  const [value, setValue] = useState(initialContactName ?? "");
  const [createError, setCreateError] = useState<string | undefined>();
  const [isCreating, startCreate] = useTransition();
  const debouncedQuery = useDebouncedValue(value);

  const { data: suggestions = [] } = useContactSearch(collectionId, debouncedQuery);
  const { invalidateContacts } = useInvalidateContacts();

  function handleValueChange(next: string) {
    // Editing the text detaches any linked contact; a new link is only formed by
    // picking a suggestion or creating a contact below.
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
  // Offer create only for a genuinely new name that isn't already the linked contact.
  const canCreate = trimmed.length > 0 && !exactMatch && !selectedId;

  function createAndSelect() {
    const name = trimmed;
    if (!name) return;
    startCreate(async () => {
      const { createContactAction } = await import("@/app/actions/contacts");
      const fd = new FormData();
      fd.set("name", name);
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
      {/* Empty when no contact is linked → the item's source is cleared. */}
      <input type="hidden" name="contactId" value={selectedId} />
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
        placeholder="Search or add a contact…"
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
