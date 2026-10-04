"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createTagAction,
  updateTagAction,
  deleteTagAction,
  getTagUsageAction,
} from "@/app/actions/tags";
import type { TagData } from "@/lib/tags";
import { TagColorPicker } from "@/app/c/[collectionSlug]/shared/tag-color-picker";
import { auctionKeys } from "@/app/c/[collectionSlug]/auctions/use-auctions-query";
import { useInvalidateStampsAndIssues } from "@/app/c/[collectionSlug]/shared/use-invalidate-stamps-and-issues";
import { useInvalidateInventory } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { tagKeys } from "@/app/c/[collectionSlug]/shared/use-tags";
import { nextTagColor, tagColorTokens, type TagColor } from "@/lib/tag-colors";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import {
  AddRowAction,
  DetailForm,
  DetailPlaceholder,
  FieldNote,
  Fields,
  INPUT_STYLE,
  InfoHint,
  ListDetail,
  ListPane,
  ListRow,
  ListRows,
  countLabel,
  useListSelection,
} from "./list-detail";

// The tag dictionary (#152) — the collector's own labels for what the fixed schema does not name —
// as a list beside the selected tag's detail (#1476).
//
// **Alphabetical, and there is no drag.** Every other dictionary on these pages is dragged into an
// order the collector states, because each holds a handful of grades whose sequence is itself a
// statement (a condition scale reads from best to worst). A tag list is the whole of an invented
// vocabulary and grows without limit, so the only order that stays useful as it grows is the one
// nobody has to maintain — which is also why `Tag` carries no `sortOrder` column to drag.
//
// **Nothing is seeded.** A collection with no use for tags has an empty list, and no screen asks it
// to configure anything before the feature does something.
//
// **The delete says what it takes off, and it does not refuse.** Every other dictionary here blocks
// a delete that is in use, because a condition in use is a fact about a copy. Deleting a tag *is*
// the act of taking that label off everything carrying it, so the confirmation states how many
// issues and stamps that is and the collector's yes is the whole guard.

/** *On 3 issues, 12 stamps and 40 copies* — the sentence the row and the delete confirmation both
 *  read from, so the count the collector agrees to is the count the list showed them. Copies are
 *  named beside the other two (#1181) rather than folded in: a tag that is on no stamp and on
 *  ninety copies is precisely the one a collector would otherwise delete believing it unused. */
function describeUsage(usage: {
  issueCount: number;
  stampCount: number;
  copyCount: number;
  lotCount: number;
}): string | null {
  const parts = [
    usage.issueCount > 0 ? `${usage.issueCount} issue${usage.issueCount === 1 ? "" : "s"}` : null,
    usage.stampCount > 0 ? `${usage.stampCount} stamp${usage.stampCount === 1 ? "" : "s"}` : null,
    usage.copyCount > 0 ? `${usage.copyCount} cop${usage.copyCount === 1 ? "y" : "ies"}` : null,
    // Auction lots (#1625), the fourth thing a tag hangs on.
    usage.lotCount > 0 ? `${usage.lotCount} auction lot${usage.lotCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function usageText(tag: TagData): string {
  const usage = describeUsage(tag);
  return usage ? `On ${usage}` : "Not used yet";
}

export function TagsPanel({
  collectionId,
  initialTags,
}: {
  collectionId: string;
  initialTags: TagData[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // A tag's name and colour are drawn on the chip, so both ride on the Issues, Stamps **and
  // Copies** rows (`tag-chip.tsx` says why) — which means a rename, a recolour or a delete stales
  // those lists as surely as editing the stamp itself would. The three detail screens' own picker
  // reads the dictionary through `tagKeys`, so that goes too.
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();
  const { invalidateList: invalidateInventory } = useInvalidateInventory();
  const sel = useListSelection(initialTags);
  const current = sel.adding ? null : sel.current;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: tagKeys.all(collectionId) });
    void invalidateStampsAndIssues(collectionId);
    void invalidateInventory(collectionId);
    // …and the auction lots' (#1625), whose rows carry their tags the same way.
    void queryClient.invalidateQueries({ queryKey: auctionKeys.all(collectionId) });
    router.refresh();
  }

  return (
    <>
      <AddRowAction label="Add tag" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(initialTags.length, "tag", "tags")}
            hint="Your own labels for what the rest of the app does not name — to check, for expertising, birds. Hang them on an issue, a stamp or a copy from its own screen. Listed alphabetically."
            empty={initialTags.length === 0 && "No tags yet."}
          >
            <ListRows label="Tags">
              {initialTags.map((tag) => (
                <ListRow
                  key={tag.id}
                  selected={current?.id === tag.id}
                  onSelect={() => sel.select(tag.id)}
                >
                  <span style={tagBadgeStyle(tag.color)}>{tag.name}</span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      textAlign: "right",
                      fontSize: "0.8125rem",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {usageText(tag)}
                  </span>
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New tag"}
              context={current ? usageText(current) : undefined}
              isNew={!current}
              onSave={(fd) =>
                current ? updateTagAction(current.id, fd) : createTagAction(collectionId, fd)
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete tag",
                      message: <DeleteTagMessage tag={current} />,
                      run: () => deleteTagAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <TagFields
                tag={current}
                // A new tag arrives with a free hue rather than grey (#728): picking one is a
                // glance to override and nothing to accept.
                newColor={nextTagColor(initialTags.map((t) => t.color))}
              />
            </DetailForm>
          ) : (
            <DetailPlaceholder>No tags yet. Add one to get started.</DetailPlaceholder>
          )
        }
      />
    </>
  );
}

function TagFields({ tag, newColor }: { tag: TagData | null; newColor: TagColor | null }) {
  const [color, setColor] = useState<TagColor | null>(tag ? tag.color : newColor);
  return (
    <Fields>
      <div>
        <LabelWithError htmlFor="f-tag-name">Name</LabelWithError>
        <TextInput
          id="f-tag-name"
          name="name"
          defaultValue={tag?.name ?? ""}
          placeholder="e.g. To check"
          autoFocus={!tag}
          style={INPUT_STYLE}
        />
        <FieldNote>Unique within the collection.</FieldNote>
      </div>
      <div>
        <LabelWithError>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            Colour
            <InfoHint>Tints this tag&rsquo;s chip wherever the things carrying it are listed.</InfoHint>
          </span>
        </LabelWithError>
        <TagColorPicker value={color} onChange={setColor} />
      </div>
    </Fields>
  );
}

/**
 * The delete confirmation's sentence, which **states what the delete takes the tag off** — and reads
 * that figure again as it opens rather than trusting the row's.
 *
 * The row's count is the page's, correct as of the last server render, and this is the one question
 * on the page where a stale number is not cosmetic: the whole guard on an irreversible write is the
 * sentence the collector agrees to. So it starts on the row's figure — there is no blank
 * confirmation and no spinner — and replaces it with the fresh one when it arrives. A failed read
 * leaves the row's own count standing, which is the honest fallback: the delete is still safe in the
 * sense that matters (nothing but join rows goes), and a confirmation that refused to state a number
 * would be worse than one stating a slightly old one.
 */
function DeleteTagMessage({ tag }: { tag: TagData }) {
  const [usage, setUsage] = useState({
    issueCount: tag.issueCount,
    stampCount: tag.stampCount,
    copyCount: tag.copyCount,
    lotCount: tag.lotCount,
  });
  useEffect(() => {
    let cancelled = false;
    void getTagUsageAction(tag.id)
      .then((fresh) => {
        if (!cancelled) setUsage(fresh);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tag.id]);

  const carried = describeUsage(usage);
  return (
    <>
      Delete the tag <strong>{tag.name}</strong>?{" "}
      {carried
        ? `It will be taken off ${carried}. Nothing else about them changes.`
        : "Nothing is carrying it."}{" "}
      This cannot be undone.
    </>
  );
}

/** The row's own chip, in the tag's colour — the same shape the lists draw (#728). */
function tagBadgeStyle(color: string | null): React.CSSProperties {
  const tokens = tagColorTokens(color);
  return {
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "0.8125rem",
    fontWeight: 500,
    color: tokens.color,
    background: tokens.background,
    border: `1px solid ${tokens.border}`,
    borderRadius: "0.25rem",
    padding: "0.1rem 0.5rem",
  };
}
