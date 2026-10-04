"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { useCollectionTags } from "@/app/c/[collectionSlug]/shared/use-tags";
import type { AuctionLotView } from "./use-auctions-query";

/** Above this dialog's own panel (`zIndexBase + 1` = 101), so a tag menu opened inside it is not
 *  painted behind it — `MultiSelectFilter`'s own note. */
const MENU_Z_INDEX = 200;

const HINT_STYLE: React.CSSProperties = {
  margin: "0.375rem 0 0",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

/**
 * Tag the lots ticked on the lots list (#1625) — the Copies list's bulk tag pass (#1181), on lots.
 *
 * **Two verbs, never a replace**, for that pass's reason: a lot carries any number of tags, so a
 * mixed selection has no single answer a picker could show, and a replace would flatten every ticked
 * lot onto whatever the dialog held. It says what to put on and what to take off, and every tag it
 * does not name stays where it is on each lot. A tag ticked on one side is not offered on the other.
 *
 * It picks tags that exist rather than typing new ones, as the copies' pass does; a new tag is typed
 * in a lot's own dialog, or made in Settings.
 */
export function AuctionLotTagsDialog({
  collectionId,
  collectionSlug,
  lots,
  onClose,
  onApplied,
}: {
  collectionId: string;
  collectionSlug: string;
  /** The ticked lots **in view** — what the pass reaches, and all it reaches. */
  lots: AuctionLotView[];
  onClose: () => void;
  onApplied: (count: number) => void;
}) {
  const { data: tags } = useCollectionTags(collectionId);
  const [addTagIds, setAddTagIds] = useState<string[]>([]);
  const [removeTagIds, setRemoveTagIds] = useState<string[]>([]);
  // A tag menu is a popover with an Escape listener of its own and is not an escape layer (#361),
  // so the dialog stands aside while one is open — the bulk copy editor's arrangement.
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const count = lots.length;
  const lotsLabel = `${count} lot${count === 1 ? "" : "s"}`;
  const canApply = !isPending && (addTagIds.length > 0 || removeTagIds.length > 0);

  return (
    <DialogShell
      title={`Tags — ${lotsLabel}`}
      onClose={onClose}
      maxWidth="30rem"
      dismissable={!menuOpen}
    >
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!canApply) return;
          setError(undefined);
          startTransition(async () => {
            const { applyAuctionLotTagChangesAction } = await import("@/app/actions/auctions");
            const result = await applyAuctionLotTagChangesAction(
              collectionId,
              lots.map((l) => l.id),
              { addTagIds, removeTagIds }
            );
            if (result.status === "success") onApplied(result.count);
            else setError(result.message);
          });
        }}
      >
        <DialogBody>
          <div>
            <LabelWithError>Tags</LabelWithError>
            {(tags?.length ?? 0) === 0 ? (
              <p style={HINT_STYLE}>
                No tags yet. Type one into a lot&apos;s own dialog, or{" "}
                <Link
                  href={`/c/${collectionSlug}/settings?tab=tags`}
                  style={{ color: "var(--color-accent)" }}
                >
                  add one in Settings
                </Link>
                .
              </p>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <TagRow
                    label="Add"
                    options={(tags ?? [])
                      .filter((t) => !removeTagIds.includes(t.id))
                      .map((t) => ({ id: t.id, label: t.name }))}
                    selected={addTagIds}
                    onChange={setAddTagIds}
                    allLabel="No tags to add"
                    disabled={isPending}
                    onOpenChange={setMenuOpen}
                    // How many already carry every tag being added — whether this is a tagging pass
                    // or a no-op.
                    note={
                      addTagIds.length === 0
                        ? null
                        : describeAlready(
                            lots.filter((l) =>
                              addTagIds.every((id) => l.tags.some((t) => t.id === id))
                            ).length,
                            count
                          )
                    }
                  />
                  <TagRow
                    label="Remove"
                    options={(tags ?? [])
                      .filter((t) => !addTagIds.includes(t.id))
                      .map((t) => ({ id: t.id, label: t.name }))}
                    selected={removeTagIds}
                    onChange={setRemoveTagIds}
                    allLabel="No tags to remove"
                    disabled={isPending}
                    onOpenChange={setMenuOpen}
                    // How many the removal actually reaches; a lot not carrying the tag is left alone.
                    note={
                      removeTagIds.length === 0
                        ? null
                        : `on ${
                            lots.filter((l) =>
                              removeTagIds.some((id) => l.tags.some((t) => t.id === id))
                            ).length
                          } of ${count}`
                    }
                  />
                </div>
                <p style={HINT_STYLE}>
                  Only the tags named here change. Every other tag each lot carries is left exactly
                  as it is.
                </p>
              </>
            )}
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Applying…" : `Apply to ${lotsLabel}`}
          disabled={!canApply}
          cancelDisabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}

/** *all of them already* / *3 of 40 already* — the bulk copy editor's phrasing. */
function describeAlready(already: number, count: number): string {
  return already === count
    ? `all ${count === 1 ? "of it" : "of them"} already`
    : `${already} of ${count} already`;
}

/** One half of the change: a label, a multi-select over the dictionary, and what it would reach. */
function TagRow({
  label,
  options,
  selected,
  onChange,
  allLabel,
  disabled,
  onOpenChange,
  note,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  allLabel: string;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  note: string | null;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
      <span
        style={{
          width: "4.5rem",
          flexShrink: 0,
          fontSize: "0.8125rem",
          color: "var(--color-text-secondary)",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <MultiSelectFilter
          options={options}
          selected={selected}
          onChange={onChange}
          allLabel={allLabel}
          itemNoun="tags"
          ariaLabel={`${label} tags`}
          disabled={disabled}
          fullWidth
          zIndex={MENU_Z_INDEX}
          onOpenChange={onOpenChange}
        />
      </span>
      {note && (
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
          {note}
        </span>
      )}
    </div>
  );
}
