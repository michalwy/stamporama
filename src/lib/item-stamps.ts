import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";

// The stamps a copy carries (ADR-0044, #744) — and the **only** module that writes them, or
// `Item.stampId` and `Item.stampCount`.
//
// A **multi-stamp copy** is an indivisible carrier — a cover, a fragment, a card, an FDC — bearing
// several catalogue positions the catalogue never numbered as a whole. It stays one `Item`: nothing
// is decomposed into N copies, exactly as ADR-0020 §2 refuses to decompose a block of four, because
// `itemNo`, location, cost basis, photos, offers, sale lines and trade lines all describe the thing
// that is sold.
//
// `ItemStamp` carries **every** stamp on the piece, the leading one included, so "which pieces carry
// Mi 200" is one query. `Item.stampId` is then a denormalised pointer at the first entry and
// `Item.stampCount` the summed `quantity` of all of them — both **derived**, and derived here. A
// call site that set either by hand would let the rule they exist for (#745: a carrier bearing more
// than one stamp is a copy of *none* of them, the leading one on the same terms as the rest) fall
// out of step with the rows it is read from, and nothing would say so.
//
// What this module deliberately does **not** do is decide anything about a copy. It never creates or
// deletes an `Item`, and never touches a disposition, a location or a cost: `items.ts` and `lots.ts`
// own the copy and call in here for the one thing they must not write themselves.

/** One stamp on a copy, as read back. */
export interface ItemStampEntry {
  id: string;
  stampId: string;
  /** How many of this component the carrier bears — components, not sheets of paper (ADR-0044 §4). */
  quantity: number;
  /** The component's own format; null = single. */
  formatId: string | null;
  /** Position on the piece, always `0..n-1` with no gaps — see {@link syncItemFromEntriesTx}. */
  sortOrder: number;
}

/** One stamp as written. `quantity` defaults to 1 and `formatId` to null (single). */
export interface ItemStampEntryInput {
  stampId: string;
  quantity?: number;
  formatId?: string | null;
}

const ENTRY_SELECT = {
  id: true,
  stampId: true,
  quantity: true,
  formatId: true,
  sortOrder: true,
} as const;

/** The order the entries are always read in. `sortOrder` is the collector's; `id` only keeps the
 *  order total, so one read cannot present two entries in a different order than the next. */
const ENTRY_ORDER = [{ sortOrder: "asc" as const }, { id: "asc" as const }];

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** The copy's collection, with the caller proven to own it. */
async function assertItemOwner(ownerId: string, itemId: string): Promise<string> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { collectionId: true },
  });
  if (!item) throw new Error("Item not found.");
  await assertCollectionOwner(ownerId, item.collectionId);
  return item.collectionId;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Everything an entry list has to be true of before a row is written.
 *
 * The stamps and formats are checked against **the copy's own collection**, not merely for
 * existence: a carrier pointed at another collector's stamp would be a cross-collection read
 * dressed up as a description of a cover.
 *
 * The duplicate check restates, in a sentence a collector can act on, what `item_stamp_unique`
 * enforces in the database. The index stays the authority — two concurrent saves cannot both pass
 * this check — but a raw constraint violation names a constraint, where what went wrong is "that
 * stamp is already on this piece, in that format".
 *
 * Exported for {@link setItemStampsTx}, whose caller opens the transaction and so has to do this
 * first: every check here is a **read**, and reading it inside the write would turn a sentence the
 * collector can act on into a rolled-back save.
 */
export async function validateItemStampEntries(
  collectionId: string,
  entries: readonly ItemStampEntryInput[]
): Promise<void> {
  if (entries.length === 0) {
    // A copy is a copy *of* something. Emptying the list would leave `Item.stampId` pointing at a
    // stamp no entry names, which is the one state the pointer must never be in.
    throw new Error("A copy must carry at least one stamp.");
  }

  for (const entry of entries) {
    const quantity = entry.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("A stamp on a copy must have a whole quantity of at least 1.");
    }
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    // Ids are cuids, so neither half can contain the separator and no pair of entries can collide
    // on a key they do not actually share.
    const key = `${entry.stampId}|${entry.formatId ?? ""}`;
    if (seen.has(key)) throw new Error("That stamp is already on this copy in the same format.");
    seen.add(key);
  }

  const stampIds = [...new Set(entries.map((entry) => entry.stampId))];
  const stamps = await prisma.stamp.count({ where: { id: { in: stampIds }, collectionId } });
  if (stamps !== stampIds.length) throw new Error("Stamp not found in this collection.");

  const formatIds = [
    ...new Set(entries.map((entry) => entry.formatId).filter((id): id is string => !!id)),
  ];
  if (formatIds.length > 0) {
    const formats = await prisma.stampFormat.count({
      where: { id: { in: formatIds }, collectionId },
    });
    if (formats !== formatIds.length) throw new Error("Format not found in this collection.");
  }
}

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

/**
 * Re-derive `Item.stampId` and `Item.stampCount` from the entries, and renumber the entries to
 * `0..n-1`. The single point at which the two denormalised columns are written.
 *
 * The renumbering is what lets every other operation here be careless about `sortOrder`: an append
 * may use any number above the last, a removal may leave a gap, and the positions are tidy again
 * before anything reads them. It is safe to do in a loop precisely because `sortOrder` carries **no
 * unique index** — the transient duplicate that sinks a renumbering elsewhere (see
 * `docs/agents/platform.md`) has nothing here to collide with.
 */
async function syncItemFromEntriesTx(
  tx: Prisma.TransactionClient,
  itemId: string
): Promise<ItemStampEntry[]> {
  const rows = await tx.itemStamp.findMany({
    where: { itemId },
    orderBy: ENTRY_ORDER,
    select: ENTRY_SELECT,
  });
  if (rows.length === 0) throw new Error("A copy must carry at least one stamp.");

  const entries: ItemStampEntry[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.sortOrder !== index) {
      await tx.itemStamp.update({ where: { id: row.id }, data: { sortOrder: index } });
    }
    entries.push({ ...row, sortOrder: index });
  }

  await tx.item.update({
    where: { id: itemId },
    data: {
      // The pointer is the first entry, and nothing else (ADR-0044 §2). It is no longer the claim
      // "this copy is that stamp" — §3 takes that away from it — but it must still name a stamp the
      // piece actually carries, or the 171 readers of `Item.stampId` would be reading a stamp that
      // is not on the piece.
      stampId: entries[0].stampId,
      stampCount: entries.reduce((sum, entry) => sum + entry.quantity, 0),
    },
  });

  return entries;
}

// ---------------------------------------------------------------------------
// Writes from the copy-creating paths
// ---------------------------------------------------------------------------

/**
 * The one entry every newly created copy gets: its own stamp, quantity 1, no component format,
 * first position. Called by every path that creates an `Item` — the copy form, purchase intake, an
 * auction settlement, the demo seed — in the same transaction as the create.
 *
 * This is what the backfill in `20260911120000_multi_stamp_copies` did for the copies that already
 * existed, and the reason it is not optional: an `Item` with no entry is a copy whose stamps are
 * *unknown* rather than a copy of one stamp, and every read that goes through `ItemStamp` — the
 * editor (#746), the list chip (#748), the `{catalog}` token (#749) — would silently pass it by.
 *
 * `Item.stampCount` is left at its default of 1, which is exactly what one entry of quantity 1 sums
 * to, so the derivation is not re-run: nothing has had the chance to make the two disagree. A copy
 * is never *born* a carrier — a carrier is made by editing one (#746).
 */
export async function createLeadingEntriesTx(
  tx: Prisma.TransactionClient,
  copies: readonly { id: string; stampId: string }[]
): Promise<void> {
  if (copies.length === 0) return;
  await tx.itemStamp.createMany({
    data: copies.map((copy) => ({
      itemId: copy.id,
      stampId: copy.stampId,
      quantity: 1,
      formatId: null,
      sortOrder: 0,
    })),
  });
}

/**
 * Move the **leading** entry to another stamp, for the two paths that re-point a copy in place: an
 * edit that changes the stamp, and variant refinement (ADR-0007 §6). The piece is the same physical
 * thing and keeps its `itemNo`, its history and everything else; what changed is which catalogue
 * position it is filed under.
 *
 * Only the first entry moves. On an ordinary one-stamp copy that is the whole story; on a carrier it
 * is deliberately narrow, because re-pointing is a statement about *one* stamp and the others on the
 * cover are untouched facts about it.
 *
 * Returns quietly when the copy is already there, so no caller has to check first.
 */
export async function repointLeadingStampTx(
  tx: Prisma.TransactionClient,
  itemId: string,
  toStampId: string
): Promise<void> {
  const [leading] = await tx.itemStamp.findMany({
    where: { itemId },
    orderBy: ENTRY_ORDER,
    select: { id: true, stampId: true, formatId: true },
    take: 1,
  });
  // A copy created by a path that has not been taught to call `createLeadingEntriesTx` has no entry
  // to move. Writing one is the honest repair: the copy carries that stamp either way, and refusing
  // the edit would charge the collector for a gap on this side of the code.
  if (!leading) {
    await tx.itemStamp.create({
      data: { itemId, stampId: toStampId, quantity: 1, formatId: null, sortOrder: 0 },
    });
    await tx.item.update({ where: { id: itemId }, data: { stampId: toStampId, stampCount: 1 } });
    return;
  }
  if (leading.stampId === toStampId) return;

  // The destination may already be on the piece as another entry in the same format — a cover
  // franked with Mi 200 and Mi 201 whose leading stamp is re-identified as Mi 201. Merging the two
  // is a decision about the piece that this call has no business taking on its own, so it is
  // refused and left to the editor (#746).
  const clash = await tx.itemStamp.findFirst({
    where: { itemId, stampId: toStampId, formatId: leading.formatId, id: { not: leading.id } },
    select: { id: true },
  });
  if (clash) throw new Error("That stamp is already on this copy in the same format.");

  await tx.itemStamp.update({ where: { id: leading.id }, data: { stampId: toStampId } });
  await syncItemFromEntriesTx(tx, itemId);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The stamps one copy carries, in the collector's order. */
export async function listItemStamps(ownerId: string, itemId: string): Promise<ItemStampEntry[]> {
  await assertItemOwner(ownerId, itemId);
  return prisma.itemStamp.findMany({
    where: { itemId },
    orderBy: ENTRY_ORDER,
    select: ENTRY_SELECT,
  });
}

/** The entries of many copies at once, keyed by copy — one query for a whole page of rows, which is
 *  the shape every list screen here reads in (#748). A copy with no entry is absent from the map. */
export async function loadItemStampsByItem(
  itemIds: readonly string[]
): Promise<Map<string, ItemStampEntry[]>> {
  const byItem = new Map<string, ItemStampEntry[]>();
  if (itemIds.length === 0) return byItem;
  const rows = await prisma.itemStamp.findMany({
    where: { itemId: { in: [...new Set(itemIds)] } },
    orderBy: [{ itemId: "asc" }, ...ENTRY_ORDER],
    select: { ...ENTRY_SELECT, itemId: true },
  });
  for (const { itemId, ...entry } of rows) {
    const list = byItem.get(itemId);
    if (list) list.push(entry);
    else byItem.set(itemId, [entry]);
  }
  return byItem;
}

// ---------------------------------------------------------------------------
// Writes from the editor
// ---------------------------------------------------------------------------

/**
 * Replace the whole list of stamps a copy carries, in the given order (#746's write).
 *
 * A replace rather than a diff. An entry holds nothing but the facts the caller passes — no
 * timestamp, no note — and nothing anywhere references one by id, so rewriting the list loses
 * nothing, while a diff would have to guess which incoming entry is which existing row and would
 * guess wrong exactly when the collector reorders and re-formats in one pass.
 *
 * Taking a carrier back down to one stamp is an ordinary call here with no confirmation of its own:
 * the copy re-enters every count it had dropped out of, because the counts follow the facts
 * (ADR-0044 §7).
 */
export async function setItemStamps(
  ownerId: string,
  itemId: string,
  entries: readonly ItemStampEntryInput[]
): Promise<ItemStampEntry[]> {
  const collectionId = await assertItemOwner(ownerId, itemId);
  await validateItemStampEntries(collectionId, entries);

  return prisma.$transaction((tx) => setItemStampsTx(tx, itemId, entries));
}

/**
 * {@link setItemStamps}' write, inside a transaction the caller already holds — for the copy edit
 * (#746), which saves the copy's own columns and the stamps on it as **one** save. Splitting them
 * into two transactions would let a copy come out of one save carrying the old cover's stamps and
 * the new one's condition, and nothing would say which half had landed.
 *
 * The **validation is the caller's**, through {@link validateItemStampEntries}, and it belongs
 * before the transaction opens: it reads the stamps and formats to check them against the copy's own
 * collection, and a refusal has to reach the collector as a sentence rather than as a rolled-back
 * write. `syncItemFromEntriesTx` still re-derives the two columns here, so the invariant this module
 * owns cannot be got round by using the Tx form.
 */
export async function setItemStampsTx(
  tx: Prisma.TransactionClient,
  itemId: string,
  entries: readonly ItemStampEntryInput[]
): Promise<ItemStampEntry[]> {
  await tx.itemStamp.deleteMany({ where: { itemId } });
  await tx.itemStamp.createMany({
    data: entries.map((entry, index) => ({
      itemId,
      stampId: entry.stampId,
      quantity: entry.quantity ?? 1,
      formatId: entry.formatId ?? null,
      sortOrder: index,
    })),
  });
  return syncItemFromEntriesTx(tx, itemId);
}

/** Add one stamp to the end of a copy's list — the single-entry shorthand for {@link setItemStamps}.
 *  A copy that gains its second stamp this way becomes a multi-stamp copy and leaves the counts. */
export async function addItemStamp(
  ownerId: string,
  itemId: string,
  entry: ItemStampEntryInput
): Promise<ItemStampEntry[]> {
  const collectionId = await assertItemOwner(ownerId, itemId);
  const existing = await prisma.itemStamp.findMany({
    where: { itemId },
    orderBy: ENTRY_ORDER,
    select: ENTRY_SELECT,
  });
  await validateItemStampEntries(collectionId, [...existing, entry]);

  return prisma.$transaction(async (tx) => {
    await tx.itemStamp.create({
      data: {
        itemId,
        stampId: entry.stampId,
        quantity: entry.quantity ?? 1,
        formatId: entry.formatId ?? null,
        sortOrder: existing.length,
      },
    });
    return syncItemFromEntriesTx(tx, itemId);
  });
}

/** Take one stamp off a copy. The last one cannot go: a copy is a copy *of* something, and a piece
 *  the collector no longer wants described is deleted rather than emptied. */
export async function removeItemStamp(
  ownerId: string,
  itemId: string,
  entryId: string
): Promise<ItemStampEntry[]> {
  await assertItemOwner(ownerId, itemId);
  const entries = await prisma.itemStamp.findMany({
    where: { itemId },
    orderBy: ENTRY_ORDER,
    select: { id: true },
  });
  if (!entries.some((entry) => entry.id === entryId)) {
    throw new Error("That stamp is not on this copy.");
  }
  if (entries.length === 1) throw new Error("A copy must carry at least one stamp.");

  return prisma.$transaction(async (tx) => {
    await tx.itemStamp.delete({ where: { id: entryId } });
    return syncItemFromEntriesTx(tx, itemId);
  });
}
