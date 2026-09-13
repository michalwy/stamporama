import "server-only";
import { prisma } from "./db";
import { buildDescendantMap } from "./pricing";
import { assertCollectionOwner } from "./platform-category";
import type { StampSelectionAnswer } from "./stamp-tree-selection";

/**
 * What a selection of stamps on the Issues list's tree reaches (#808): which of the ticked ids still
 * exist in this collection, and every stamp below each of them at any depth.
 *
 * The walk is `buildDescendantMap`, the same one `applyStampSizePreset` expands its subject through
 * (ADR-0048 §7) — every descendant, no `actsAsVariant` filter at any level — so the reach the bar
 * states and the stamps a preset write touches are one set, and the integration suite compares them.
 * The rules for what the client does with the answer are `stamp-tree-selection.ts`.
 *
 * Ids from another collection, or gone, are simply absent from `existingIds` rather than an error:
 * a selection is client state that can outlive a delete, and the answer is what prunes it.
 */
export async function getStampSelectionSubtrees(
  ownerId: string,
  collectionId: string,
  stampIds: readonly string[]
): Promise<StampSelectionAnswer> {
  await assertCollectionOwner(ownerId, collectionId);
  const asked = [...new Set(stampIds)];
  if (asked.length === 0) return { asked, existingIds: [], subtrees: {} };

  const found = await prisma.stamp.findMany({
    where: { id: { in: asked }, collectionId },
    select: { id: true },
  });
  const existingIds = found.map((s) => s.id);
  const descendants = await buildDescendantMap(collectionId, new Set(existingIds));

  const subtrees: Record<string, string[]> = {};
  for (const id of existingIds) subtrees[id] = [...(descendants.get(id) ?? [])];
  return { asked, existingIds, subtrees };
}
