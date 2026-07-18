"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useContactSearch, useInvalidateContacts } from "./use-inventory-query";

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

const DROPDOWN_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  zIndex: 30,
  marginTop: "0.25rem",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
  maxHeight: "12rem",
  overflowY: "auto",
};

const OPTION_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  fontSize: "0.8125rem",
  cursor: "pointer",
  color: "var(--color-text-primary)",
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
  const [inputValue, setInputValue] = useState(initialContactName ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [createError, setCreateError] = useState<string | undefined>();
  const [isCreating, startCreate] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: suggestions = [] } = useContactSearch(collectionId, debouncedQuery);
  const { invalidateContacts } = useInvalidateContacts();

  const handleInput = useCallback((value: string) => {
    setInputValue(value);
    // Editing the text detaches any linked contact; a new link is only formed by
    // picking a suggestion or creating a contact below.
    setSelectedId("");
    setIsOpen(true);
    setCreateError(undefined);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  }, []);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function pick(contact: { id: string; name: string }) {
    setSelectedId(contact.id);
    setInputValue(contact.name);
    setDebouncedQuery("");
    setIsOpen(false);
    setCreateError(undefined);
  }

  const trimmed = inputValue.trim();
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

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Empty when no contact is linked → the item's source is cleared. */}
      <input type="hidden" name="contactId" value={selectedId} />
      <input
        id={inputId}
        type="text"
        placeholder="Search or add a contact…"
        value={inputValue}
        disabled={disabled || isCreating}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => { if (inputValue.trim()) setIsOpen(true); }}
        style={INPUT_STYLE}
      />
      {isOpen && trimmed.length > 0 && (canCreate || suggestions.length > 0) && (
        <div style={DROPDOWN_STYLE}>
          {suggestions.map((c) => (
            <div
              key={c.id}
              onClick={() => pick({ id: c.id, name: c.name })}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "var(--color-bg-page)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
              style={{
                ...OPTION_STYLE,
                fontWeight: c.id === selectedId ? 600 : 400,
              }}
            >
              {c.name}
            </div>
          ))}
          {canCreate && (
            <div
              onClick={createAndSelect}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "var(--color-bg-page)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
              style={{
                ...OPTION_STYLE,
                borderTop: suggestions.length > 0 ? "1px solid var(--color-border)" : undefined,
                color: "var(--color-accent)",
                fontWeight: 500,
              }}
            >
              {isCreating ? "Creating…" : `Create “${trimmed}”`}
            </div>
          )}
        </div>
      )}
      {createError && (
        <p style={{ marginTop: "0.375rem", fontSize: "0.75rem", color: "var(--color-error)" }}>
          {createError}
        </p>
      )}
    </div>
  );
}
