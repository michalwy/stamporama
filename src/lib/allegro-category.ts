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
  type AllegroParameterValue,
  type CategorySuggestionSource,
  explainCategoryMatch,
  isBlankParameterValue,
  readParameterValue,
} from "./allegro-category-rules";
import type { CategoryKeyAxis } from "./platform-category-rules";
import {
  type PlatformCategoryKeyView,
  type PlatformCategoryLessonRow,
  assertCollectionOwner,
  deletePlatformCategoryLesson,
  getPlatformCategoryKeyForOffer,
  listPlatformCategoryLessons,
  lookupPlatformCategoryLesson,
  matchedPartNames,
  recordPlatformCategoryLesson,
  updatePlatformCategoryLesson,
} from "./platform-category";

// Allegro categories are **learned, not configured** (#488; ADR-0026) — the stamp-side half of what a
// listing needs, beside #486's account-side half.
//
// The shape this module exists to guarantee: finishing an offer records what a kind of stamp was
// listed as, and the next offer of that kind opens with it already filled in. Two registers,
// deliberately (ADR-0026 §1): a key → category, and a category's parameter → the value last answered
// for it.
//
// Since #609 the **first** register is not Allegro's own. It lives in `platform-category.ts` and
// Delcampe reads the same table through the same ladder — it was always keyed per (collection,
// platform), and two copies of the relaxation logic would drift on the first correction. What is
// still here is everything Allegro adds on top: the parameter register, which Delcampe has no
// equivalent of, the platform lookup, and Allegro's own guess at a listing title. This module
// therefore makes no judgement about *keys* at all.
//
// Nothing here publishes anything. #494 is the consumer, and what it asks of this module is
// {@link suggestAllegroCategoryForOffer} while the offer is being prepared and
// {@link recordAllegroCategoryLesson} once the collector has finished preparing it.

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
  key: PlatformCategoryKeyView;
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
  const keyView = await getPlatformCategoryKeyForOffer(collectionId, offerId);
  if (!keyView) return null;

  const platform = await allegroPlatformOf(collectionId);
  const learned = platform
    ? await lookupPlatformCategoryLesson(collectionId, platform.id, keyView)
    : null;

  if (learned) {
    return withParameters(ownerId, collectionId, {
      key: keyView,
      source: "learned",
      categoryId: learned.categoryId,
      categoryName: learned.categoryName,
      categoryPath: learned.categoryPath,
      matchedOn: explainCategoryMatch({
        source: "learned",
        matchedOn: matchedPartNames(keyView, learned.relaxed),
        relaxed: learned.relaxed,
        timesUsed: learned.timesUsed,
      }),
      relaxed: learned.relaxed,
      timesUsed: learned.timesUsed,
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
    return {
      ...suggestion,
      // The breadcrumb, where the suggestion arrived without one — which is every guess, since
      // `GET /sale/matching-categories` answers an id and a **leaf name**. On Allegro's stamp tree a
      // leaf is routinely called `2011 - 2020`, which says nothing at all on its own: the path is
      // what makes it a category rather than a decade. It costs nothing here, this read having
      // walked the tree for its own breadcrumb already.
      //
      // Only where it is missing: a *learned* row carries the snapshot recorded when it was taught,
      // and that snapshot is deliberately what the screen shows (ADR-0026 §1).
      categoryName: suggestion.categoryName ?? form.categoryName,
      categoryPath: suggestion.categoryPath ?? form.categoryPath,
      parameters: form.parameters,
    };
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
// Recording — the call made on an offer the collector has finished preparing
// ---------------------------------------------------------------------------

/** What a finished offer teaches. */
export interface AllegroCategoryLessonInput {
  categoryId: string;
  categoryName?: string | null;
  categoryPath?: string | null;
  /** The parameter values the listing actually went out with, keyed by Allegro's parameter id. */
  parameters?: { parameterId: string; parameterName?: string | null; value: AllegroParameterValue }[];
}

/**
 * Record what one offer the collector has finished preparing was categorised as — **both**
 * registers.
 *
 * Correcting a suggestion and finishing the offer again is itself a lesson, and the newer choice
 * wins over the older one — which is why the key row is an upsert that overwrites the category and
 * bumps `timesUsed` rather than a second row beside the first.
 *
 * The key half is `platform-category.ts`'s since #609, and only the parameter half is written here.
 * They are no longer one transaction, and deliberately: they are two registers (ADR-0026 §1), the
 * unique index is what guards the key row's race, and neither is a prerequisite of the other — a
 * parameter answer that failed to store leaves a perfectly good category association standing, which
 * is a better outcome than losing both.
 *
 * Called from `learnAllegroCategoryFromReadyOffer` on the move to `ready` (#494). Nothing else calls
 * it, and it publishes nothing itself.
 */
export async function recordAllegroCategoryLesson(
  collectionId: string,
  offerId: string,
  input: AllegroCategoryLessonInput
): Promise<void> {
  const platform = await requireAllegroPlatform(collectionId);
  const keyView = await getPlatformCategoryKeyForOffer(collectionId, offerId);
  if (!keyView) throw new Error("Offer not found");

  await recordPlatformCategoryLesson(collectionId, platform.id, keyView.key, {
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    categoryPath: input.categoryPath,
  });

  for (const answered of input.parameters ?? []) {
    // A blank answer teaches nothing about the next listing, and storing one would mean recalling an
    // empty value over a good one the collector gave earlier.
    if (isBlankParameterValue(answered.value)) continue;
    await prisma.allegroCategoryParameterMemory.upsert({
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
}

// ---------------------------------------------------------------------------
// What Settings → Allegro shows, and what it can change
// ---------------------------------------------------------------------------

/** One learned association, as the panel reads it — the shared register's own row (#609), re-exported
 *  so the Allegro panel keeps naming the type it renders rather than reaching past this module. */
export type AllegroCategoryLessonRow = PlatformCategoryLessonRow;

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
    listPlatformCategoryLessons(platform.id),
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
    lessons,
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

/**
 * Point one learned association at a different category, and forget one outright.
 *
 * Both are the shared register's since #609 and are re-exported under the names Settings → Allegro
 * already calls them by: the correction is about a key, not about Allegro, and a second copy of it
 * would be one more thing to keep in step.
 *
 * The re-point is the reason the panel is not delete-only — a collector who spots a wrong
 * association should be able to say what the right one is rather than delete the row and wait for
 * the next offer to teach it again — and it **resets** the count, since what was recorded seven times
 * was the old category.
 */
export const updateAllegroCategoryLesson = updatePlatformCategoryLesson;

/** Forget one association. Listings already published keep the category they went out with. */
export const deleteAllegroCategoryLesson = deletePlatformCategoryLesson;

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
