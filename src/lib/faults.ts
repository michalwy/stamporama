import "server-only";
import { prisma, type DbTransaction } from "./db";
import { findFaultByName, type FaultEntry } from "./fault-entry";
import {
  syncEntityTranslations,
  translationsByLanguage,
  type TranslationValueMap,
} from "./translations";

/**
 * The faults a copy can carry (#1557) — a thin, a thinned gum, a missing tooth, a crease — as a
 * dictionary the collector defines and a copy picks from, and the copies' own faults.
 *
 * The dictionary is shaped like the catalogue dictionaries (conditions, subtypes): **ordered by
 * hand**, **translated** per listing language for the offer texts that will print a fault (#1559),
 * and **seeded** with the common faults. A copy's faults are written two ways, exactly as its tags are
 * (`tags.ts`): the copy dialog **replaces** the set ({@link setItemFaultEntries}), and the Copies
 * list's bulk edit **adds** and **removes** named faults ({@link applyItemFaultChanges}), leaving every
 * fault it did not name alone.
 *
 * **A fault in use is never deleted** ({@link deleteFault}). Unlike a tag, deleting a fault is not
 * the act of taking it off the copies: a fault is a statement about the piece that a buyer is owed,
 * and a delete that silently erased it from ninety copies is the mistake the refusal exists to stop.
 * The database cascades at both ends anyway (see the migration for why a RESTRICT cannot be used),
 * so the rule lives here.
 *
 * A fault's effect on value is **not** here: it is a percentage typed on the copy (#1560).
 */

/** A fault as every surface that draws one needs it. */
export interface FaultSummary {
  id: string;
  name: string;
}

/** A fault in Settings: the summary, its translations, its place and how many copies carry it. */
export interface FaultData extends FaultSummary {
  /** Per-language overrides of {@link name}, keyed by ISO 639-1 code. Only languages with a stored,
   * non-blank value appear. */
  nameByLanguage: Record<string, string>;
  sortOrder: number;
  /** Copies carrying it — the reason it cannot be deleted while above zero. */
  copyCount: number;
}

/** The fault's translatable fields. One column — a fault has no abbreviation. */
export const FAULT_TRANSLATION_FIELDS = ["name"] as const;

/**
 * The common faults seeded into every new collection, in display order (#1557). English names and
 * no translations, as every other seeded dictionary (settled with the collector on 2026-10-03). The
 * collector renames, reorders or removes them.
 *
 * REPLICATED BY HAND in `20261003190000_copy_faults`, which seeds the existing collections;
 * `tests/integration/faults-domain.test.ts` checks the two agree.
 */
export const DEFAULT_FAULTS: readonly string[] = [
  "Thin",
  "Thinned gum",
  "Missing tooth",
  "Short perforation",
  "Crease",
  "Tear",
  "Hinge remnant",
  "Stain",
];

export class FaultNameTakenError extends Error {
  constructor() {
    super("A fault with this name already exists.");
    this.name = "FaultNameTakenError";
  }
}

/** Refused delete of a fault some copy still carries, with how many — what the message states. */
export class FaultInUseError extends Error {
  constructor(readonly copyCount: number) {
    super(`The fault is on ${copyCount} ${copyCount === 1 ? "copy" : "copies"}.`);
    this.name = "FaultInUseError";
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

async function resolveFaultCollection(faultId: string): Promise<string> {
  const fault = await prisma.fault.findUnique({
    where: { id: faultId },
    select: { collectionId: true },
  });
  if (!fault) throw new Error("Fault not found.");
  return fault.collectionId;
}

/** Seeds the common faults into a freshly created collection, inside its creation transaction. */
export async function seedDefaultFaults(collectionId: string, tx: DbTransaction): Promise<void> {
  await tx.fault.createMany({
    data: DEFAULT_FAULTS.map((name, sortOrder) => ({ collectionId, name, sortOrder })),
  });
}

/** The collection's fault dictionary with translations and use counts — Settings' own read. */
export async function getFaults(ownerId: string, collectionId: string): Promise<FaultData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.fault.findMany({
    where: { collectionId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      sortOrder: true,
      translations: { select: { language: true, name: true } },
      _count: { select: { copies: true } },
    },
  });
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    nameByLanguage: translationsByLanguage(f.translations, (t) => t.name),
    sortOrder: f.sortOrder,
    copyCount: f._count.copies,
  }));
}

/** The dictionary without counts or translations — what the copy dialog, the filter and the bulk
 *  edit offer. */
export async function listFaults(ownerId: string, collectionId: string): Promise<FaultSummary[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.fault.findMany({
    where: { collectionId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

async function syncFaultTranslations(
  faultId: string,
  values: TranslationValueMap | undefined
): Promise<void> {
  await syncEntityTranslations(values, {
    upsert: async (language, fields) => {
      const name = fields.name ?? null;
      await prisma.faultTranslation.upsert({
        where: { faultId_language: { faultId, language } },
        create: { faultId, language, name },
        update: { name },
      });
    },
    remove: async (language) => {
      await prisma.faultTranslation.deleteMany({ where: { faultId, language } });
    },
  });
}

async function nextSortOrder(client: DbTransaction | typeof prisma, collectionId: string) {
  const last = await client.fault.findFirst({
    where: { collectionId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return last ? last.sortOrder + 1 : 0;
}

export async function createFault(
  ownerId: string,
  collectionId: string,
  data: { name: string; translations?: TranslationValueMap }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  // Checked here so the collector reads *that name is taken* rather than *failed to create*, and
  // enforced by `fault_collectionId_name_key` so a concurrent write cannot slip past the check.
  const clash = await prisma.fault.findFirst({
    where: { collectionId, name: data.name },
    select: { id: true },
  });
  if (clash) throw new FaultNameTakenError();
  const created = await prisma.fault.create({
    data: { collectionId, name: data.name, sortOrder: await nextSortOrder(prisma, collectionId) },
    select: { id: true },
  });
  await syncFaultTranslations(created.id, data.translations);
}

/** Renames a fault and rewrites its per-language names. */
export async function updateFault(
  ownerId: string,
  faultId: string,
  data: { name: string; translations?: TranslationValueMap }
): Promise<void> {
  const collectionId = await resolveFaultCollection(faultId);
  await assertCollectionOwner(ownerId, collectionId);
  const clash = await prisma.fault.findFirst({
    where: { collectionId, name: data.name, id: { not: faultId } },
    select: { id: true },
  });
  if (clash) throw new FaultNameTakenError();
  await prisma.fault.update({ where: { id: faultId }, data: { name: data.name } });
  await syncFaultTranslations(faultId, data.translations);
}

/**
 * Deletes a fault no copy carries, and **refuses** one that some copy does, naming how many
 * ({@link FaultInUseError}). The count and the delete run in one transaction, so a copy given the
 * fault between the two cannot be stripped of it.
 */
export async function deleteFault(ownerId: string, faultId: string): Promise<void> {
  const collectionId = await resolveFaultCollection(faultId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.$transaction(async (tx) => {
    const copyCount = await tx.itemFault.count({ where: { faultId } });
    if (copyCount > 0) throw new FaultInUseError(copyCount);
    await tx.fault.delete({ where: { id: faultId } });
  });
}

/** Persists a new display order. `orderedIds` must be exactly the collection's fault ids. */
export async function reorderFaults(
  ownerId: string,
  collectionId: string,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const existing = await prisma.fault.findMany({ where: { collectionId }, select: { id: true } });
  const existingIds = new Set(existing.map((f) => f.id));
  if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) {
    throw new Error("Reorder list does not match the collection's faults.");
  }
  await prisma.$transaction(
    orderedIds.map((id, i) => prisma.fault.update({ where: { id }, data: { sortOrder: i } }))
  );
}

/**
 * The fault ids a dialog's chips stand for, creating the faults that do not exist yet — inside the
 * caller's transaction, so a fault is only ever born together with the copy that carries it, at the
 * end of the dictionary's order.
 *
 * A chip naming an existing fault by id attaches it. A chip with no id, or with an id that is no
 * longer this collection's fault, is resolved by **name, ignoring case** against the dictionary as
 * it is now. Ids from another collection are dropped rather than refused: the field cannot offer
 * one, so a request naming it is not something the collector did.
 */
async function resolveFaultEntries(
  tx: DbTransaction,
  collectionId: string,
  entries: readonly FaultEntry[]
): Promise<string[]> {
  if (entries.length === 0) return [];
  const dictionary = await tx.fault.findMany({
    where: { collectionId },
    select: { id: true, name: true, sortOrder: true },
  });
  let sortOrder = dictionary.reduce((max, f) => Math.max(max, f.sortOrder), -1) + 1;
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.id && dictionary.some((f) => f.id === entry.id)) {
      ids.push(entry.id);
      continue;
    }
    if (!entry.name) continue;
    const match = findFaultByName(dictionary, entry.name);
    if (match) {
      ids.push(match.id);
      continue;
    }
    const created = await tx.fault.create({
      data: { collectionId, name: entry.name, sortOrder: sortOrder++ },
      select: { id: true, name: true, sortOrder: true },
    });
    dictionary.push(created);
    ids.push(created.id);
  }
  return [...new Set(ids)];
}

/**
 * Replace the faults on one copy with what its edit dialog's chips say, creating the faults among
 * them that do not exist yet. A **replace**, because the field shows the whole set; resolving and
 * writing are one transaction.
 */
export async function setItemFaultEntries(
  ownerId: string,
  itemId: string,
  entries: readonly FaultEntry[]
): Promise<void> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!item) throw new Error("Copy not found.");
  if (item.collection.ownerId !== ownerId) throw new Error("Copy not found or access denied.");
  await prisma.$transaction(async (tx) => {
    const valid = await resolveFaultEntries(tx, item.collectionId, entries);
    await tx.itemFault.deleteMany({ where: { itemId, faultId: { notIn: valid } } });
    await tx.itemFault.createMany({
      data: valid.map((faultId) => ({ itemId, faultId })),
      skipDuplicates: true,
    });
  });
}

/**
 * Give copies **just created by identifying scan tiles** their faults (#1558) — each copy its own
 * chips, since a fault belongs to one piece and tiles identified together can keep their own marked
 * faults. One transaction, resolving as the copy dialog does: a name the dictionary does not hold
 * becomes a fault once, and the next copy naming it finds it.
 *
 * Ownership is the caller's: the copies were created a moment ago from tiles it has checked, in
 * `collectionId`. Never a replace — a new copy has no faults to keep or lose.
 */
export async function giveNewCopiesFaults(
  collectionId: string,
  perCopy: readonly { itemId: string; entries: readonly FaultEntry[] }[]
): Promise<void> {
  const wanted = perCopy.filter((c) => c.entries.length > 0);
  if (wanted.length === 0) return;
  await prisma.$transaction(async (tx) => {
    for (const { itemId, entries } of wanted) {
      const faultIds = await resolveFaultEntries(tx, collectionId, entries);
      if (faultIds.length === 0) continue;
      await tx.itemFault.createMany({
        data: faultIds.map((faultId) => ({ itemId, faultId })),
        skipDuplicates: true,
      });
    }
  });
}

/** {@link setItemFaultEntries} for faults that already exist, named by id. */
export async function setItemFaults(ownerId: string, itemId: string, faultIds: string[]): Promise<void> {
  await setItemFaultEntries(
    ownerId,
    itemId,
    faultIds.map((id) => ({ id, name: "" }))
  );
}

/** What a bulk pass does to the faults on a set of copies. Both sides optional; an empty one writes
 *  nothing — *leave as is*. */
export interface ItemFaultChanges {
  /** Faults put **on** every targeted copy. */
  addFaultIds?: string[];
  /** Faults taken **off** every targeted copy. */
  removeFaultIds?: string[];
}

/** Whether {@link ItemFaultChanges} says anything at all. */
export function hasItemFaultChanges(changes: ItemFaultChanges): boolean {
  return (changes.addFaultIds?.length ?? 0) > 0 || (changes.removeFaultIds?.length ?? 0) > 0;
}

/**
 * Add and remove named faults across a set of copies, inside a caller's transaction — never a
 * replace, for `applyItemTagChanges`'s reason: a selection is routinely mixed, and a replace would
 * flatten it onto whatever the dialog showed. Remove runs before add, so a fault named on both sides
 * ends up on. Ids that are not this collection's faults are dropped.
 */
export async function applyItemFaultChanges(
  tx: DbTransaction,
  collectionId: string,
  itemIds: string[],
  changes: ItemFaultChanges
): Promise<void> {
  if (itemIds.length === 0 || !hasItemFaultChanges(changes)) return;
  const [add, remove] = await Promise.all([
    validFaultIds(tx, collectionId, changes.addFaultIds ?? []),
    validFaultIds(tx, collectionId, changes.removeFaultIds ?? []),
  ]);
  if (remove.length > 0) {
    await tx.itemFault.deleteMany({ where: { itemId: { in: itemIds }, faultId: { in: remove } } });
  }
  if (add.length > 0) {
    await tx.itemFault.createMany({
      data: itemIds.flatMap((itemId) => add.map((faultId) => ({ itemId, faultId }))),
      skipDuplicates: true,
    });
  }
}

async function validFaultIds(
  client: DbTransaction,
  collectionId: string,
  faultIds: string[]
): Promise<string[]> {
  const unique = [...new Set(faultIds)];
  if (unique.length === 0) return [];
  const rows = await client.fault.findMany({
    where: { collectionId, id: { in: unique } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** The Prisma select every read model uses to carry a copy's faults. Name and place ride on the row,
 *  as a tag's do, so a chip never waits on the dictionary. */
export const FAULT_SUMMARY_SELECT = {
  select: { fault: { select: { id: true, name: true, sortOrder: true } } },
} as const;

/** Order the fault rows a read model carries — the dictionary's own order, so a copy's chips read
 *  the way the Settings list does. */
export function orderFaultSummaries(
  rows: { fault: { id: string; name: string; sortOrder: number } }[]
): FaultSummary[] {
  return [...rows]
    .sort((a, b) => a.fault.sortOrder - b.fault.sortOrder || a.fault.name.localeCompare(b.fault.name))
    .map((r) => ({ id: r.fault.id, name: r.fault.name }));
}
