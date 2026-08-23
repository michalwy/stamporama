import "server-only";
import { prisma } from "./db";
import {
  COLNECT_STANDARD_LISTS,
  colnectStandardList,
  isColnectListSource,
  isColnectListSourceOfTruth,
  type ColnectListSource,
  type ColnectListSourceOfTruth,
} from "./colnect-list-sync-rules";

// **Which Colnect list mirrors what** (#684) — the configuration half of the list-sync track, and
// the only half that exists yet. Import (#685), the report (#686) and anything written back to
// Colnect (#689) build on the tables this module writes; none of them is here.
//
// The shape is the condition mapping's (#404) rather than the catalog mapping's (#248), and for the
// same reason: the set of things to configure is **fixed and known** — Colnect's four standard
// lists — so the screen lists all four, mapped or not, and there is nothing to create or delete.
// {@link getColnectListMappings} therefore always answers four entries, filling the built-in
// defaults in for a list the collector has never touched, and {@link setColnectListMapping} upserts
// one field of one list. A row appears the first time anything on that list is changed.
//
// Nothing here evaluates a `source`. What `items_for_trade` selects is the report's question, asked
// once against the whole collection rather than per list here (#686).

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** Raised when a write names a list, predicate or side this build does not know. The action layer
 *  turns it into a user-facing message; it is a programming or a stale-tab error rather than
 *  anything the collector can type, since every control is a fixed picker. */
export class ColnectListMappingValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColnectListMappingValueError";
  }
}

/** One standard list as Settings shows it: what it is configured to mirror, or what it *would*
 *  mirror if the collector switched it on. */
export interface ColnectListMappingData {
  /** Colnect's list id, and the key every write is addressed by. */
  lt: number;
  label: string;
  source: string;
  sourceOfTruth: string;
  enabled: boolean;
  /** False where no row exists yet and the three values above are the built-in defaults. The screen
   *  says so — a list showing *Copies for trade* because somebody chose it and one showing it
   *  because it is the obvious answer are different states, and only the first survives a change to
   *  the defaults. */
  configured: boolean;
}

/**
 * Every standard list, in Colnect's own order, configured or not. Owner-authorized.
 *
 * A custom list with a mapping row — which the schema allows and no screen yet creates — is
 * deliberately **not** listed: this read is what Settings renders, and Settings offers the standard
 * four. Nothing is hidden by it, because nothing can create one.
 */
export async function getColnectListMappings(
  ownerId: string,
  collectionId: string
): Promise<ColnectListMappingData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.colnectListMapping.findMany({
    where: { collectionId, lt: { in: COLNECT_STANDARD_LISTS.map((l) => l.lt) } },
    select: { lt: true, label: true, source: true, sourceOfTruth: true, enabled: true },
  });
  const byLt = new Map(rows.map((r) => [r.lt, r]));
  return COLNECT_STANDARD_LISTS.map((list) => {
    const row = byLt.get(list.lt);
    return row
      ? {
          lt: list.lt,
          label: row.label,
          source: row.source,
          sourceOfTruth: row.sourceOfTruth,
          enabled: row.enabled,
          configured: true,
        }
      : {
          lt: list.lt,
          label: list.label,
          source: list.defaultSource,
          sourceOfTruth: list.defaultSourceOfTruth,
          enabled: false,
          configured: false,
        };
  });
}

/** What one write may change. Every field is optional because the panel's controls each write on
 *  their own — there is no draft and no Save, so a change to the predicate must not carry an
 *  opinion about whether the list is switched on. */
export interface ColnectListMappingPatch {
  source?: ColnectListSource;
  sourceOfTruth?: ColnectListSourceOfTruth;
  enabled?: boolean;
}

/**
 * Configure one standard list, creating its row on first touch. Owner-authorized.
 *
 * The row is created with the **built-in defaults** and the patch on top, so a collector who only
 * ticks *enabled* gets the list mirroring what it obviously should rather than an empty predicate,
 * and the `label` a custom list will one day need is seeded from Colnect's own name.
 */
export async function setColnectListMapping(
  ownerId: string,
  collectionId: string,
  lt: number,
  patch: ColnectListMappingPatch
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);

  const list = colnectStandardList(lt);
  if (!list) throw new ColnectListMappingValueError(`Colnect list ${lt} is not one this app syncs.`);
  if (patch.source !== undefined && !isColnectListSource(patch.source)) {
    throw new ColnectListMappingValueError(`"${patch.source}" is not a list source.`);
  }
  if (patch.sourceOfTruth !== undefined && !isColnectListSourceOfTruth(patch.sourceOfTruth)) {
    throw new ColnectListMappingValueError(`"${patch.sourceOfTruth}" is not a source of truth.`);
  }

  await prisma.colnectListMapping.upsert({
    where: { collectionId_lt: { collectionId, lt } },
    create: {
      collectionId,
      lt,
      label: list.label,
      source: patch.source ?? list.defaultSource,
      sourceOfTruth: patch.sourceOfTruth ?? list.defaultSourceOfTruth,
      enabled: patch.enabled ?? false,
    },
    update: {
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.sourceOfTruth !== undefined ? { sourceOfTruth: patch.sourceOfTruth } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    },
  });
}
