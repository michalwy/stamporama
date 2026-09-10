import "server-only";
import { prisma } from "../../db";
import { notFound } from "../errors";
import type {
  CatalogVocabularyEntry,
  CollectionVocabulary,
  PlatformVocabularyEntry,
  SubtypeVocabularyEntry,
  TreeVocabularyEntry,
  VocabularyEntry,
} from "../vocabulary";
import type { Operation, OperationContext } from "../types";

// `GET /api/v1/vocabulary` — the collection's whole configurable vocabulary, in one call (#708).
//
// **The shape matters more than the endpoint does.** An agent fetches this once at the start of a
// session and holds it for the whole of it, so every field here is paid for in the agent's context
// window on every subsequent turn — which is the binding constraint on this surface (#706). That is
// why this reads its own narrow columns instead of calling the screen readers beside it.
//
// **On not reusing `getStampConditions` and friends, because that is the decision to argue with.**
// Those functions exist and this could call eight of them. It does not, for two reasons and neither
// is performance alone. They are **screen-shaped**: `getLocations` counts children and copies per
// row, `readCollectionAreas` joins every area's books and vendors and resolves a prefix per pair,
// `getCatalogTree` nests every edition year under every book. An agent needs none of that, and a
// response shaped like a screen's payload is #706's named example of how to spend an agent's context
// on nothing. And each of them re-checks collection ownership, which `resolveAgentApiCaller` has
// already established from the token — `readCollectionAreas` exists in `areas.ts` precisely to skip
// that check for a caller that owns it, so the precedent is already in the tree.
//
// **This is not a second source of truth and could not become one**: it reads the same tables and
// selects a strict subset of the same columns, and it derives nothing whatsoever. Every figure the
// screen readers compute — the counts, the resolved prefixes — is a derivation this file does not
// make. Renaming a condition moves both paths together because both read `stamp_condition.name`.
//
// **This is the only server-side module #708 adds.** The response shape, the resolver and its two
// refusals are all pure, in `../vocabulary.ts`, where `pnpm test:unit` can hold them
// (`agent-api.md`, *The module layout is the Prisma-free split*). The import direction is one-way:
// `registry.ts` imports this, and this imports the types and helpers beside it and never the
// registry (#658).

/**
 * The label to publish beside a canonical name, or `undefined` when there is nothing to say.
 *
 * **Omitted when it is absent or identical to the name**, which is the common case by a wide margin
 * — a collection with no translations pays nothing at all for this field. That is deliberate: an
 * agent holds this response for a session, and a `label` echoing every `name` would double the size
 * of every vocabulary to say nothing.
 */
function labelFor(name: string, ...candidates: readonly (string | null | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed !== name) return trimmed;
  }
  return undefined;
}

/** Drop the `label` key entirely when there is none, rather than sending `"label": null`. */
function entry(
  id: string,
  name: string,
  abbreviation: string | null,
  label: string | undefined
): VocabularyEntry {
  return {
    id,
    name,
    ...(abbreviation && abbreviation.trim() !== "" ? { abbreviation: abbreviation.trim() } : {}),
    ...(label ? { label } : {}),
  };
}

/**
 * Read the collection's vocabulary.
 *
 * One `Promise.all`, because these are nine independent reads and nothing here depends on anything
 * else here — except the collection row itself, which has to come first: it carries the
 * `defaultLanguage` every translation is selected by, and it is where ownership is proved.
 */
export async function readCollectionVocabulary(
  context: OperationContext
): Promise<CollectionVocabulary> {
  const { collectionId, ownerId } = context;

  // Scoped by owner as well as by id, so the ownership check costs nothing extra. The token is
  // pinned to one collection (#706), so this can only fail if the collection was deleted between
  // the token being minted and now — which is a `not_found`, not a 500.
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { baseCurrency: true, defaultLanguage: true },
  });
  if (!collection) {
    throw notFound(
      "This token's collection no longer exists. Ask the collector for a token on a live collection."
    );
  }
  const language = collection.defaultLanguage;

  const [
    conditions,
    formats,
    certificateStatuses,
    subtypes,
    areas,
    locations,
    vendors,
    catalogs,
    platforms,
  ] = await Promise.all([
      prisma.stampCondition.findMany({
        where: { collectionId },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          abbreviation: true,
          translations: { where: { language }, select: { name: true } },
        },
      }),
      prisma.stampFormat.findMany({
        where: { collectionId },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          abbreviation: true,
          translations: { where: { language }, select: { name: true } },
        },
      }),
      prisma.certificateStatus.findMany({
        where: { collectionId },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          abbreviation: true,
          translations: { where: { language }, select: { name: true } },
        },
      }),
      prisma.stampSubtype.findMany({
        where: { collectionId },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          actsAsVariant: true,
          isDefault: true,
          translations: { where: { language }, select: { name: true } },
        },
      }),
      prisma.collectionArea.findMany({
        where: { collectionId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          parentId: true,
          assignable: true,
          titleName: true,
          translations: { where: { language }, select: { titleName: true } },
        },
      }),
      prisma.location.findMany({
        where: { collectionId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, parentId: true, assignable: true },
      }),
      prisma.catalogVendor.findMany({
        where: { collectionId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, abbreviation: true },
      }),
      prisma.catalogName.findMany({
        where: { vendor: { collectionId } },
        orderBy: [{ vendor: { name: "asc" } }, { name: "asc" }],
        select: { id: true, name: true, vendorId: true, currency: true },
      }),
      // **`platform: true` is the whole of the filter and it is load-bearing.** `Contact` is one
      // table for buyers, sellers, exchange partners, auction houses and platforms, and it carries
      // `email`, `phone`, `fullName` and `notes`. A query without this flag would hand an agent a
      // trading partner's personal details to hold for a whole session.
      //
      // **Three guards, and they answer different questions — measured rather than assumed.** This
      // `where` decides *whose rows*; the `select` decides *which columns leave the database*; the
      // mapper below decides *what reaches the agent*, naming each field rather than spreading the
      // row. **Only the last of those actually protects the response**: dropping this filter and
      // adding `email` to the `select` together still leaked nothing, because the mapper copies
      // neither. So the mapper is the guard and these two are depth behind it — do not "simplify"
      // it into a spread.
      prisma.contact.findMany({
        where: { collectionId, platform: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, platformCurrency: true },
      }),
    ]);

  return {
    baseCurrency: collection.baseCurrency,
    defaultLanguage: language,
    conditions: conditions.map((row) =>
      entry(row.id, row.name, row.abbreviation, labelFor(row.name, row.translations[0]?.name))
    ),
    formats: formats.map((row) =>
      entry(row.id, row.name, row.abbreviation, labelFor(row.name, row.translations[0]?.name))
    ),
    certificateStatuses: certificateStatuses.map((row) =>
      entry(row.id, row.name, row.abbreviation, labelFor(row.name, row.translations[0]?.name))
    ),
    subtypes: subtypes.map((row): SubtypeVocabularyEntry => ({
      ...entry(row.id, row.name, null, labelFor(row.name, row.translations[0]?.name)),
      actsAsVariant: row.actsAsVariant,
      isDefault: row.isDefault,
    })),
    // An area's public name is `titleName` — the one used in listing titles — and it is genuinely
    // different from `name`, which is an internal grouping label ("Second Republic" against
    // "Poland"). So the label falls back through the translation to it (#210, #293).
    areas: areas.map((row): TreeVocabularyEntry => ({
      ...entry(
        row.id,
        row.name,
        null,
        labelFor(row.name, row.translations[0]?.titleName, row.titleName)
      ),
      parentId: row.parentId,
      assignable: row.assignable,
    })),
    locations: locations.map((row): TreeVocabularyEntry => ({
      ...entry(row.id, row.name, null, undefined),
      parentId: row.parentId,
      assignable: row.assignable,
    })),
    catalogVendors: vendors.map((row) => entry(row.id, row.name, row.abbreviation, undefined)),
    catalogs: catalogs.map((row): CatalogVocabularyEntry => ({
      ...entry(row.id, row.name, null, undefined),
      vendorId: row.vendorId,
      currency: row.currency,
    })),
    platforms: platforms.map((row): PlatformVocabularyEntry => ({
      ...entry(row.id, row.name, null, undefined),
      currency: row.platformCurrency,
    })),
  };
}

/**
 * The registry entry.
 *
 * **`writes: false`, and it reads a `read` token**: nothing here changes anything, and writing to
 * the vocabulary is out of scope for the whole agent surface — an agent works within the collector's
 * configured terms, and changing them is a settings decision that stays in the UI (#708).
 *
 * **`kind: "object"` rather than `"list"`**, which is the right call and worth saying why: a list
 * gets `limit` and `cursor` appended and states a `total`, and paginating a vocabulary would be
 * exactly wrong — the agent needs all of it or none of it, and a half-fetched vocabulary is a
 * resolver that fails on values the collection really has.
 *
 * **No parameters at all.** The collection comes from the token, never from a path or a query
 * (#706), so there is nothing left to ask for.
 */
export const getCollectionVocabularyOperation: Operation = {
  name: "get_collection_vocabulary",
  method: "GET",
  path: "/vocabulary",
  description:
    "Fetch every configurable vocabulary in this collection — conditions, formats, certificate statuses, subtypes, areas, locations, catalog vendors, catalogs and platforms — with the id and the collection's own name for each. Call this once at the start of a session and keep the result: every other operation that takes a condition, an area, a location and so on accepts either the id or the name from here.",
  writes: false,
  parameters: [],
  result: {
    kind: "object",
    description:
      "The collection's vocabularies, each as a flat array of `{id, name}` with `abbreviation` and `label` where the collection has them. `areas` and `locations` are trees, flattened, each row carrying `parentId` and `assignable`. `catalogs` carry `vendorId`, which joins to `catalogVendors`. `platforms` carry the `currency` an offer routed there is locked to. `baseCurrency` is the currency every collection-level figure is stated in.",
  },
  handler: async (context) => readCollectionVocabulary(context),
};
