"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TagSummary } from "@/lib/tags";
import { tagColorTokens } from "@/lib/tag-colors";
import {
  addTagEntry,
  commitTagInput,
  findTagByName,
  splitTagInput,
  suggestTags,
  type TagEntry,
} from "@/lib/tag-entry";
import { Autocomplete, type AutocompleteAction } from "./autocomplete";
import { tagKeys, useCollectionTags } from "./use-tags";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";

// Where a tag is put on and taken off (#1192): the edit dialog of the thing carrying it — issue,
// stamp or copy — beside every other field about that thing. This replaced #152's card on the
// thing's own screen, deliberately, because a tag set there was a separate errand from filling the
// thing in, and a label nobody could invent without a trip to Settings got used only when the
// collector already knew they would need one.
//
// **A name is typed, and a space ends it.** Each finished name becomes a chip: an existing tag when
// the dictionary holds that name in any casing, otherwise a new one, coloured from the palette the
// moment it is a chip. So a tag typed here is one word; a tag that already carries a space is still
// reached through the suggestions, which match anywhere in a name.
//
// **Nothing is written until the dialog is saved.** The chips ride in one hidden JSON field that the
// thing's own save action resolves — creating the new tags and replacing the set in one
// transaction — so an abandoned dialog leaves no tag behind that nothing carries. The dialog's
// Cancel is the whole undo.
//
// **Nothing is inherited**, exactly as before: this writes the one thing the dialog edits.

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

function Swatch({ color }: { color: string | null }) {
  const tokens = tagColorTokens(color);
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: "0.6rem",
        height: "0.6rem",
        borderRadius: "0.15rem",
        background: tokens.background,
        border: `1px solid ${tokens.border}`,
        flexShrink: 0,
      }}
    />
  );
}

/** One chip, with the way to take it off. The `×` is a control in its own right — the only way to
 *  remove a chip that is not the last one from the keyboard — so it stays in the tab order. */
function EntryChip({
  entry,
  onRemove,
  disabled,
}: {
  entry: TagEntry;
  onRemove: () => void;
  disabled: boolean;
}) {
  const tokens = tagColorTokens(entry.color);
  const chip = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        fontSize: "0.8125rem",
        fontWeight: 500,
        color: tokens.color,
        background: tokens.background,
        border: `1px solid ${tokens.border}`,
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
          aria-label={`Remove tag ${entry.name}`}
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
  // A new tag looks like any other chip — it is coloured from the instant it exists — so the one
  // thing that sets it apart is said on hover rather than drawn.
  return entry.id === null ? (
    <Tooltip content="New tag — created when you save">{chip}</Tooltip>
  ) : (
    chip
  );
}

export function TagEntryField({
  collectionId,
  name,
  inputId,
  initialTags,
  disabled,
}: {
  collectionId: string;
  /** The hidden field the save action reads — `issueTags`, `stampTags` or `copyTags`, so no action
   *  can ever pick up another dialog's chips from a form it was handed. */
  name: string;
  inputId?: string;
  /** The tags on the thing now: empty when adding. `undefined` while they are still loading, and
   *  then **no field is submitted at all**, so a save made before they arrive leaves them alone. */
  initialTags: TagSummary[] | undefined;
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: dictionary = [] } = useCollectionTags(collectionId);
  const [entries, setEntries] = useState<TagEntry[] | undefined>(initialTags);
  // Seeded once, when the stored tags arrive — never re-synced after that, or a background refresh
  // of the row would throw away what the collector has typed so far.
  if (entries === undefined && initialTags !== undefined) setEntries(initialTags);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);

  // What a Save carries: the chips plus whatever is still in the text field, so a last name typed
  // with no space after it is not lost to the Save button.
  const submitted = entries === undefined ? undefined : commitTagInput(entries, text, dictionary);

  // A tag born by this dialog's save is in the dictionary every other surface reads — the next
  // dialog's suggestions, the tag filters, the bulk edit — and they read it through one cached query.
  // Refreshed when the dialog goes away, which is after its save; a cancelled one refetches the
  // same list, which costs nothing.
  const offeredNew = useRef(false);
  useEffect(() => {
    if (submitted?.some((e) => e.id === null)) offeredNew.current = true;
  });
  useEffect(
    () => () => {
      if (offeredNew.current) {
        void queryClient.invalidateQueries({ queryKey: tagKeys.all(collectionId) });
      }
    },
    [queryClient, collectionId]
  );

  if (entries === undefined) {
    return (
      <div style={{ ...BOX_STYLE, cursor: "default", color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
        Loading tags…
      </div>
    );
  }

  function add(nameToAdd: string) {
    setEntries((prev) => addTagEntry(prev ?? [], nameToAdd, dictionary));
  }

  function handleValueChange(next: string) {
    const { names, rest } = splitTagInput(next);
    if (names.length === 0) {
      setText(next);
      return;
    }
    setEntries((prev) => names.reduce((acc, n) => addTagEntry(acc, n, dictionary), prev ?? []));
    setText(rest);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && text.trim()) {
      // Enter commits the word rather than submitting the dialog: a collector finishing a name
      // with Enter means *that is the tag*, not *save*. On an empty field it saves, as every other
      // text field in the dialog does.
      e.preventDefault();
      add(text);
      setText("");
    } else if (e.key === "Backspace" && text === "" && entries && entries.length > 0) {
      e.preventDefault();
      setEntries(entries.slice(0, -1));
    }
  }

  const query = text.trim();
  const suggestions = suggestTags(dictionary, query, entries);
  // Offered as its own row only when the word would really make a new tag — not for a name the
  // dictionary holds in another casing, which the suggestions above already show.
  const preview = query ? addTagEntry(entries, query, dictionary) : entries;
  const newEntry = preview.length > entries.length ? preview[preview.length - 1] : null;
  const actions: AutocompleteAction[] =
    newEntry && newEntry.id === null && !findTagByName(dictionary, query)
      ? [
          {
            key: "__new-tag__",
            node: (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                <Swatch color={newEntry.color} />
                New tag “{newEntry.name}”
              </span>
            ),
            onSelect: () => {
              add(query);
              setText("");
            },
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
        style={{
          ...BOX_STYLE,
          borderColor: focused ? "var(--color-accent)" : BOX_STYLE.borderColor,
          opacity: disabled ? 0.6 : 1,
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={(e) => {
          // A click on the box's empty space lands in the text field, as it would in one input.
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
            onValueChange={handleValueChange}
            items={suggestions}
            getItemKey={(t) => t.id}
            renderItem={(t) => (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                <Swatch color={t.color} />
                {t.name}
              </span>
            )}
            onSelect={(t) => {
              add(t.name);
              setText("");
            }}
            actions={actions}
            onKeyDown={handleKeyDown}
            placeholder={entries.length === 0 ? "Type a tag, then a space" : undefined}
            inputStyle={INNER_INPUT_STYLE}
            disabled={disabled}
          />
        </div>
        <input type="hidden" name={name} value={JSON.stringify(submitted)} />
      </div>
      <p style={HINT_STYLE}>
        Separate tags with a space. A name that is not a tag yet becomes one when you save.
      </p>
    </div>
  );
}
