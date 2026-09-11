"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { TagSummary } from "@/lib/tags";
import { tagColorTokens } from "@/lib/tag-colors";
import { DetailCard, DETAIL_BUTTON } from "./detail-page";
import {
  useFilterPopover,
  filterMenuStyle,
  FILTER_MENU_ITEM_STYLE,
  FILTER_MENU_Z_INDEX,
} from "./filter-popover";
import { useCollectionTags } from "./use-tags";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";

// Where a tag is put on and taken off (#152): the issue's own screen and the stamp's own screen,
// one thing at a time. The Copies list's bulk edit is the single exception to that rule and is
// #1181; there is deliberately **no quick-assign entry in a list row's `⋮` menu**.
//
// **This is not the detail page becoming a second editor.** That invariant is about a record's
// *fields* — a stamp's name, an issue's year — every one of which is still written through the
// dialog that already owns it. A tag is not a field of the stamp: it is a label the collector hangs
// on it, a row in a join table, and the same reasoning the Variants card (#630) rests on applies —
// a relationship between two records has no other home on the screen.
//
// **Nothing is inherited.** A tag put on an issue is not on its stamps, and a tag on a parent stamp
// is not on its variants. That is ADR-0010's own answer for catalogue attributes (a variant is its
// own stamp), and it is why this card writes exactly one thing's rows and refreshes exactly one
// screen.
//
// The card **renders even with no tags on it**, which is `DetailCard`'s stated exception to #536:
// its empty state carries the only way to put the first one on.

/** One tag on the thing, with the way to take it off. The `×` is a control in its own right — the
 *  only way to remove a tag from the keyboard — so it stays in the tab order (#445/#446). */
function EditableTagChip({
  tag,
  onRemove,
  disabled,
}: {
  tag: TagSummary;
  onRemove: () => void;
  disabled: boolean;
}) {
  const tokens = tagColorTokens(tag.color);
  return (
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
        padding: "0.1rem 0.25rem 0.1rem 0.5rem",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {tag.name}
      <Tooltip content={`Take “${tag.name}” off`}>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove tag ${tag.name}`}
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
}

/**
 * The picker: the collection's whole dictionary with what is on ticked, and a pick applies at once.
 *
 * A popover rather than a dialog, and a tick rather than an Add button, on `MultiSelectFilter`'s own
 * reasoning (#425): the chips behind the panel are what say what a tick did, so a confirm step
 * would only ask the collector to agree with what they can already see. It closes on Escape, an
 * outside click, a scroll or a resize — `useFilterPopover`, so the third such control in the app is
 * the same control's behaviour rather than a third convention.
 */
function TagPicker({
  collectionId,
  collectionSlug,
  selectedIds,
  onToggle,
  disabled,
}: {
  collectionId: string;
  collectionSlug: string;
  selectedIds: Set<string>;
  /** The whole tag, not its id: adding one has to draw a chip with a name and a colour on it
   *  before the page has been re-read, and the dictionary is the only thing holding them. */
  onToggle: (tag: TagSummary, on: boolean) => void;
  disabled: boolean;
}) {
  const { open, setOpen, pos, triggerRef, menuRef } = useFilterPopover<HTMLButtonElement>({
    disabled,
  });
  const { data: tags, isLoading } = useCollectionTags(collectionId);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        style={{ ...DETAIL_BUTTON, opacity: disabled ? 0.5 : 1 }}
      >
        <Icon name="tags" size="sm" /> Tags
        <Icon name="caret" size="xs" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={menuRef} style={filterMenuStyle(pos, FILTER_MENU_Z_INDEX)}>
            {isLoading && (
              <span style={{ ...FILTER_MENU_ITEM_STYLE, color: "var(--color-text-muted)" }}>
                Loading…
              </span>
            )}
            {/* An empty dictionary says where tags are made rather than nothing at all: nothing is
                seeded, so this is what a collection meeting the feature for the first time sees. */}
            {!isLoading && (tags?.length ?? 0) === 0 && (
              <span
                style={{
                  ...FILTER_MENU_ITEM_STYLE,
                  color: "var(--color-text-muted)",
                  whiteSpace: "normal",
                  maxWidth: "16rem",
                }}
              >
                No tags yet.{" "}
                <Link
                  href={`/c/${collectionSlug}/settings?tab=tags`}
                  style={{ color: "var(--color-accent)" }}
                >
                  Add one in Settings
                </Link>
                .
              </span>
            )}
            {tags?.map((tag) => {
              const on = selectedIds.has(tag.id);
              const tokens = tagColorTokens(tag.color);
              return (
                <label key={tag.id} style={{ ...FILTER_MENU_ITEM_STYLE, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => onToggle(tag, e.target.checked)}
                    style={{ accentColor: "var(--color-accent)" }}
                  />
                  <span
                    aria-hidden
                    style={{
                      width: "0.6rem",
                      height: "0.6rem",
                      borderRadius: "0.15rem",
                      background: tokens.background,
                      border: `1px solid ${tokens.border}`,
                      flexShrink: 0,
                    }}
                  />
                  {tag.name}
                </label>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

export function TagsCard({
  collectionId,
  collectionSlug,
  tags,
  /** Writes the whole set — `setIssueTagsAction` or `setStampTagsAction`, already bound to the
   *  record. A replace rather than an add and a remove: the picker's ticks *are* the answer. */
  onSave,
}: {
  collectionId: string;
  collectionSlug: string;
  tags: TagSummary[];
  onSave: (tagIds: string[]) => Promise<{ status: string; message?: string }>;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistic, re-synced from the prop through the render-phase "reset state when a prop changes"
  // pattern: the page is server-rendered and a save asks the route for fresh data, so the chips
  // must not sit on the old answer for the length of that round trip.
  const [current, setCurrent] = useState<TagSummary[]>(tags);
  const [syncedFrom, setSyncedFrom] = useState(tags);
  if (syncedFrom !== tags) {
    setSyncedFrom(tags);
    setCurrent(tags);
  }

  const selectedIds = new Set(current.map((t) => t.id));

  function save(next: TagSummary[]) {
    const previous = current;
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      const result = await onSave(next.map((t) => t.id));
      if (result.status !== "success") {
        // Rolled back rather than left standing: a chip that stayed on after a refused write is the
        // screen claiming something the record does not say.
        setCurrent(previous);
        setError(result.message ?? "Failed to save tags.");
      }
    });
  }

  return (
    <DetailCard
      title="Tags"
      count={current.length || null}
      actions={
        <TagPicker
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          selectedIds={selectedIds}
          onToggle={(tag, on) =>
            save(
              on
                ? // Kept in the dictionary's own alphabetical order, so the chips read now exactly
                  // as they will once the page has been re-read.
                  byName([...current, tag])
                : current.filter((t) => t.id !== tag.id)
            )
          }
          disabled={isPending}
        />
      }
    >
      {current.length === 0 ? (
        <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", margin: 0 }}>
          No tags on this one. Tags are your own labels — <em>to check</em>, <em>for
          expertising</em>, <em>birds</em>.
        </p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
          {current.map((tag) => (
            <EditableTagChip
              key={tag.id}
              tag={tag}
              disabled={isPending}
              onRemove={() => save(current.filter((t) => t.id !== tag.id))}
            />
          ))}
        </div>
      )}
      {error && (
        <p style={{ fontSize: "0.75rem", color: "var(--color-error)", margin: "0.5rem 0 0" }}>
          {error}
        </p>
      )}
    </DetailCard>
  );
}

/** The order `src/lib/tags.ts` reads the dictionary in, applied to the optimistic set so the chips
 *  do not reshuffle when the server's answer arrives. */
function byName(tags: TagSummary[]): TagSummary[] {
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
