import "server-only";
import { prisma } from "./db";
import { getAllegroAccessToken } from "./allegro-connection";
import {
  type AllegroCategory,
  type AllegroCategoryParameter,
  getAllegroCategory,
  listAllegroCategories,
  listAllegroCategoryParameters,
  matchAllegroCategories,
} from "./allegro-api";
import { ALLEGRO_PLATFORM_MODULE } from "./platform-modules";
import {
  type AllegroCategoryKey,
  type AllegroParameterValue,
  type CategoryKeyAxis,
  type CategorySuggestionSource,
  type MatchableLesson,
  categoryLookupTiers,
  deriveAllegroCategoryKey,
  explainCategoryMatch,
  isBlankParameterValue,
  isEmptyCategoryKey,
  pickLessonForTiers,
  readParameterValue,
} from "./allegro-category-rules";

// Allegro categories are **learned, not configured** (#488; ADR-0026) — the stamp-side half of what a
// listing needs, beside #486's account-side half.
//
// The shape this module exists to guarantee: publishing a listing Allegro accepted records what a
// kind of stamp was listed as, and the next offer of that kind opens with it already filled in. Two
// registers, deliberately (ADR-0026 §1): a key → category, and a category's parameter → the value
// last answered for it.
//
// The judgements — what an offer's key is, which order lookup relaxes in, what a match should say it
// was matched on — are all in the pure `allegro-category-rules.ts`. This half queries, records and
// talks to Allegro, and makes no decision of its own.
//
// Nothing here publishes anything. #477 is the consumer, and what it asks of this module is
// {@link suggestAllegroCategoryForOffer} before the listing goes out and
// {@link recordAllegroCategoryLesson} after Allegro accepted it.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** The platform this collection calls Allegro — what both registers hang off (ADR-0026 §5). Read
 *  through the same marker `setAllegroPlatform` writes, so "which platform is Allegro" keeps having
 *  exactly one answer. */
async function allegroPlatformOf(
  collectionId: string
): Promise<{ id: string; name: string } | null> {
  const platform = await prisma.contact.findFirst({
    where: { collectionId, platform: true, platformModule: ALLEGRO_PLATFORM_MODULE },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return platform ?? null;
}

async function requireAllegroPlatform(collectionId: string): Promise<{ id: string; name: string }> {
  const platform = await allegroPlatformOf(collectionId);
  if (!platform) {
    throw new Error(
      "This collection has no Allegro platform yet. Name one at the top of Settings → Allegro first."
    );
  }
  return platform;
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

/** An offer's key, with the names the four ids stand for so a screen can state it without four more
 *  reads, and the axes the copies disagreed about. */
export interface AllegroCategoryKeyView {
  key: AllegroCategoryKey;
  areaName: string | null;
  conditionName: string | null;
  subtypeName: string | null;
  mixedOn: CategoryKeyAxis[];
}

/**
 * The key one offer looks its category up by.
 *
 * Derived from the copies of **every** set, not one representative: an offer is what a buyer takes,
 * and a bundle whose second set is something else entirely is exactly the mixed case the agreement
 * rule exists for.
 *
 * The area is the stamp's **primary** area (`StampCollectionArea.isPrimary`); a stamp filed under
 * several areas without one marked primary contributes no area, which reads as mixed and relaxes.
 */
export async function getAllegroCategoryKeyForOffer(
  collectionId: string,
  offerId: string
): Promise<AllegroCategoryKeyView | null> {
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

  const { key, mixedOn } = deriveAllegroCategoryKey(copies);
  return { key, mixedOn, ...(await namesFor(collectionId, key)) };
}

/** What the three id-shaped key parts are called, for the sentence a suggestion carries. */
async function namesFor(
  collectionId: string,
  key: AllegroCategoryKey
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

// ---------------------------------------------------------------------------
// The suggestion #477 opens its dialog with
// ---------------------------------------------------------------------------

/** One parameter of the chosen category, with whatever the register remembers being answered for it
 *  — the second register's whole contribution. */
export interface AllegroCategoryParameterPrefill {
  parameter: AllegroCategoryParameter;
  /** The value last answered for this parameter on this category, or null where nothing has been. A
   *  required parameter with a null here is exactly what is left for the collector. */
  recalled: AllegroParameterValue | null;
  timesUsed: number | null;
}

export interface AllegroCategorySuggestion {
  /** What the offer was looked up by, and why it is as narrow as it is. */
  key: AllegroCategoryKeyView;
  source: CategorySuggestionSource;
  categoryId: string | null;
  categoryName: string | null;
  categoryPath: string | null;
  /** One sentence saying where this came from — never absent on a suggestion, because a suggestion
   *  the collector cannot account for is one they re-check by hand every time. */
  matchedOn: string;
  /** Which axes lookup had to widen to find it. Empty on an exact match. */
  relaxed: CategoryKeyAxis[];
  /** How well backed the learned row is; null for Allegro's own guess and for no suggestion. */
  timesUsed: number | null;
  /** The chosen category's parameters with their recalled values. Empty when nothing was suggested,
   *  and read live — what a category *asks* is Allegro's, and only the answers are remembered. */
  parameters: AllegroCategoryParameterPrefill[];
  /** Why the parameters could not be read, where Allegro could not be reached. The suggestion itself
   *  survives a connection that is down: it came out of this app's own register. */
  parametersError: string | null;
}

/**
 * The category one offer would be published into, and the parameter values it would go out with.
 *
 * Learned first, then Allegro's own `matching-categories` guess from the title, then nothing — and
 * **always a suggestion**, never a decision (ADR-0026 §6). #477 shows it, says what it was matched
 * on, and lets it be changed before anything is sent.
 */
export async function suggestAllegroCategoryForOffer(
  ownerId: string,
  collectionId: string,
  offerId: string
): Promise<AllegroCategorySuggestion | null> {
  await assertCollectionOwner(ownerId, collectionId);
  const keyView = await getAllegroCategoryKeyForOffer(collectionId, offerId);
  if (!keyView) return null;

  const platform = await allegroPlatformOf(collectionId);
  const learned = platform ? await lookupLesson(platform.id, collectionId, keyView) : null;

  if (learned) {
    return withParameters(ownerId, collectionId, {
      key: keyView,
      source: "learned",
      categoryId: learned.lesson.categoryId,
      categoryName: learned.lesson.categoryName,
      categoryPath: learned.lesson.categoryPath,
      matchedOn: explainCategoryMatch({
        source: "learned",
        matchedOn: matchedPartNames(keyView, learned.tier.relaxed),
        relaxed: learned.tier.relaxed,
        timesUsed: learned.lesson.timesUsed,
      }),
      relaxed: learned.tier.relaxed,
      timesUsed: learned.lesson.timesUsed,
      parameters: [],
      parametersError: null,
    });
  }

  // Nothing learned. Allegro's own guess is the next-best thing, and a connection that is down is
  // simply no guess — the manual pick is always available and is never blocked by this.
  const guess = await guessFromTitle(ownerId, collectionId, offerId);
  if (guess) {
    return withParameters(ownerId, collectionId, {
      key: keyView,
      source: "allegro",
      categoryId: guess.id,
      categoryName: guess.name,
      categoryPath: null,
      matchedOn: explainCategoryMatch({
        source: "allegro",
        matchedOn: [],
        relaxed: [],
        timesUsed: null,
      }),
      relaxed: [],
      timesUsed: null,
      parameters: [],
      parametersError: null,
    });
  }

  return {
    key: keyView,
    source: "none",
    categoryId: null,
    categoryName: null,
    categoryPath: null,
    matchedOn: explainCategoryMatch({ source: "none", matchedOn: [], relaxed: [], timesUsed: null }),
    relaxed: [],
    timesUsed: null,
    parameters: [],
    parametersError: null,
  };
}

/** The register's answer for one key, or null. The whole platform's rows are read in one query and
 *  matched in memory: the register is a collector's own handful of kinds, and one round-trip per
 *  rung of the ladder would be up to a dozen for a deep area tree. */
async function lookupLesson(
  platformId: string,
  collectionId: string,
  keyView: AllegroCategoryKeyView
): Promise<{
  lesson: MatchableLesson & { categoryName: string | null; categoryPath: string | null };
  tier: { relaxed: CategoryKeyAxis[] };
} | null> {
  // A key that asks nothing would match every row ever recorded, which is a coin toss rather than a
  // suggestion. Allegro's own guess is the honest answer there.
  if (isEmptyCategoryKey(keyView.key)) return null;

  const tree = await loadAreaTree(collectionId);
  const tiers = categoryLookupTiers(keyView.key, tree.pathOf(keyView.key.areaId), (areaId) =>
    tree.descendantsOf(areaId)
  );

  const rows = await prisma.allegroCategoryLesson.findMany({
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

  const matchable = rows.map((row) => ({ ...row, lastUsedAt: row.lastUsedAt.getTime() }));
  const picked = pickLessonForTiers(matchable, tiers);
  if (!picked) return null;

  const lesson = matchable.find((row) => row.id === picked.lesson.id);
  return lesson ? { lesson, tier: picked.tier } : null;
}

/** The key parts a rung still asked about, as words — "Poland · 1935 · used". */
function matchedPartNames(keyView: AllegroCategoryKeyView, relaxed: CategoryKeyAxis[]): string[] {
  const parts: string[] = [];
  if (keyView.areaName && !relaxed.includes("area")) parts.push(keyView.areaName);
  if (keyView.key.issuedYear !== null && !relaxed.includes("year")) {
    parts.push(String(keyView.key.issuedYear));
  }
  if (keyView.conditionName) parts.push(keyView.conditionName);
  if (keyView.subtypeName && !relaxed.includes("subtype")) parts.push(keyView.subtypeName);
  return parts;
}

/** Allegro's own suggestion from the listing title. Null on anything that goes wrong, including a
 *  connection that is down: this is the fallback, and a fallback that throws takes the manual pick
 *  down with it. */
async function guessFromTitle(
  ownerId: string,
  collectionId: string,
  offerId: string
): Promise<AllegroCategory | null> {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, collectionId },
    select: { name: true },
  });
  const title = offer?.name?.trim();
  if (!title) return null;
  try {
    const token = await getAllegroAccessToken(ownerId, collectionId);
    const matches = await matchAllegroCategories({ ...token, name: title });
    // Allegro's first answer is its best one, and a non-leaf cannot be published into.
    return matches.find((category) => category.leaf) ?? matches[0] ?? null;
  } catch {
    return null;
  }
}

/** Fill a suggestion's parameters in from Allegro and the second register. A connection that is down
 *  leaves the suggestion standing with an explanation — the category came out of this app's own
 *  register and is still worth showing. */
async function withParameters(
  ownerId: string,
  collectionId: string,
  suggestion: AllegroCategorySuggestion
): Promise<AllegroCategorySuggestion> {
  if (!suggestion.categoryId) return suggestion;
  try {
    const form = await getAllegroCategoryForm(ownerId, collectionId, suggestion.categoryId);
    return { ...suggestion, parameters: form.parameters };
  } catch (err) {
    return {
      ...suggestion,
      parametersError:
        err instanceof Error ? err.message : "This category's parameters could not be read.",
    };
  }
}

// ---------------------------------------------------------------------------
// Browsing the tree and reading a category's form
// ---------------------------------------------------------------------------

/** One category's parameters with what the register recalls for each, and the breadcrumb naming the
 *  category itself. */
export interface AllegroCategoryForm {
  categoryId: string;
  categoryName: string | null;
  categoryPath: string | null;
  parameters: AllegroCategoryParameterPrefill[];
}

/** The children of one category, or the top of the tree — what the picker walks down to a leaf. */
export async function browseAllegroCategories(
  ownerId: string,
  collectionId: string,
  parentId: string | null
): Promise<AllegroCategory[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const token = await getAllegroAccessToken(ownerId, collectionId);
  return listAllegroCategories({ ...token, parentId });
}

/** A category's breadcrumb, walked up from the node itself — `Kolekcje > Filatelistyka > Znaczki`.
 *  Stored beside a learned row as a display snapshot, so the panel can name a category without a
 *  live call. */
async function categoryPath(
  token: { sandbox: boolean; accessToken: string; userAgent: string },
  categoryId: string
): Promise<{ name: string | null; path: string | null }> {
  const names: string[] = [];
  let current: string | null = categoryId;
  let name: string | null = null;
  // Allegro's tree is a handful of levels deep; the bound is a guard against a parent chain that
  // never terminates, not an expected case.
  for (let depth = 0; current && depth < 12; depth += 1) {
    const category: AllegroCategory | null = await getAllegroCategory({ ...token, categoryId: current });
    if (!category) break;
    if (depth === 0) name = category.name;
    names.unshift(category.name);
    current = category.parentId;
  }
  return { name, path: names.length > 0 ? names.join(" > ") : null };
}

/**
 * One category's parameters, with the value last answered for each.
 *
 * Read live every time (ADR-0026 §1): what a category *asks* is Allegro's and changes when Allegro
 * changes it, and the only thing worth remembering is what the collector answered — keyed by
 * parameter, so a category that gains a field costs one blank rather than a stale form.
 */
export async function getAllegroCategoryForm(
  ownerId: string,
  collectionId: string,
  categoryId: string
): Promise<AllegroCategoryForm> {
  await assertCollectionOwner(ownerId, collectionId);
  const token = await getAllegroAccessToken(ownerId, collectionId);
  const platform = await allegroPlatformOf(collectionId);

  const [parameters, named, remembered] = await Promise.all([
    listAllegroCategoryParameters({ ...token, categoryId }),
    categoryPath(token, categoryId),
    platform
      ? prisma.allegroCategoryParameterMemory.findMany({
          where: { platformId: platform.id, categoryId },
          select: { parameterId: true, value: true, timesUsed: true },
        })
      : Promise.resolve([]),
  ]);

  const memory = new Map(remembered.map((row) => [row.parameterId, row]));
  return {
    categoryId,
    categoryName: named.name,
    categoryPath: named.path,
    // **Every** parameter, offer-section and product-section alike, each carrying its own
    // `describesProduct` flag.
    //
    // The two sections are not the same question and are not filtered here. Allegro's own sale form —
    // which the Assistant fills (#493) — asks for both, and the collector answers both; it is only
    // `POST /sale/product-offers` that refuses a product parameter among the offer's own
    // (`ParameterCategoryException`), because there it belongs inside `productSet[].product.parameters`
    // and matching a stamp to Allegro's product catalog is not something this app does.
    //
    // So the restriction belongs to the **request that has it**, and is applied when the API body is
    // assembled (ADR-0027 §2). Filtering at this read instead — which is what an earlier pass did —
    // silently stopped the collector being asked for values the other listing path needs.
    parameters: parameters.map((parameter) => {
      const row = memory.get(parameter.id);
      const recalled = row ? readParameterValue(row.value) : null;
      return { parameter, recalled, timesUsed: recalled ? (row?.timesUsed ?? null) : null };
    }),
  };
}

// ---------------------------------------------------------------------------
// Recording — the call #477 makes on a listing Allegro accepted
// ---------------------------------------------------------------------------

/** What a published listing teaches. */
export interface AllegroCategoryLessonInput {
  categoryId: string;
  categoryName?: string | null;
  categoryPath?: string | null;
  /** The parameter values the listing actually went out with, keyed by Allegro's parameter id. */
  parameters?: { parameterId: string; parameterName?: string | null; value: AllegroParameterValue }[];
}

/**
 * Record what one offer was published as — **both** registers, and only on a success.
 *
 * A refused publish teaches nothing: a category Allegro rejected is precisely the association that
 * must not be learned. Correcting a suggestion and publishing again is itself a lesson, and the newer
 * choice wins over the older one — which is why the key row is an upsert that overwrites the category
 * and bumps `timesUsed` rather than a second row beside the first.
 *
 * Called by #477 after Allegro answered 201 (or after the operation a 202 started has finished).
 * Nothing else calls it, and it publishes nothing itself.
 */
export async function recordAllegroCategoryLesson(
  collectionId: string,
  offerId: string,
  input: AllegroCategoryLessonInput
): Promise<void> {
  const platform = await requireAllegroPlatform(collectionId);
  const keyView = await getAllegroCategoryKeyForOffer(collectionId, offerId);
  if (!keyView) throw new Error("Offer not found");

  const categoryName = input.categoryName?.trim() || null;
  const categoryPath = input.categoryPath?.trim() || null;

  await prisma.$transaction(async (tx) => {
    // A key that asks nothing is not worth recording: it would answer every future lookup with
    // whatever was published last, which is the one thing a suggestion must never do.
    if (!isEmptyCategoryKey(keyView.key)) {
      const where = {
        platformId: platform.id,
        areaId: keyView.key.areaId,
        issuedYear: keyView.key.issuedYear,
        conditionId: keyView.key.conditionId,
        subtypeId: keyView.key.subtypeId,
      };
      // Nulls are values of this key, and Prisma cannot address a `NULLS NOT DISTINCT` index in an
      // `upsert`'s `where` — so the row is found first and the index stays the guard against the
      // race, which is one collector publishing two listings at once and is not a real one.
      const existing = await tx.allegroCategoryLesson.findFirst({ where, select: { id: true } });
      if (existing) {
        await tx.allegroCategoryLesson.update({
          where: { id: existing.id },
          data: {
            categoryId: input.categoryId,
            categoryName,
            categoryPath,
            timesUsed: { increment: 1 },
            lastUsedAt: new Date(),
          },
        });
      } else {
        await tx.allegroCategoryLesson.create({
          data: {
            collectionId,
            ...where,
            categoryId: input.categoryId,
            categoryName,
            categoryPath,
          },
        });
      }
    }

    for (const answered of input.parameters ?? []) {
      // A blank answer teaches nothing about the next listing, and storing one would mean recalling
      // an empty value over a good one the collector gave earlier.
      if (isBlankParameterValue(answered.value)) continue;
      await tx.allegroCategoryParameterMemory.upsert({
        where: {
          platformId_categoryId_parameterId: {
            platformId: platform.id,
            categoryId: input.categoryId,
            parameterId: answered.parameterId,
          },
        },
        create: {
          collectionId,
          platformId: platform.id,
          categoryId: input.categoryId,
          parameterId: answered.parameterId,
          parameterName: answered.parameterName?.trim() || null,
          value: answered.value as object,
        },
        update: {
          parameterName: answered.parameterName?.trim() || null,
          value: answered.value as object,
          timesUsed: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// What Settings → Allegro shows, and what it can change
// ---------------------------------------------------------------------------

/** One learned association, as the panel reads it. */
export interface AllegroCategoryLessonRow {
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

/** One remembered parameter answer, as the panel reads it. */
export interface AllegroCategoryParameterRow {
  id: string;
  categoryId: string;
  parameterId: string;
  parameterName: string | null;
  /** The answer in words, so the panel can show what is remembered without rendering a form. */
  value: string;
  timesUsed: number;
  lastUsedAt: string;
}

export interface AllegroLearnedCategoryList {
  platformId: string | null;
  platformName: string | null;
  lessons: AllegroCategoryLessonRow[];
  parameters: AllegroCategoryParameterRow[];
}

/** A remembered value as one line of text. Ids are shown as ids where nothing names them: this is a
 *  register of what was sent, and a screen that hides an id the collector cannot recognise is a
 *  screen they cannot use to work out which row to delete. */
function describeParameterValue(value: AllegroParameterValue | null): string {
  if (!value) return "—";
  if (value.values && value.values.length > 0) return value.values.join(", ");
  if (value.valuesIds && value.valuesIds.length > 0) return value.valuesIds.join(", ");
  const range = value.rangeValue;
  if (range) return `${range.from ?? "…"} – ${range.to ?? "…"}`;
  return "—";
}

/**
 * Everything the collection has learned about Allegro's categories.
 *
 * Both registers, because both are things the collector may need to correct: a wrong association
 * learned once must never be a thing that can only be fixed by publishing something wrong again
 * (ADR-0026 §6).
 */
export async function listAllegroLearnedCategories(
  ownerId: string,
  collectionId: string
): Promise<AllegroLearnedCategoryList> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await allegroPlatformOf(collectionId);
  if (!platform) {
    return { platformId: null, platformName: null, lessons: [], parameters: [] };
  }

  const [lessons, parameters] = await Promise.all([
    prisma.allegroCategoryLesson.findMany({
      where: { platformId: platform.id },
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
    }),
    prisma.allegroCategoryParameterMemory.findMany({
      where: { platformId: platform.id },
      orderBy: [{ categoryId: "asc" }, { parameterName: "asc" }],
      select: {
        id: true,
        categoryId: true,
        parameterId: true,
        parameterName: true,
        value: true,
        timesUsed: true,
        lastUsedAt: true,
      },
    }),
  ]);

  return {
    platformId: platform.id,
    platformName: platform.name,
    lessons: lessons.map((row) => ({
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
    })),
    parameters: parameters.map((row) => ({
      id: row.id,
      categoryId: row.categoryId,
      parameterId: row.parameterId,
      parameterName: row.parameterName,
      value: describeParameterValue(readParameterValue(row.value)),
      timesUsed: row.timesUsed,
      lastUsedAt: row.lastUsedAt.toISOString(),
    })),
  };
}

async function assertLessonOwner(ownerId: string, lessonId: string): Promise<{ collectionId: string }> {
  const row = await prisma.allegroCategoryLesson.findUnique({
    where: { id: lessonId },
    select: { collectionId: true },
  });
  if (!row) throw new Error("That learned category is no longer there.");
  await assertCollectionOwner(ownerId, row.collectionId);
  return row;
}

/**
 * Point one learned association at a different category.
 *
 * The direct correction, and the reason the panel is not delete-only: a collector who spots a wrong
 * association should be able to say what the right one is, rather than delete the row and wait for
 * the next publish to teach it again. The count is **reset**, not kept — what was recorded seven
 * times was the old category, and carrying its support over to a category nothing has ever been
 * published into would be this app asserting something it has never seen.
 */
export async function updateAllegroCategoryLesson(
  ownerId: string,
  lessonId: string,
  category: { categoryId: string; categoryName?: string | null; categoryPath?: string | null }
): Promise<void> {
  await assertLessonOwner(ownerId, lessonId);
  const categoryId = category.categoryId.trim();
  if (!categoryId) throw new Error("A learned association needs a category.");
  await prisma.allegroCategoryLesson.update({
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

/** Forget one association. Nothing else changes: listings already published keep the category they
 *  went out with, Allegro holding those from the moment they were sent. */
export async function deleteAllegroCategoryLesson(ownerId: string, lessonId: string): Promise<void> {
  await assertLessonOwner(ownerId, lessonId);
  await prisma.allegroCategoryLesson.delete({ where: { id: lessonId } });
}

/** Forget one remembered parameter answer. The next listing in that category asks for it again,
 *  which is the whole of the correction — there is no wrong value to replace, only one to stop
 *  recalling. */
export async function deleteAllegroCategoryParameterMemory(
  ownerId: string,
  memoryId: string
): Promise<void> {
  const row = await prisma.allegroCategoryParameterMemory.findUnique({
    where: { id: memoryId },
    select: { collectionId: true },
  });
  if (!row) throw new Error("That remembered value is no longer there.");
  await assertCollectionOwner(ownerId, row.collectionId);
  await prisma.allegroCategoryParameterMemory.delete({ where: { id: memoryId } });
}
