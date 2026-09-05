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
 * live count — good enough for a "give me an example" shuffle. `language` (#293) previews the copy
 * in the platform's listing language. */
export async function randomTitleSampleCopy(
  ownerId: string,
  collectionId: string,
  language: string | null = null
): Promise<TitleSampleCopy | null> {
  await assertCollectionOwner(ownerId, collectionId);
  const count = await prisma.item.count({ where: { collectionId } });
  if (count === 0) return null;
  const skip = Math.floor(Math.random() * count);
  const [row, mapCopy] = await Promise.all([
    prisma.item.findFirst({ where: { collectionId }, orderBy: { createdAt: "asc" }, skip, select: TITLE_COPY_SELECT }),
    makeTitleCopyMapper(ownerId, collectionId, language),
  ]);
  if (!row) return null;
  const copy = mapCopy(row);
  return { id: row.id, label: sampleLabel(copy), copy };
}

/** Several random copies, for previewing a **multi-line listing template** (#266/#267) — each is
 * shown as its own set so a `{#set}` block visibly repeats. Fewer are returned when the collection
 * holds fewer copies, and duplicates are avoided by drawing distinct offsets. */
export async function randomTitleSampleCopies(
  ownerId: string,
  collectionId: string,
  count: number,
  language: string | null = null
): Promise<TitleSampleCopy[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const total = await prisma.item.count({ where: { collectionId } });
  if (total === 0) return [];
  const wanted = Math.min(count, total);
  const offsets = new Set<number>();
  while (offsets.size < wanted) offsets.add(Math.floor(Math.random() * total));
  const mapCopy = await makeTitleCopyMapper(ownerId, collectionId, language);
  const rows = await Promise.all(
    [...offsets].map((skip) =>
      prisma.item.findFirst({
        where: { collectionId },
        orderBy: { createdAt: "asc" },
        skip,
        select: TITLE_COPY_SELECT,
      })
    )
  );
  return rows
    .filter((r) => r != null)
    .map((row) => {
      const copy = mapCopy(row);
      return { id: row.id, label: sampleLabel(copy), copy };
    });
}

/**
 * Named copies as template samples (#774) — for a screen that already knows exactly which copies the
 * text will be rendered over.
 *
 * The bulk-lot builder is the one such screen. Everywhere else a template is written *before* there
 * is anything to write it about, so the builder previews on **random** copies of the collection; a
 * lot is the opposite, and previewing its title against three stamps that are not in it would answer
 * a question nobody asked. It also makes `{count}` mean something: over the lot's own copies the
 * preview says the number the listing will actually carry.
 *
 * Capped by the caller. The whole lot is a hundred copies, and a preview is read, not counted — but
 * `{count}` must be right, so the cap belongs to the caller who knows whether it is previewing or
 * rendering.
 */
export async function titleSampleCopiesByIds(
  ownerId: string,
  collectionId: string,
  itemIds: readonly string[],
  language: string | null = null
): Promise<TitleSampleCopy[]> {
  await assertCollectionOwner(ownerId, collectionId);
  if (itemIds.length === 0) return [];
  const [rows, mapCopy] = await Promise.all([
    prisma.item.findMany({
      where: { collectionId, id: { in: [...itemIds] } },
      select: TITLE_COPY_SELECT,
    }),
    makeTitleCopyMapper(ownerId, collectionId, language),
  ]);
  // Back into the order asked for: the caller's order is the lot's, and a preview whose first copy
  // changed between two reads would look like the lot had.
  const byId = new Map(rows.map((row) => [row.id, row]));
  return itemIds
    .map((id) => byId.get(id))
    .filter((row) => row !== undefined)
    .map((row) => {
      const copy = mapCopy(row);
      return { id: row.id, label: sampleLabel(copy), copy };
    });
}

/** Copies matching `search` (by stamp name or catalog number), for the builder's "pick a specific
 * copy" list. A blank search returns the most recent copies. Capped at `limit` (default 12).
 * `language` (#293) previews the copy in the platform's listing language. */
export async function listTitleSampleCopies(
  ownerId: string,
  collectionId: string,
  opts: { search?: string; limit?: number; language?: string | null } = {}
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
    makeTitleCopyMapper(ownerId, collectionId, opts.language ?? null),
  ]);
  return rows.map((row) => {
    const copy = mapCopy(row);
    return { id: row.id, label: sampleLabel(copy), copy };
  });
}
