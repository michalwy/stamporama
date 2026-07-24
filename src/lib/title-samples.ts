import "server-only";
import { prisma } from "./db";
import { TITLE_COPY_SELECT, makeTitleCopyMapper } from "./title-copy";
import type { TitleTemplateCopy } from "./offer-title-template";

// Sample inventory copies for the template builder's live preview (#210). A collector edits a
// platform's title template and sees it rendered against a real copy — a random one by default, or
// one they search out. Normalisation (Prisma row → `TitleTemplateCopy`) is shared with offer/set
// title generation via `title-copy.ts`, so the preview matches what listings actually get. All
// access is owner-scoped.

/** A copy offered to the builder: its normalised template fields plus a short human label + id so
 * the picker can show which copy the preview is running on. */
export interface TitleSampleCopy {
  id: string;
  /** Short label identifying the copy in the picker, e.g. `Mi 12 · Mercury`. */
  label: string;
  copy: TitleTemplateCopy;
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

/** A short display label for a sample copy: primary catalog number and/or stamp name, falling back
 * to a generic word so the picker always shows something. */
function sampleLabel(copy: TitleTemplateCopy): string {
  const primaryCatalog = (copy.catalogNumbers.find((c) => c.isPrimary) ?? copy.catalogNumbers[0])?.number ?? null;
  const parts = [primaryCatalog, copy.name].filter((p): p is string => !!p);
  return parts.join(" · ") || "Untitled copy";
}

/** One random copy from the collection, for the builder's default preview. Null when the collection
 * has no copies yet (the builder then previews against an empty copy). Uses a random offset over the
 * live count — good enough for a "give me an example" shuffle. */
export async function randomTitleSampleCopy(
  ownerId: string,
  collectionId: string
): Promise<TitleSampleCopy | null> {
  await assertCollectionOwner(ownerId, collectionId);
  const count = await prisma.item.count({ where: { collectionId } });
  if (count === 0) return null;
  const skip = Math.floor(Math.random() * count);
  const [row, mapCopy] = await Promise.all([
    prisma.item.findFirst({ where: { collectionId }, orderBy: { createdAt: "asc" }, skip, select: TITLE_COPY_SELECT }),
    makeTitleCopyMapper(ownerId, collectionId),
  ]);
  if (!row) return null;
  const copy = mapCopy(row);
  return { id: row.id, label: sampleLabel(copy), copy };
}

/** Copies matching `search` (by stamp name or catalog number), for the builder's "pick a specific
 * copy" list. A blank search returns the most recent copies. Capped at `limit` (default 12). */
export async function listTitleSampleCopies(
  ownerId: string,
  collectionId: string,
  opts: { search?: string; limit?: number } = {}
): Promise<TitleSampleCopy[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const search = opts.search?.trim();
  const [rows, mapCopy] = await Promise.all([
    prisma.item.findMany({
      where: {
        collectionId,
        ...(search
          ? {
              OR: [
                { stamp: { name: { contains: search, mode: "insensitive" } } },
                { stamp: { catalogNumbers: { some: { number: { contains: search, mode: "insensitive" } } } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 12,
      select: TITLE_COPY_SELECT,
    }),
    makeTitleCopyMapper(ownerId, collectionId),
  ]);
  return rows.map((row) => {
    const copy = mapCopy(row);
    return { id: row.id, label: sampleLabel(copy), copy };
  });
}
