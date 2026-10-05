import "server-only";
import { prisma, type DbTransaction } from "./db";
import { repointLeadingStampTx } from "./item-stamps";
import {
  candidateSetShape,
  canonicalCandidateSet,
  type CandidateTreeNode,
} from "./candidate-set-rules";
import { childIsVariant, VARIANT_FLAG_SELECT } from "./variant-classification";

// A copy identified as **one of several candidate stamps** (#1651, ADR-0065) — the only module that
// writes `ItemCandidate` and `Item.candidateTrees`.
//
// The set is one fact and three columns: the rows, the number of variant trees they span, and where
// `Item.stampId` points (the nearest common variant ancestor in one tree, the first candidate across
// several). All three are derived here from the canonical set, because a call site that wrote one by
// hand would let the counts — which read only `candidateTrees` and the pointer — fall out of step
// with the rows a reader names the copy by.
//
// The pointer and the tree count depend on the **catalogue** as well as on the set, so a stamp tree
// edit that could change them calls {@link refreshCandidateCopiesTx}.

/** What a copy now is, after {@link setCopyStampTx}. */
export interface CopyStampResult {
  /** `Item.stampId` — the stamp itself, or the set's pointer. */
  stampId: string;
  /** The canonical set in catalogue order; empty for an ordinary copy. */
  candidateStampIds: string[];
  /** `Item.candidateTrees`. */
  candidateTrees: number;
}

/** The copies' candidate sets, in catalogue order — `itemId → stampIds`. Copies without one are absent. */
export async function loadCandidatesByItem(
  itemIds: readonly string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (itemIds.length === 0) return out;
  const rows = await prisma.itemCandidate.findMany({
    where: { itemId: { in: [...itemIds] } },
    select: { itemId: true, stampId: true },
    orderBy: [{ stamp: { primaryCatalogSortKey: { sort: "asc", nulls: "last" } } }, { stampId: "asc" }],
  });
  for (const row of rows) out.set(row.itemId, [...(out.get(row.itemId) ?? []), row.stampId]);
  return out;
}

/**
 * Read every stamp the candidate rules need about `stampIds`: the stamps, every ancestor, and every
 * child of every ancestor — the last because *all variants of one umbrella are the umbrella* needs
 * to know what all of them are.
 */
export async function loadCandidateTreeTx(
  tx: DbTransaction,
  collectionId: string,
  stampIds: readonly string[]
): Promise<Map<string, CandidateTreeNode>> {
  const tree = new Map<string, CandidateTreeNode>();
  const select = { id: true, parentId: true, primaryCatalogSortKey: true, ...VARIANT_FLAG_SELECT };
  const add = (rows: { id: string; parentId: string | null; primaryCatalogSortKey: string | null; actsAsVariantOverride: boolean | null; subtype: { actsAsVariant: boolean } | null }[]) => {
    for (const s of rows) {
      tree.set(s.id, {
        id: s.id,
        parentId: s.parentId,
        isVariant: s.parentId !== null && childIsVariant(s),
        sortKey: s.primaryCatalogSortKey,
      });
    }
  };

  let frontier = [...new Set(stampIds)];
  const ancestors = new Set<string>();
  while (frontier.length > 0) {
    const rows = await tx.stamp.findMany({ where: { id: { in: frontier }, collectionId }, select });
    add(rows);
    frontier = rows
      .map((s) => s.parentId)
      .filter((id): id is string => id !== null && !tree.has(id));
    for (const id of frontier) ancestors.add(id);
  }
  if (ancestors.size > 0) {
    add(await tx.stamp.findMany({ where: { parentId: { in: [...ancestors] }, collectionId }, select }));
  }
  return tree;
}

/**
 * Identify a copy as one stamp or as a set of candidates — the one write behind the copy dialog,
 * identification, settling and narrowing, and the agent API's `set_copy_stamp`.
 *
 * `stampIds` is what was ticked. It is put in canonical form first (`canonicalCandidateSet`), so
 * ticking every variant of an umbrella stores the umbrella, and one stamp left makes an ordinary
 * copy. A set is refused on a copy carrying several stamps (decided with the collector, 2026-10-05).
 *
 * Re-pointing the copy writes a refinement-history row as any re-identification does (ADR-0007 §6);
 * narrowing a set without moving the pointer writes none, as nothing the history records changed.
 */
export async function setCopyStampTx(
  tx: DbTransaction,
  itemId: string,
  stampIds: readonly string[],
  note?: string | null
): Promise<CopyStampResult> {
  const item = await tx.item.findUnique({
    where: { id: itemId },
    select: { collectionId: true, stampId: true, stampCount: true, _count: { select: { stamps: true } } },
  });
  if (!item) throw new Error("Item not found.");
  if (stampIds.length === 0) throw new Error("Pick at least one stamp.");

  const tree = await loadCandidateTreeTx(tx, item.collectionId, stampIds);
  if (stampIds.some((id) => !tree.has(id))) throw new Error("Stamp not found in this collection.");

  const canonical = canonicalCandidateSet(stampIds, tree);
  if (canonical.length > 1 && (item.stampCount > 1 || item._count.stamps > 1)) {
    throw new Error(
      "A copy carrying several stamps cannot be identified as one of several candidates. Keep one stamp on it first."
    );
  }
  const shape =
    canonical.length > 1 ? candidateSetShape(canonical, tree) : { trees: 0, pointerStampId: canonical[0] };

  await tx.itemCandidate.deleteMany({ where: { itemId } });
  if (canonical.length > 1) {
    await tx.itemCandidate.createMany({ data: canonical.map((stampId) => ({ itemId, stampId })) });
  }
  await tx.item.update({ where: { id: itemId }, data: { candidateTrees: shape.trees } });

  if (shape.pointerStampId !== item.stampId) {
    await repointLeadingStampTx(tx, itemId, shape.pointerStampId);
    await tx.itemVariantHistory.create({
      data: { itemId, fromStampId: item.stampId, toStampId: shape.pointerStampId, note: note ?? null },
    });
  }

  return {
    stampId: shape.pointerStampId,
    candidateStampIds: canonical.length > 1 ? canonical : [],
    candidateTrees: shape.trees,
  };
}

/** {@link setCopyStampTx} in a transaction of its own, for a collector who owns the copy. */
export async function setCopyStamp(
  ownerId: string,
  itemId: string,
  stampIds: readonly string[],
  note?: string | null
): Promise<CopyStampResult> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { collection: { select: { ownerId: true } } },
  });
  if (!item || item.collection.ownerId !== ownerId) throw new Error("Item not found.");
  return prisma.$transaction((tx) => setCopyStampTx(tx, itemId, stampIds, note));
}

/**
 * Drop a copy's candidate set — for the paths that re-identify a copy as one stamp, or give it more
 * stamps, without going through {@link setCopyStampTx}: a set is a statement about the copy's one
 * stamp, and a new statement replaces it.
 */
export async function clearCandidatesTx(tx: DbTransaction, itemId: string): Promise<void> {
  const { count } = await tx.itemCandidate.deleteMany({ where: { itemId } });
  if (count > 0) await tx.item.update({ where: { id: itemId }, data: { candidateTrees: 0 } });
}

/**
 * Re-derive the pointer and the tree count of every candidate copy in a collection, after a stamp
 * tree edit that could change them: a stamp moved under another parent, a stamp or a subtype that
 * starts or stops acting as a variant, a stamp deleted with its children re-parented. The set
 * itself is kept as the collector ticked it — only what it means for the counts moves — and no
 * history row is written, since the copy was not re-identified.
 */
export async function refreshCandidateCopiesTx(
  tx: DbTransaction,
  collectionId: string
): Promise<void> {
  const copies = await tx.item.findMany({
    where: { collectionId, candidateTrees: { gt: 0 } },
    select: { id: true, stampId: true, candidateTrees: true, candidates: { select: { stampId: true } } },
  });
  for (const copy of copies) {
    const ids = copy.candidates.map((c) => c.stampId);
    if (ids.length < 2) continue;
    const shape = candidateSetShape(ids, await loadCandidateTreeTx(tx, collectionId, ids));
    if (shape.trees !== copy.candidateTrees) {
      await tx.item.update({ where: { id: copy.id }, data: { candidateTrees: shape.trees } });
    }
    if (shape.pointerStampId !== copy.stampId) {
      await repointLeadingStampTx(tx, copy.id, shape.pointerStampId);
    }
  }
}
