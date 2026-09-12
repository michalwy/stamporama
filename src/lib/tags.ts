import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { isTagColor, type TagColor } from "./tag-colors";

/**
 * User-defined tags (#152) — the collector's own labels for what the fixed schema does not name:
 * *to check*, *for expertising*, *birds*, *from the box grandfather left*.
 *
 * This module is the dictionary and the three places a tag hangs: an **issue**, a **stamp** and a
 * **copy** (#1181). Narrowing a list *by* tag is not here at all: it is `tag-filter.ts` (#1182),
 * which is pure because the panel, the route and the three list modules all have to agree about one
 * spelling of it — what this module left for it was the join tables' `tagId` indexes, which it reads
 * in the direction they were added for.
 *
 * **Nothing is inherited.** A tag on an issue is not on its stamps, a tag on a parent stamp is not
 * on its variants, a tag on a variant is not on its parent, and a tag on a stamp is not on the
 * copies of it — the answer ADR-0010 gives for catalogue attributes, because a variant is its own
 * stamp and a copy is a physical object rather than a catalogue entry. So there is no resolution to
 * write: every read here is the rows literally stored against the thing asked about.
 *
 * **A copy is written two ways, and that is the one asymmetry in the module.** The thing's own
 * screen replaces the set ({@link setItemTags}, the issue's and the stamp's rule), while the Copies
 * list's bulk edit **adds** named tags and **removes** named tags ({@link applyItemTagChanges}),
 * leaving every tag it did not name alone. Copies arrive by the drawerful and a selection is
 * routinely mixed, so a replace over one would flatten forty copies onto whatever the dialog
 * happened to show.
 */

/** A tag as every surface that draws one needs it. There is nothing else on the row worth
 *  carrying: a tag is a name and a colour. */
export interface TagSummary {
  id: string;
  name: string;
  /** The chip colour (#728), or null for the neutral chip. */
  color: TagColor | null;
}

/** A tag in Settings: the summary plus what carries it, which is what the delete confirmation
 *  states and what tells a tag in use from one the collector has finished with. */
export interface TagData extends TagSummary {
  /** Issues carrying it. */
  issueCount: number;
  /** Stamps carrying it. */
  stampCount: number;
  /** Copies carrying it (#1181). Counted beside the other two rather than folded into them: a
   *  delete takes the label off all three, and a tag that is on no stamp but on ninety copies is
   *  exactly the one a collector would otherwise delete believing it unused. */
  copyCount: number;
}

export class TagNameTakenError extends Error {
  constructor() {
    super("A tag with this name already exists.");
    this.name = "TagNameTakenError";
  }
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function resolveTagCollection(tagId: string): Promise<string> {
  const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { collectionId: true } });
  if (!tag) throw new Error("Tag not found.");
  return tag.collectionId;
}

/**
 * Read order is the **name**, case-insensitively, and there is deliberately no `sortOrder` column
 * behind it. Every other dictionary here is dragged into shape in Settings, because it holds a
 * handful of grades whose order is itself a statement. A tag list is the collector's whole invented
 * vocabulary and grows without limit, so the only order that stays useful as it grows is the one
 * nobody has to maintain.
 */
function byName<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function toSummary(row: { id: string; name: string; color: string | null }): TagSummary {
  return { id: row.id, name: row.name, color: isTagColor(row.color) ? row.color : null };
}

/** The collection's tag dictionary with what each tag carries — Settings' own read. */
export async function getTags(ownerId: string, collectionId: string): Promise<TagData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.tag.findMany({
    where: { collectionId },
    select: {
      id: true,
      name: true,
      color: true,
      _count: { select: { issues: true, stamps: true, copies: true } },
    },
  });
  return byName(rows).map((t) => ({
    ...toSummary(t),
    issueCount: t._count.issues,
    stampCount: t._count.stamps,
    copyCount: t._count.copies,
  }));
}

/** The dictionary without the counts — what the pickers on the two detail screens offer. */
export async function listTags(ownerId: string, collectionId: string): Promise<TagSummary[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.tag.findMany({
    where: { collectionId },
    select: { id: true, name: true, color: true },
  });
  return byName(rows).map(toSummary);
}

export async function createTag(
  ownerId: string,
  collectionId: string,
  data: { name: string; color: TagColor | null }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  // Checked here so the collector reads *that name is taken* rather than *failed to create*, and
  // enforced by `tag_collectionId_name_key` so a concurrent write cannot slip past the check.
  const clash = await prisma.tag.findFirst({
    where: { collectionId, name: data.name },
    select: { id: true },
  });
  if (clash) throw new TagNameTakenError();
  await prisma.tag.create({
    data: { collectionId, name: data.name, color: data.color ?? null },
  });
}

/** Rename and recolour are one write: the dialog edits both fields and there is no case where one
 *  is meaningful without the other being submitted. */
export async function updateTag(
  ownerId: string,
  tagId: string,
  data: { name: string; color: TagColor | null }
): Promise<void> {
  const collectionId = await resolveTagCollection(tagId);
  await assertCollectionOwner(ownerId, collectionId);
  const clash = await prisma.tag.findFirst({
    where: { collectionId, name: data.name, id: { not: tagId } },
    select: { id: true },
  });
  if (clash) throw new TagNameTakenError();
  await prisma.tag.update({
    where: { id: tagId },
    data: { name: data.name, color: data.color ?? null },
  });
}

/**
 * Deleting a tag takes it off everything carrying it — the join rows go with it by
 * `ON DELETE CASCADE`, which is where these tables part company with every other dictionary
 * reference here (`onDelete: Restrict`, because a colour in use is a fact about the stamp). There
 * is therefore **no in-use check and no refusal**: the confirmation states the count (see
 * {@link getTagUsage}) and the collector's *yes* is the whole guard.
 */
export async function deleteTag(ownerId: string, tagId: string): Promise<void> {
  const collectionId = await resolveTagCollection(tagId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.tag.delete({ where: { id: tagId } });
}

/** What a tag is on, read at the moment the delete confirmation is opened rather than off the
 *  list's own copy: the counts are what the collector is being asked to agree to. */
export async function getTagUsage(
  ownerId: string,
  tagId: string
): Promise<{ issueCount: number; stampCount: number; copyCount: number }> {
  const collectionId = await resolveTagCollection(tagId);
  await assertCollectionOwner(ownerId, collectionId);
  const [issueCount, stampCount, copyCount] = await Promise.all([
    prisma.issueTag.count({ where: { tagId } }),
    prisma.stampTag.count({ where: { tagId } }),
    prisma.itemTag.count({ where: { tagId } }),
  ]);
  return { issueCount, stampCount, copyCount };
}

/**
 * Replace the set of tags on one issue.
 *
 * A **replace** rather than an add and a remove, because the editor is a picker showing the whole
 * dictionary with the current set ticked: what it has is the answer, and two verbs over one control
 * would be two ways for the screen and the row to disagree. Tags from other collections are dropped
 * rather than refused — the picker cannot offer one, so a request naming it is not something the
 * collector did.
 */
export async function setIssueTags(
  ownerId: string,
  issueId: string,
  tagIds: string[]
): Promise<void> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { collectionId: true },
  });
  if (!issue) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, issue.collectionId);
  const valid = await validTagIds(issue.collectionId, tagIds);
  await prisma.$transaction([
    prisma.issueTag.deleteMany({ where: { issueId, tagId: { notIn: valid } } }),
    prisma.issueTag.createMany({
      data: valid.map((tagId) => ({ issueId, tagId })),
      skipDuplicates: true,
    }),
  ]);
}

/** Replace the set of tags on one stamp — {@link setIssueTags}'s rules exactly, one level down.
 *  Nothing propagates to the stamp's parent, its variants or its issue. */
export async function setStampTags(
  ownerId: string,
  stampId: string,
  tagIds: string[]
): Promise<void> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: stampId },
    select: { collectionId: true },
  });
  if (!stamp) throw new Error("Stamp not found.");
  await assertCollectionOwner(ownerId, stamp.collectionId);
  const valid = await validTagIds(stamp.collectionId, tagIds);
  await prisma.$transaction([
    prisma.stampTag.deleteMany({ where: { stampId, tagId: { notIn: valid } } }),
    prisma.stampTag.createMany({
      data: valid.map((tagId) => ({ stampId, tagId })),
      skipDuplicates: true,
    }),
  ]);
}

/**
 * Replace the set of tags on one copy (#1181) — {@link setIssueTags}'s rules, on the physical piece.
 *
 * The copy's **own screen** writes this way, because its editor is the same `TagsCard` picker: what
 * is ticked is the answer. The Copies list's bulk edit does not — see {@link applyItemTagChanges}
 * for why a selection is never replaced wholesale.
 *
 * Nothing propagates to the stamp this copy is linked to, and a copy carrying several stamps
 * (ADR-0044) takes its own tags rather than any of theirs.
 */
export async function setItemTags(
  ownerId: string,
  itemId: string,
  tagIds: string[]
): Promise<void> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!item) throw new Error("Copy not found.");
  if (item.collection.ownerId !== ownerId) throw new Error("Copy not found or access denied.");
  const valid = await validTagIds(item.collectionId, tagIds);
  await prisma.$transaction([
    prisma.itemTag.deleteMany({ where: { itemId, tagId: { notIn: valid } } }),
    prisma.itemTag.createMany({
      data: valid.map((tagId) => ({ itemId, tagId })),
      skipDuplicates: true,
    }),
  ]);
}

/** What a bulk pass does to the tags on a set of copies (#1181). Both sides are optional and an
 *  empty one writes nothing at all — *leave as is*, the rule every other half of that dialog
 *  already follows. */
export interface ItemTagChanges {
  /** Tags put **on** every targeted copy. Already-tagged copies are left as they are. */
  addTagIds?: string[];
  /** Tags taken **off** every targeted copy. A copy not carrying one is left as it is. */
  removeTagIds?: string[];
}

/** Whether {@link ItemTagChanges} says anything at all. */
export function hasItemTagChanges(changes: ItemTagChanges): boolean {
  return (changes.addTagIds?.length ?? 0) > 0 || (changes.removeTagIds?.length ?? 0) > 0;
}

/**
 * Add and remove named tags across a set of copies, inside a caller's transaction (#1181).
 *
 * **Never a replace.** The bulk editor names the tags to put on and the tags to take off, and every
 * tag it did not name is left exactly as it is on each copy — the same *leave as is* rule the
 * dialog's location, disposition and identity halves already follow. A replace would make one pass
 * over a mixed drawer flatten forty copies onto whatever the dialog happened to be showing, and
 * that is the one thing bulk editing must not be able to do quietly.
 *
 * **Remove runs before add**, so a tag named on both sides ends up *on*. The dialog cannot express
 * that — a tag ticked to be added is not offered to be removed — so this rule exists only to make
 * the write total rather than to be relied on: an order, not a feature.
 *
 * Tag ids that are not this collection's are dropped rather than refused, exactly as
 * {@link setIssueTags} drops them: the picker cannot offer one, so a request naming it is not
 * something the collector did.
 */
export async function applyItemTagChanges(
  tx: Prisma.TransactionClient,
  collectionId: string,
  itemIds: string[],
  changes: ItemTagChanges
): Promise<void> {
  if (itemIds.length === 0 || !hasItemTagChanges(changes)) return;
  const [add, remove] = await Promise.all([
    validTagIdsWith(tx, collectionId, changes.addTagIds ?? []),
    validTagIdsWith(tx, collectionId, changes.removeTagIds ?? []),
  ]);
  if (remove.length > 0) {
    await tx.itemTag.deleteMany({ where: { itemId: { in: itemIds }, tagId: { in: remove } } });
  }
  if (add.length > 0) {
    await tx.itemTag.createMany({
      // A copy already carrying the tag is not an error and not a second row: the pass says
      // *these copies carry this label now*, and a drawer where half of them already did is the
      // normal case.
      data: itemIds.flatMap((itemId) => add.map((tagId) => ({ itemId, tagId }))),
      skipDuplicates: true,
    });
  }
}

/** The submitted ids that really are this collection's tags, deduplicated. `collectionId` scopes
 *  every read here as it does everywhere else — a tag id from another collection is not a tag. */
async function validTagIds(collectionId: string, tagIds: string[]): Promise<string[]> {
  return validTagIdsWith(prisma, collectionId, tagIds);
}

/** {@link validTagIds} against a caller's client, so the bulk write can check the ids **inside**
 *  the transaction it is about to write in rather than against the state before it. */
async function validTagIdsWith(
  client: Prisma.TransactionClient | typeof prisma,
  collectionId: string,
  tagIds: string[]
): Promise<string[]> {
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return [];
  const rows = await client.tag.findMany({
    where: { collectionId, id: { in: unique } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Order the tag rows a read model carries. The join tables have no order of their own, so this is
 * the one rule every surface reads them through — the same alphabetical order the dictionary is
 * listed in, so a chip line and the Settings list agree.
 */
export function orderTagSummaries(
  rows: { tag: { id: string; name: string; color: string | null } }[]
): TagSummary[] {
  return byName(rows.map((r) => toSummary(r.tag)));
}

/** The Prisma select every read model uses to carry a thing's tags. A tag is a name and a colour,
 *  and both are drawn on the chip, so they ride on the row rather than being looked up per chip the
 *  way a condition's colour is (#728) — there the row already carries the label and only the tint
 *  is resolved, while a tag chip with no dictionary yet loaded would have nothing to say at all. */
export const TAG_SUMMARY_SELECT = {
  select: { tag: { select: { id: true, name: true, color: true } } },
} as const;
