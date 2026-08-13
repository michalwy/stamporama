import "server-only";
import { prisma } from "./db";
import { countHeldCopyRowsByStamp } from "./copy-counts";
import type { HeldCopyRow } from "./held-copies";
import { loadStampWantSummaries, type StampWantSummary } from "./wants";

/**
 * What the collection holds of **one** stamp, and what it is still after (#562) — the pair the
 * intake step states at the moment the stamp is identified, so the keep-or-sell call is taken with
 * both in front of the collector rather than after the copies exist.
 *
 * Composed here rather than inside `copy-counts.ts`, which is imported by every catalogue reader
 * and has no other reason to know about wants.
 *
 * Deliberately **one stamp**, against `loadStampCopyCounts`'s page of them: this answers a question
 * asked about the stamp that was just picked, and a second page-shaped reader beside the one every
 * list already uses would be two answers to "what does this collection hold".
 */
export interface StampHoldings {
  /** Held copies split by condition and disposition. Empty when none are held. */
  rows: HeldCopyRow[];
  /** Open wants on the stamp, null when it is on none — the marker's own rule (#532). */
  wants: StampWantSummary | null;
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

export async function getStampHoldings(
  ownerId: string,
  collectionId: string,
  stampId: string
): Promise<StampHoldings> {
  await assertCollectionOwner(ownerId, collectionId);
  const [rowsByStamp, wantsByStamp] = await Promise.all([
    countHeldCopyRowsByStamp(collectionId, [stampId]),
    loadStampWantSummaries(collectionId, [stampId]),
  ]);
  return {
    rows: rowsByStamp.get(stampId) ?? [],
    wants: wantsByStamp.get(stampId) ?? null,
  };
}
