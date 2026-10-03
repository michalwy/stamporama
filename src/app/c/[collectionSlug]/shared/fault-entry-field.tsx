"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FaultSummary } from "@/lib/faults";
import {
  addFaultEntry,
  findFaultByName,
  suggestFaults,
  type FaultEntry,
} from "@/lib/fault-entry";
import { Autocomplete, type AutocompleteAction } from "./autocomplete";
import { faultKeys, useCollectionFaults } from "./use-faults";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";

// A copy's faults (#1557), chosen in the copy's edit dialog beside its condition — the copy page
// opens this same dialog, so there is one editor (*a detail page reads*).
//
// The tag field's arrangement (`tag-entry-field.tsx`, #1192), with one difference: **a fault's name
// carries spaces** (*Thinned gum*), so a space does not end it. A fault is picked from the
// suggestions — ↓ on an empty field lists every fault not yet chosen, in the dictionary's order, the
// way a multi-select would — or typed and committed with Enter. A name the dictionary does not hold
// becomes a new fault **when the dialog is saved**, never before, so a cancelled dialog leaves none.

const BOX_STYLE: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.375rem",
  width: "100%",
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
  cursor: "text",
};

const INNER_INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  border: "none",
  outline: "none",
  background: "transparent",
  padding: "0.125rem 0",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  boxSizing: "border-box",
};

const HINT_STYLE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  margin: "0.25rem 0 0",
};

function EntryChip({
  entry,
  onRemove,
  disabled,
}: {
  entry: FaultEntry;
  onRemove: () => void;
  disabled: boolean;
}) {
  const chip = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        fontSize: "0.8125rem",
        fontWeight: 500,
        color: "var(--color-warning)",
        background: "var(--color-warning-soft)",
        border: "1px solid var(--color-warning-border)",
        borderRadius: "0.25rem",
        padding: "0.05rem 0.2rem 0.05rem 0.45rem",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {entry.name}
      <Tooltip content={`Take “${entry.name}” off`}>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove fault ${entry.name}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            background: "none",
            border: "none",
            padding: "0.05rem",
            color: "inherit",
            cursor: disabled ? "default" : "pointer",
            opacity: 0.7,
          }}
        >
          <Icon name="close" size="xs" />
        </button>
      </Tooltip>
    </span>
  );
  return entry.id === null ? (
    <Tooltip content="New fault — added to the list when you save">{chip}</Tooltip>
  ) : (
    chip
  );
}

export function FaultEntryField({
  collectionId,
  inputId,
  initialFaults,
  disabled,
}: {
  collectionId: string;
  inputId?: string;
  /** The faults on the copy now: empty when adding. */
  initialFaults: FaultSummary[];
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: dictionary = [] } = useCollectionFaults(collectionId);
  const [entries, setEntries] = useState<FaultEntry[]>(initialFaults);
  const [text, setText] = useState("");

  // What a Save carries: the chips plus a name still in the text field, so a last fault typed
  // without Enter is not lost to the Save button.
  const submitted = addFaultEntry(entries, text, dictionary);

  // A fault born by this dialog's save is in the dictionary the filter, the bulk edit and the next
  // dialog read through one cached query — refreshed when the dialog goes away, after its save.
  const offeredNew = useRef(false);
  useEffect(() => {
    if (submitted.some((e) => e.id === null)) offeredNew.current = true;
  });
  useEffect(
    () => () => {
      if (offeredNew.current) {
        void queryClient.invalidateQueries({ queryKey: faultKeys.all(collectionId) });
      }
    },
    [queryClient, collectionId]
  );

  function add(nameToAdd: string) {
    setEntries((prev) => addFaultEntry(prev, nameToAdd, dictionary));
    setText("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && text.trim()) {
      // Enter commits the name rather than submitting the dialog; on an empty field it saves.
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && text === "" && entries.length > 0) {
      e.preventDefault();
      setEntries(entries.slice(0, -1));
    }
  }

  const query = text.trim();
  const suggestions = suggestFaults(dictionary, query, entries);
  const actions: AutocompleteAction[] =
    query && !findFaultByName(dictionary, query) &&
    !entries.some((e) => e.name.toLowerCase() === query.toLowerCase())
      ? [
          {
            key: "__new-fault__",
            node: <>New fault “{query}”</>,
            onSelect: () => add(query),
            style: {
              color: "var(--color-accent)",
              borderTop: suggestions.length > 0 ? "1px solid var(--color-border)" : undefined,
            },
          },
        ]
      : [];

  return (
    <div>
      <div
        className="tag-entry-box"
        style={{ ...BOX_STYLE, opacity: disabled ? 0.6 : 1 }}
        onClick={(e) => {
          if (e.target === e.currentTarget && inputId) document.getElementById(inputId)?.focus();
        }}
      >
        {entries.map((entry) => (
          <EntryChip
            key={entry.id ?? `new:${entry.name.toLowerCase()}`}
            entry={entry}
            disabled={disabled}
            onRemove={() => setEntries(entries.filter((e) => e !== entry))}
          />
        ))}
        <div style={{ flex: 1, minWidth: "8rem" }}>
          <Autocomplete
            inputId={inputId}
            value={text}
            onValueChange={setText}
            items={suggestions}
            getItemKey={(f) => f.id}
            renderItem={(f) => f.name}
            onSelect={(f) => add(f.name)}
            actions={actions}
            onKeyDown={handleKeyDown}
            // ↓ on an empty field opens the whole list, as a multi-select would.
            canOpen={() => true}
            placeholder={entries.length === 0 ? "None — type or press ↓ to pick" : undefined}
            inputStyle={INNER_INPUT_STYLE}
            disabled={disabled}
          />
        </div>
        <input type="hidden" name="copyFaults" value={JSON.stringify(submitted)} />
      </div>
      <p style={HINT_STYLE}>Pick from your faults, or type a new one and press Enter.</p>
    </div>
  );
}
