import "server-only";
import { prisma } from "./db";
import {
  type CategoryKeyAxis,
  type MatchableLesson,
  type PlatformCategoryKey,
  categoryLookupTiers,
  derivePlatformCategoryKey,
  isEmptyCategoryKey,
  pickLessonForTiers,
} from "./platform-category-rules";

// The **key → category** register, for whichever marketplace is asking (#488 for Allegro; ADR-0026,
// generalised across platforms by #609; ADR-0035).
//
// The shape this module exists to guarantee: finishing an offer records what a kind of stamp was
// listed as, and the next offer of that kind opens with it already filled in. One table, keyed per
// (collection, platform) — which is what it has been since #488, the Allegro name it carried being
// the only Allegro thing about it.
//
// The judgements — what an offer's key is, which order lookup relaxes in, what a match should say it
// was matched on — are all in the pure `platform-category-rules.ts`. This half queries and records,
// and makes no decision of its own.
//
// What is deliberately **not** here is anything a marketplace adds on top. Allegro's parameter
// register and its title-guess stay in `allegro-category.ts`; Delcampe's published category list
// stays in `delcampe-category-catalog.ts`. Only the half both marketplaces genuinely share is
// shared, which is what stops this becoming a union of two unrelated features.

export async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

// ---------------------------------------------------------------------------
// The area tree lookup walks
// ---------------------------------------------------------------------------

interface AreaTree {
  /** An area and its ancestors, nearest first — the rungs lookup walks up. */
  pathOf: (areaId: string | null) => string[];
  /** An area's own id together with every id below it. */
  descendantsOf: (areaId: string) => string[];
}

/** The collection's areas as the two shapes lookup needs. One flat read: the tree is small, and
 *  walking it in memory beats a recursive query per rung. */
async function loadAreaTree(collectionId: string): Promise<AreaTree> {
  const rows = await prisma.collectionArea.findMany({
    where: { collectionId },
    select: { id: true, parentId: true },
  });
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    childrenOf.set(row.parentId, [...(childrenOf.get(row.parentId) ?? []), row.id]);
  }

  return {
    pathOf(areaId) {
      const path: string[] = [];
      let current = areaId;
      // A cycle is not a state this app can produce, but a walk that trusts the data to be a tree is
      // a walk that hangs the request if it ever is not.
      while (current && !path.includes(current) && parentOf.has(current)) {
        path.push(current);
        current = parentOf.get(current) ?? null;
      }
      return path;
    },
    descendantsOf(areaId) {
      const out: string[] = [];
      const queue = [areaId];
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next || out.includes(next)) continue;
        out.push(next);
        queue.push(...(childrenOf.get(next) ?? []));
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// An offer's key
// ---------------------------------------------------------------------------

/** An offer's key, with the names the three id-shaped parts stand for so a screen can state it
 *  without three more reads, and the axes the copies disagreed about. */
export interface PlatformCategoryKeyView {
  key: PlatformCategoryKey;
  areaName: string | null;
  conditionName: string | null;
  subtypeName: string | null;
  mixedOn: CategoryKeyAxis[];
}

/**
 * The key one offer looks its category up by, on any platform.
 *
 * Derived from the copies of **every** set, not one representative: an offer is what a buyer takes,
 * and a bundle whose second set is something else entirely is exactly the mixed case the agreement
 * rule exists for.
 *
 * The area is the stamp's **primary** area (`StampCollectionArea.isPrimary`); a stamp filed under
 * several areas without one marked primary contributes no area, which reads as mixed and relaxes.
 */
export async function getPlatformCategoryKeyForOffer(
  collectionId: string,
  offerId: string
): Promise<PlatformCategoryKeyView | null> {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, collectionId },
    select: {
      sets: {
        select: {
          items: {
            select: {
              item: {
                select: {
                  conditionId: true,
                  stamp: {
                    select: {
                      issuedYear: true,
                      subtypeId: true,
                      stampAreaLinks: {
                        where: { isPrimary: true },
                        select: { collectionAreaId: true },
                        take: 1,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!offer) return null;

  const copies = offer.sets.flatMap((set) =>
    set.items.map(({ item }) => ({
      areaId: item.stamp.stampAreaLinks[0]?.collectionAreaId ?? null,
      issuedYear: item.stamp.issuedYear,
      conditionId: item.conditionId,
      subtypeId: item.stamp.subtypeId,
    }))
  );

  const { key, mixedOn } = derivePlatformCategoryKey(copies);
  return { key, mixedOn, ...(await namesFor(collectionId, key)) };
}

/** What the three id-shaped key parts are called, for the sentence a suggestion carries. */
async function namesFor(
  collectionId: string,
  key: PlatformCategoryKey
): Promise<{ areaName: string | null; conditionName: string | null; subtypeName: string | null }> {
  const [area, condition, subtype] = await Promise.all([
    key.areaId
      ? prisma.collectionArea.findFirst({
          where: { id: key.areaId, collectionId },
          select: { name: true },
        })
      : null,
    key.conditionId
      ? prisma.stampCondition.findFirst({
          where: { id: key.conditionId, collectionId },
          select: { name: true },
        })
      : null,
    key.subtypeId
      ? prisma.stampSubtype.findFirst({
          where: { id: key.subtypeId, collectionId },
          select: { name: true },
        })
      : null,
  ]);
  return {
    areaName: area?.name ?? null,
    conditionName: condition?.name ?? null,
    subtypeName: subtype?.name ?? null,
  };
}

/** The key parts a rung still asked about, as words — "Poland · 1935 · used". */
export function matchedPartNames(
  keyView: PlatformCategoryKeyView,
  relaxed: CategoryKeyAxis[]
): string[] {
  const parts: string[] = [];
  if (keyView.areaName && !relaxed.includes("area")) parts.push(keyView.areaName);
  if (keyView.key.issuedYear !== null && !relaxed.includes("year")) {
    parts.push(String(keyView.key.issuedYear));
  }
  if (keyView.conditionName) parts.push(keyView.conditionName);
  if (keyView.subtypeName && !relaxed.includes("subtype")) parts.push(keyView.subtypeName);
  return parts;
}

// ---------------------------------------------------------------------------
// Looking one up
// ---------------------------------------------------------------------------

/** A learned row and the rung it was reached on. */
export interface LearnedCategoryMatch {
  categoryId: string;
  categoryName: string | null;
  categoryPath: string | null;
  timesUsed: number;
  /** Which axes lookup had to widen to find it. Empty on an exact match. */
  relaxed: CategoryKeyAxis[];
}

/**
 * The register's answer for one key on one platform, or null.
 *
 * The whole platform's rows are read in one query and matched in memory: the register is a
 * collector's own handful of kinds, and one round-trip per rung of the ladder would be up to a dozen
 * for a deep area tree.
 */
export async function lookupPlatformCategoryLesson(
  collectionId: string,
  platformId: string,
  keyView: PlatformCategoryKeyView
): Promise<LearnedCategoryMatch | null> {
  // A key that asks nothing would match every row ever recorded, which is a coin toss rather than a
  // suggestion. What happens instead is the caller's business.
  if (isEmptyCategoryKey(keyView.key)) return null;

  const tree = await loadAreaTree(collectionId);
  const tiers = categoryLookupTiers(keyView.key, tree.pathOf(keyView.key.areaId), (areaId) =>
    tree.descendantsOf(areaId)
  );

  const rows = await prisma.platformCategoryLesson.findMany({
    where: { platformId },
    select: {
      id: true,
      areaId: true,
      issuedYear: true,
      conditionId: true,
      subtypeId: true,
      categoryId: true,
      categoryName: true,
      categoryPath: true,
      timesUsed: true,
      lastUsedAt: true,
    },
  });

  const matchable: (MatchableLesson & { categoryName: string | null; categoryPath: string | null })[] =
    rows.map((row) => ({ ...row, lastUsedAt: row.lastUsedAt.getTime() }));
  const picked = pickLessonForTiers(matchable, tiers);
  if (!picked) return null;

  const lesson = matchable.find((row) => row.id === picked.lesson.id);
  if (!lesson) return null;
  return {
    categoryId: lesson.categoryId,
    categoryName: lesson.categoryName,
    categoryPath: lesson.categoryPath,
    timesUsed: lesson.timesUsed,
    relaxed: picked.tier.relaxed,
  };
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/** What a finished offer teaches about its key. */
export interface PlatformCategoryLessonInput {
  categoryId: string;
  categoryName?: string | null;
  categoryPath?: string | null;
}

/**
 * Record what one offer's key was listed as.
 *
 * Correcting a suggestion and finishing the offer again is itself a lesson, and the newer choice
 * wins over the older one — which is why the row is an upsert that overwrites the category and bumps
 * `timesUsed` rather than a second row beside the first.
 *
 * A key that asks nothing is **not** recorded: it would answer every future lookup with whatever was
 * prepared last, which is the one thing a suggestion must never do.
 */
export async function recordPlatformCategoryLesson(
  collectionId: string,
  platformId: string,
  key: PlatformCategoryKey,
  input: PlatformCategoryLessonInput
): Promise<void> {
  if (isEmptyCategoryKey(key)) return;

  const where = {
    platformId,
    areaId: key.areaId,
    issuedYear: key.issuedYear,
    conditionId: key.conditionId,
    subtypeId: key.subtypeId,
  };
  const categoryName = input.categoryName?.trim() || null;
  const categoryPath = input.categoryPath?.trim() || null;

  // Nulls are values of this key, and Prisma cannot address a `NULLS NOT DISTINCT` index in an
  // `upsert`'s `where` — so the row is found first and the index stays the guard against the race,
  // which is one collector finishing two offers at once and is not a real one.
  const existing = await prisma.platformCategoryLesson.findFirst({ where, select: { id: true } });
  if (existing) {
    await prisma.platformCategoryLesson.update({
      where: { id: existing.id },
      data: {
        categoryId: input.categoryId,
        categoryName,
        categoryPath,
        timesUsed: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
    return;
  }
  await prisma.platformCategoryLesson.create({
    data: { collectionId, ...where, categoryId: input.categoryId, categoryName, categoryPath },
  });
}

// ---------------------------------------------------------------------------
// What a settings panel shows, and what it can change
// ---------------------------------------------------------------------------

/** One learned association, as a panel reads it. */
export interface PlatformCategoryLessonRow {
  id: string;
  /** The key in words — "Poland · 1935 · used · definitive", with `Any` where a part is absent. */
  areaName: string | null;
  issuedYear: number | null;
  conditionName: string | null;
  subtypeName: string | null;
  categoryId: string;
  categoryName: string | null;
  categoryPath: string | null;
  timesUsed: number;
  lastUsedAt: string;
}

/** Everything one platform's register holds, best-backed first. */
export async function listPlatformCategoryLessons(
  platformId: string
): Promise<PlatformCategoryLessonRow[]> {
  const rows = await prisma.platformCategoryLesson.findMany({
    where: { platformId },
    orderBy: [{ timesUsed: "desc" }, { lastUsedAt: "desc" }],
    select: {
      id: true,
      issuedYear: true,
      categoryId: true,
      categoryName: true,
      categoryPath: true,
      timesUsed: true,
      lastUsedAt: true,
      area: { select: { name: true } },
      condition: { select: { name: true } },
      subtype: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    areaName: row.area?.name ?? null,
    issuedYear: row.issuedYear,
    conditionName: row.condition?.name ?? null,
    subtypeName: row.subtype?.name ?? null,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryPath: row.categoryPath,
    timesUsed: row.timesUsed,
    lastUsedAt: row.lastUsedAt.toISOString(),
  }));
}

async function assertLessonOwner(ownerId: string, lessonId: string): Promise<void> {
  const row = await prisma.platformCategoryLesson.findUnique({
    where: { id: lessonId },
    select: { collectionId: true },
  });
  if (!row) throw new Error("That learned category is no longer there.");
  await assertCollectionOwner(ownerId, row.collectionId);
}

/**
 * Point one learned association at a different category.
 *
 * The direct correction, and the reason a panel is not delete-only: a collector who spots a wrong
 * association should be able to say what the right one is, rather than delete the row and wait for
 * the next offer to teach it again. The count is **reset**, not kept — what was recorded seven times
 * was the old category, and carrying its support over to a category nothing has ever been listed in
 * would be this app asserting something it has never seen.
 */
export async function updatePlatformCategoryLesson(
  ownerId: string,
  lessonId: string,
  category: { categoryId: string; categoryName?: string | null; categoryPath?: string | null }
): Promise<void> {
  await assertLessonOwner(ownerId, lessonId);
  const categoryId = category.categoryId.trim();
  if (!categoryId) throw new Error("A learned association needs a category.");
  await prisma.platformCategoryLesson.update({
    where: { id: lessonId },
    data: {
      categoryId,
      categoryName: category.categoryName?.trim() || null,
      categoryPath: category.categoryPath?.trim() || null,
      timesUsed: 1,
      lastUsedAt: new Date(),
    },
  });
}

/** Forget one association. Nothing else changes: listings already up keep the category they went out
 *  with, the marketplace holding those from the moment they were sent. */
export async function deletePlatformCategoryLesson(
  ownerId: string,
  lessonId: string
): Promise<void> {
  await assertLessonOwner(ownerId, lessonId);
  await prisma.platformCategoryLesson.delete({ where: { id: lessonId } });
}
