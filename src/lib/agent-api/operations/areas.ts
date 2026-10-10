import "server-only";
import { prisma } from "../../db";
import { buildAreaPath } from "../../area-path";
import { resolveEffectivePrimaryCatalogNameId } from "../../area-inheritance";
import { effectiveVendorsForArea } from "../../area-vendor";
import {
  createCollectionArea,
  readCollectionAreas,
  reorderCollectionAreas,
  syncAreaCatalogBooks,
  syncAreaVendors,
  updateCollectionArea,
  type AreaVendorInput,
  type CollectionAreaData,
} from "../../areas";
import { getCollectionTranslationContext } from "../../contacts";
import { moveIssueToArea } from "../../issues";
import type { TranslationValueMap } from "../../translations";
import {
  agentArea,
  areaSubtree,
  areaTreeOrder,
  areaUnderItself,
  groupingOnlyHoldsMaterial,
  leadingNotKept,
  noValuingBook,
  notSiblings,
  parseCatalogueEntries,
  resolvedCatalogues,
  sameResolvedCatalogues,
  siblingGroups,
  valuingBookNotAttached,
  NO_PREFIX,
  type AgentArea,
  type AgentAreaResolvedCatalogues,
  type AreaNames,
} from "../area-reads";
import { checkTranslationLanguage, parseTranslatedNames } from "../catalog-edits";
import { invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow, type ListResponse } from "../list";
import { optionalBoolean, optionalString, requiredString, stringList } from "../params";
import { resolveVocabularyValue, type VocabularyEntry } from "../vocabulary";
import { normalizeMarketCode, normalizeMarketList } from "../../market-anchoring";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// Areas through the agent API (#1539): read the tree, create an area under a parent, correct its
// names, title names and catalogue configuration, move it to another parent, put it in order among
// its siblings, and move an issue to another area — setting up a collecting field from a catalogue's
// table of contents, and reorganising the tree.
//
// **Every write is the Areas screen's own.** `createCollectionArea`, `updateCollectionArea`,
// `syncAreaCatalogBooks` and `syncAreaVendors` are what the area form's two server actions call, in
// that order; `reorderCollectionAreas` is the tree's drag; `moveIssueToArea` is the Issues list's
// *Move to area*. The screen's rules hold because they are the domain's — an area under itself or
// its own sub-area, a grouping-only area holding issues, an area holding issues with no valuing book
// anywhere above it, an issue filed under a grouping-only area — and each is read here first only so
// its refusal is written for an agent: the domain throws plain `Error`s this surface does not relay.
// The form's own two choices are kept too: the leading catalogue is one of the area's catalogues and
// the valuing book one of its price books, and a price book's catalogue is among its catalogues.
//
// **This lifts #1438's catalogue boundary for areas only, and for exactly these operations.**
// Deleting an area stays out (`deleteCollectionArea`), and so does every other catalogue delete, move
// and reorder — `tests/unit/agent-api-operation-boundary.test.ts`.
//
// **A move says what it changed**: the area's new path, or the issue's new area, and the resolved
// catalogue configuration before and after for every area — or the issue — whose stamps now carry
// numbers differently, so an assistant can tell a move changed their prefixes.

const AREA_ID_PARAMETER: ParameterSpec = {
  name: "area_id",
  in: "path",
  type: "string",
  required: true,
  description: "The area's id, from `list_areas` or `get_collection_vocabulary`.",
};

// ── The collection's side ──────────────────────────────────────────────────

interface AreaWorld {
  areas: CollectionAreaData[];
  names: AreaNames;
  areaEntries: VocabularyEntry[];
  catalogueEntries: VocabularyEntry[];
  bookEntries: (VocabularyEntry & { vendorId: string })[];
  issueCounts: Map<string, number>;
  slug: string;
}

async function loadAreaWorld(context: OperationContext): Promise<AreaWorld> {
  const [header, areas, vendors, books, issueCounts] = await Promise.all([
    loadCollectionHeader(context),
    readCollectionAreas(context.collectionId),
    prisma.catalogVendor.findMany({
      where: { collectionId: context.collectionId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, abbreviation: true },
    }),
    prisma.catalogName.findMany({
      where: { vendor: { collectionId: context.collectionId } },
      orderBy: [{ vendor: { name: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, vendorId: true },
    }),
    prisma.issue.groupBy({
      by: ["collectionAreaId"],
      where: { collectionId: context.collectionId },
      _count: { _all: true },
    }),
  ]);
  return {
    areas,
    names: {
      catalogues: new Map(vendors.map((vendor) => [vendor.id, vendor.abbreviation])),
      books: new Map(books.map((book) => [book.id, book.name])),
    },
    areaEntries: areas.map((area) => ({ id: area.id, name: area.name, label: area.titleName ?? undefined })),
    catalogueEntries: vendors,
    bookEntries: books,
    issueCounts: new Map(issueCounts.map((row) => [row.collectionAreaId, row._count._all])),
    slug: header.slug,
  };
}

function describeArea(world: AreaWorld, areaId: string): AgentArea {
  const area = world.areas.find((row) => row.id === areaId)!;
  return agentArea(world.areas, area, world.names, {
    issueCount: world.issueCounts.get(area.id) ?? 0,
    path: collectionPath({ slug: world.slug, baseCurrency: "" }, "/areas"),
  });
}

function resolveArea(world: AreaWorld, value: string, parameter: string): CollectionAreaData {
  const id = resolveVocabularyValue(value, world.areaEntries, { vocabulary: "area", parameter });
  return world.areas.find((area) => area.id === id)!;
}

function loadArea(world: AreaWorld, areaId: string): CollectionAreaData {
  const area = world.areas.find((row) => row.id === areaId);
  if (!area) {
    throw notFound(`No area with id "${areaId}" is in this token's collection. Use \`list_areas\` to find the right id.`);
  }
  return area;
}

function pathOf(world: AreaWorld, areaId: string | null): string | null {
  return buildAreaPath(world.areas, areaId);
}

// ── Reading ────────────────────────────────────────────────────────────────

export async function listAreasFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentArea>> {
  const window = parseListWindow(params);
  const world = await loadAreaWorld(context);
  const under = optionalString(params, "under");
  const subtree = under === null ? null : areaSubtree(world.areas, resolveArea(world, under, "under").id);
  const ordered = areaTreeOrder(world.areas).filter((area) => subtree === null || subtree.has(area.id));
  const page = ordered.slice(window.offset, window.offset + window.limit);
  return listResponse(
    page.map((area) => describeArea(world, area.id)),
    ordered.length,
    window
  );
}

const AREA_ROW =
  "`areaId`, `name`, `areaPath` from the root, `parentId`, `position` among its siblings (1 is first), `assignable` (false on a grouping-only area), `description`, `titleName` and `translatedTitleNames` (the names listing titles use), `symbol` (usually its flag, for templates' `{areaSymbol}`; absent when unset, and never taken from a parent), `issueCount` and `stampCount` filed directly under it, `childCount`, `own` — the catalogue configuration it sets itself, in the spelling `create_area` and `update_area` take — `resolved`, what its issues actually get after walking up the tree: `leadingCatalogue`, every catalogue with the prefix it resolves to (`Mi·PL`), and `valuingBook` — and `anchorMarkets` (set on it) and `anchoringMarkets` (in force after walking up; absent means the collection's home market), the countries whose auction results its valuations rest on.";

export const listAreasOperation: Operation = {
  name: "list_areas",
  method: "GET",
  path: "/areas",
  description:
    "The collection's area tree — the countries, periods and territories issues and stamps are filed under — in the order the Areas screen reads it: each area followed by its sub-areas, siblings in the collector's order. Each row carries the catalogue configuration the area sets and the one its issues inherit. Read this before creating, editing or moving areas.",
  writes: false,
  parameters: [
    {
      name: "under",
      in: "query",
      type: "string",
      required: false,
      description: "Only this area and the areas under it, by name or id.",
    },
  ],
  result: { kind: "list", description: `Areas: ${AREA_ROW}` },
  handler: async (context, params) => listAreasFromParams(context, params),
};

// ── Creating and editing ───────────────────────────────────────────────────

/** The area's title names in other languages: `title_names` sets, `clear_title_names` removes. */
async function titleNameWrites(
  context: OperationContext,
  params: ParsedParams
): Promise<TranslationValueMap | undefined> {
  const names = stringList(params, "title_names");
  const cleared = stringList(params, "clear_title_names");
  if (names.length === 0 && cleared.length === 0) return undefined;
  const { titleLanguages, defaultLanguage } = await getCollectionTranslationContext(context.ownerId, context.collectionId);
  const set = parseTranslatedNames(names, "title_names", titleLanguages, defaultLanguage);
  const writes: TranslationValueMap = {};
  for (const [language, titleName] of set) writes[language] = { titleName };
  for (const raw of cleared) {
    const language = checkTranslationLanguage(raw, "clear_title_names", titleLanguages, defaultLanguage);
    if (set.has(language)) {
      throw invalidRequest(`The language "${language}" is both in "title_names" and in "clear_title_names". Send one or the other.`);
    }
    writes[language] = { titleName: null };
  }
  return writes;
}

/** The catalogue configuration an area will have after a write: what was sent, else what it has. */
interface CatalogueConfig {
  prefix: string | null;
  vendors: AreaVendorInput[];
  bookIds: string[];
  leadingVendorId: string | null;
  valuingBookId: string | null;
}

const CLEARABLE = [
  "description",
  "title_name",
  "prefix",
  "catalogues",
  "leading_catalogue",
  "price_books",
  "valuing_book",
  "anchor_markets",
  "symbol",
] as const;

function refuseSentAndCleared(field: string, sent: boolean, cleared: ReadonlySet<string>): void {
  if (sent && cleared.has(field)) {
    throw invalidRequest(`"${field}" is both sent and named in "clear". Send one or the other.`);
  }
}

/**
 * Read the catalogue half of a create or an edit against `current` (null on a create), applying the
 * area form's choices: a price book's catalogue is among the area's catalogues, the leading
 * catalogue is one of them, and the valuing book is one of its price books.
 */
function catalogueConfig(
  world: AreaWorld,
  params: ParsedParams,
  cleared: ReadonlySet<string>,
  current: CollectionAreaData | null
): CatalogueConfig {
  const prefixSent = optionalString(params, "prefix");
  const catalogueEntries = stringList(params, "catalogues");
  const bookRefs = stringList(params, "price_books");
  const leadingRef = optionalString(params, "leading_catalogue");
  const valuingRef = optionalString(params, "valuing_book");
  refuseSentAndCleared("prefix", prefixSent !== null, cleared);
  refuseSentAndCleared("catalogues", catalogueEntries.length > 0, cleared);
  refuseSentAndCleared("price_books", bookRefs.length > 0, cleared);
  refuseSentAndCleared("leading_catalogue", leadingRef !== null, cleared);
  refuseSentAndCleared("valuing_book", valuingRef !== null, cleared);

  const prefix = cleared.has("prefix") ? null : prefixSent !== null ? prefixSent.trim() || null : (current?.catalogPrefix ?? null);

  const bookIds = cleared.has("price_books")
    ? []
    : bookRefs.length > 0
      ? [...new Set(bookRefs.map((ref) => resolveVocabularyValue(ref, world.bookEntries, { vocabulary: "catalog", parameter: "price_books" })))]
      : (current?.catalogEntries.flatMap((entry) => (entry.catalogNameId ? [entry.catalogNameId] : [])) ?? []);

  const declared: AreaVendorInput[] = cleared.has("catalogues")
    ? []
    : catalogueEntries.length > 0
      ? parseCatalogueEntries(catalogueEntries, "catalogues").map((entry) => ({
          catalogVendorId: resolveVocabularyValue(entry.key, world.catalogueEntries, { vocabulary: "catalog vendor", parameter: "catalogues" }),
          areaPrefix: entry.areaPrefix,
        }))
      : (current?.vendorEntries.map((entry) => ({ catalogVendorId: entry.catalogVendorId, areaPrefix: entry.areaPrefix })) ?? []);
  // A price book's catalogue is among the area's catalogues, ticked with its prefix inherited — the
  // form lists it the moment the book is attached and submits it with the rest.
  const vendors = [...declared];
  for (const bookId of bookIds) {
    const vendorId = world.bookEntries.find((book) => book.id === bookId)!.vendorId;
    if (!vendors.some((vendor) => vendor.catalogVendorId === vendorId)) vendors.push({ catalogVendorId: vendorId, areaPrefix: null });
  }

  const vendorIds = new Set(vendors.map((vendor) => vendor.catalogVendorId));
  const ownCatalogueNames = world.catalogueEntries.filter((entry) => vendorIds.has(entry.id)).map((entry) => entry.abbreviation ?? entry.name);
  let leadingVendorId: string | null;
  if (cleared.has("leading_catalogue")) leadingVendorId = null;
  else if (leadingRef !== null) {
    leadingVendorId = resolveVocabularyValue(leadingRef, world.catalogueEntries, { vocabulary: "catalog vendor", parameter: "leading_catalogue" });
    if (!vendorIds.has(leadingVendorId)) throw leadingNotKept(leadingRef, ownCatalogueNames);
  } else {
    leadingVendorId = current?.primaryCatalogVendorId ?? null;
    // A catalogue taken off the area stops leading it, as the form's radio goes with its row.
    if (leadingVendorId !== null && !vendorIds.has(leadingVendorId)) leadingVendorId = null;
  }

  const bookNames = bookIds.map((id) => world.names.books.get(id) ?? id);
  let valuingBookId: string | null;
  if (cleared.has("valuing_book")) valuingBookId = null;
  else if (valuingRef !== null) {
    valuingBookId = resolveVocabularyValue(valuingRef, world.bookEntries, { vocabulary: "catalog", parameter: "valuing_book" });
    if (!bookIds.includes(valuingBookId)) throw valuingBookNotAttached(valuingRef, bookNames);
  } else {
    valuingBookId = current?.primaryCatalogNameId ?? null;
    if (valuingBookId !== null && !bookIds.includes(valuingBookId)) valuingBookId = null;
  }

  return { prefix, vendors, bookIds, leadingVendorId, valuingBookId };
}

function catalogueSent(params: ParsedParams, cleared: ReadonlySet<string>): boolean {
  return (
    stringList(params, "catalogues").length > 0 ||
    stringList(params, "price_books").length > 0 ||
    cleared.has("catalogues") ||
    cleared.has("price_books")
  );
}

/** The Areas screen's valuing-book rule, read before the write so its refusal names the area. */
function requireValuingBook(world: AreaWorld, name: string, assignable: boolean, valuingBookId: string | null, parentId: string | null): void {
  if (!assignable || valuingBookId !== null) return;
  if (parentId !== null && resolveEffectivePrimaryCatalogNameId(world.areas, parentId) !== null) return;
  throw noValuingBook(name, parentId === null ? null : (pathOf(world, parentId) ?? parentId));
}

function requireName(value: string, parameter: string): string {
  const name = value.trim();
  if (!name) throw invalidRequest(`"${parameter}" cannot be blank: an area needs a name.`);
  return name;
}

export async function createAreaFromParams(context: OperationContext, params: ParsedParams): Promise<AgentArea> {
  const world = await loadAreaWorld(context);
  const name = requireName(requiredString(params, "name"), "name");
  const parentRef = optionalString(params, "parent");
  const parent = parentRef === null ? null : resolveArea(world, parentRef, "parent");
  const assignable = optionalBoolean(params, "assignable") ?? true;
  const config = catalogueConfig(world, params, new Set(), null);
  requireValuingBook(world, name, assignable, config.valuingBookId, parent?.id ?? null);
  const translations = await titleNameWrites(context, params);

  const { id } = await createCollectionArea(context.ownerId, context.collectionId, {
    name,
    parentId: parent?.id ?? null,
    description: optionalString(params, "description")?.trim() || null,
    primaryCatalogNameId: config.valuingBookId,
    primaryCatalogVendorId: config.leadingVendorId,
    catalogPrefix: config.prefix,
    // The form fills the title name with the name and keeps it there until it is given its own.
    titleName: optionalString(params, "title_name")?.trim() || name,
    symbol: optionalString(params, "symbol")?.trim() || null,
    anchorMarkets: anchorMarketsParam(params, new Set()),
    translations,
    assignable,
  });
  await syncAreaCatalogBooks(context.ownerId, id, config.bookIds);
  await syncAreaVendors(context.ownerId, id, config.vendors);
  return describeArea(await loadAreaWorld(context), id);
}

const CATALOGUE_PARAMETERS: ParameterSpec[] = [
  {
    name: "prefix",
    in: "body",
    type: "string",
    required: false,
    description: "The area's prefix for every catalogue, `PL` — what its numbers are prefixed with, `Mi·PL 200`. Left out on a new area, the parent's applies.",
  },
  {
    name: "catalogues",
    in: "body",
    type: "string[]",
    required: false,
    description: `The catalogues this area's stamps carry numbers in, by abbreviation or name, replacing the list: \`"Mi"\` with the prefix inherited, \`"Mi: GG"\` for a prefix of its own for that catalogue here, \`"Mi: ${NO_PREFIX}"\` for none here. A price book's catalogue is always among them. An area that sets none inherits its parent's.`,
  },
  {
    name: "leading_catalogue",
    in: "body",
    type: "string",
    required: false,
    description: "The catalogue that leads numbering here — the stamps' sort order and leading label — one of the area's own catalogues. Left out, the parent's leads.",
  },
  {
    name: "price_books",
    in: "body",
    type: "string[]",
    required: false,
    description: "The catalogue volumes that price this area, by name or id from `get_collection_vocabulary`'s `catalogs`, replacing the list.",
  },
  {
    name: "valuing_book",
    in: "body",
    type: "string",
    required: false,
    description: "The one of its price books that gives a copy here its catalogue value. Left out, the parent's values it; an area holding issues needs one set on it or above it.",
  },
];

/**
 * The anchoring markets as sent (#1634): `undefined` when neither sent nor cleared, so the area keeps
 * what it has; `[]` when cleared, so it inherits again. Each must be a two-letter country code.
 */
function anchorMarketsParam(params: ParsedParams, cleared: ReadonlySet<string>): string[] | undefined {
  const sent = stringList(params, "anchor_markets");
  refuseSentAndCleared("anchor_markets", sent.length > 0, cleared);
  if (cleared.has("anchor_markets")) return [];
  if (sent.length === 0) return undefined;
  const codes = normalizeMarketList(sent);
  const bad = sent.filter((code) => normalizeMarketCode(code) === null);
  if (bad.length > 0) {
    throw invalidRequest(
      `"anchor_markets" takes two-letter country codes such as "DE"; ${bad.map((code) => `"${code}"`).join(", ")} is not one.`
    );
  }
  return codes;
}

const ANCHOR_MARKETS_PARAMETER: ParameterSpec = {
  name: "anchor_markets",
  in: "body",
  type: "string[]",
  required: false,
  description:
    'The markets whose auction results this area\'s market value and bid recommendations rest on, as two-letter country codes — `["DE", "AT"]` — replacing the list. Results from any other market are shown as hints and never counted. Left out, the parent\'s apply, and with none set above, the collection\'s home market.',
};

const SYMBOL_PARAMETER: ParameterSpec = {
  name: "symbol",
  in: "body",
  type: "string",
  required: false,
  description:
    "The area's symbol, usually its flag as an emoji — `🇵🇱` — for the `{areaSymbol}` placeholder in templates. The same in every language, and never taken from a parent: a sub-area without one prints nothing there.",
};

const TITLE_NAMES_PARAMETER: ParameterSpec = {
  name: "title_names",
  in: "body",
  type: "string[]",
  required: false,
  description:
    'The title name in other languages, one `"language: name"` entry each — `["de: Polen"]`. Only the languages this collection lists in are accepted, never its own, which is `title_name`.',
};

export const createAreaOperation: Operation = {
  name: "create_area",
  method: "POST",
  path: "/areas",
  description:
    "Create an area — a country, a period, a territory — at the end of its parent's sub-areas, the way the collector's Add area form does: its name, the title name listings use, and its catalogue configuration. Whatever it does not set it inherits from the areas above it. An area that holds issues needs a valuing book set on it or above it; a grouping-only area (`assignable: false`, such as `Europe`) holds sub-areas only and needs none. Nothing created here can be deleted through this API.",
  writes: true,
  parameters: [
    { name: "name", in: "body", type: "string", required: true, description: "The area's name in the collection's own language — `Poland`, `General Government`." },
    { name: "parent", in: "body", type: "string", required: false, description: "The area it goes under, by name or id. Left out, it is a top-level area." },
    { name: "assignable", in: "body", type: "boolean", required: false, description: "false for a grouping-only area that holds sub-areas and no issues. Defaults to true." },
    { name: "description", in: "body", type: "string", required: false, description: "A note the collector reads on the Areas screen." },
    { name: "title_name", in: "body", type: "string", required: false, description: "The name listing titles use for it. Defaults to `name`, as on the form." },
    TITLE_NAMES_PARAMETER,
    SYMBOL_PARAMETER,
    ...CATALOGUE_PARAMETERS,
    ANCHOR_MARKETS_PARAMETER,
  ],
  result: { kind: "object", description: "The area as `list_areas` states it." },
  handler: async (context, params) => createAreaFromParams(context, params),
};

export async function updateAreaFromParams(context: OperationContext, params: ParsedParams): Promise<AgentArea> {
  const world = await loadAreaWorld(context);
  const area = loadArea(world, requiredString(params, "area_id"));
  if (!Object.keys(params).some((key) => key !== "area_id" && params[key] !== undefined)) {
    throw invalidRequest('Nothing to change: send a field to set, "title_names", "clear_title_names" or "clear". `move_area` moves an area.');
  }
  const cleared = new Set(stringList(params, "clear"));
  const nameSent = optionalString(params, "name");
  const description = optionalString(params, "description");
  const titleName = optionalString(params, "title_name");
  const symbolSent = optionalString(params, "symbol");
  const assignableSent = optionalBoolean(params, "assignable");
  refuseSentAndCleared("description", description !== null, cleared);
  refuseSentAndCleared("title_name", titleName !== null, cleared);
  refuseSentAndCleared("symbol", symbolSent !== null, cleared);
  const name = nameSent === null ? area.name : requireName(nameSent, "name");
  const config = catalogueConfig(world, params, cleared, area);
  const translations = await titleNameWrites(context, params);

  const assignable = assignableSent ?? area.assignable;
  if (!assignable && area.assignable) {
    const issues = world.issueCounts.get(area.id) ?? 0;
    if (issues > 0 || area.stampCount > 0) throw groupingOnlyHoldsMaterial(area.name, issues, area.stampCount);
  }
  requireValuingBook(world, name, assignable, config.valuingBookId, area.parentId);

  // The form keeps the title name in step with the name while the two are equal (#210).
  const nextTitleName = cleared.has("title_name")
    ? null
    : titleName !== null
      ? titleName.trim() || null
      : nameSent !== null && area.titleName === area.name
        ? name
        : area.titleName;

  // `updateCollectionArea` writes every field whatever it is handed, so each is restated.
  await updateCollectionArea(context.ownerId, area.id, {
    name,
    parentId: area.parentId,
    description: cleared.has("description") ? null : description !== null ? description.trim() || null : area.description,
    primaryCatalogNameId: config.valuingBookId,
    primaryCatalogVendorId: config.leadingVendorId,
    catalogPrefix: config.prefix,
    anchorMarkets: anchorMarketsParam(params, cleared),
    titleName: nextTitleName,
    // Left out, the symbol stays as it is (#1740) — `updateCollectionArea` leaves an omitted one alone.
    symbol: cleared.has("symbol") ? null : symbolSent !== null ? symbolSent.trim() || null : undefined,
    translations,
    assignable,
  });
  if (catalogueSent(params, cleared)) {
    await syncAreaCatalogBooks(context.ownerId, area.id, config.bookIds);
    await syncAreaVendors(context.ownerId, area.id, config.vendors);
  }
  return describeArea(await loadAreaWorld(context), area.id);
}

export const updateAreaOperation: Operation = {
  name: "update_area",
  method: "PATCH",
  path: "/areas/{area_id}",
  description:
    "Correct an area — its name, title names, symbol, description, whether it is grouping-only, and its catalogue configuration — only what is sent changes, and every area and issue under it inherits the change. Renaming keeps the title name in step while it equals the name, as on the form. A list sent replaces the area's list. An area holding issues cannot become grouping-only. Nothing here deletes an area; `move_area` moves one and `set_area_order` orders them.",
  writes: true,
  parameters: [
    AREA_ID_PARAMETER,
    { name: "name", in: "body", type: "string", required: false, description: "The area's name in the collection's own language." },
    { name: "assignable", in: "body", type: "boolean", required: false, description: "false makes it grouping-only, refused while issues or stamps are filed directly under it." },
    { name: "description", in: "body", type: "string", required: false, description: "A note the collector reads on the Areas screen." },
    { name: "title_name", in: "body", type: "string", required: false, description: "The name listing titles use for it." },
    TITLE_NAMES_PARAMETER,
    {
      name: "clear_title_names",
      in: "body",
      type: "string[]",
      required: false,
      description: 'Languages whose title name to take off — `["de"]`. The title then reads in the collection\'s own language there.',
    },
    SYMBOL_PARAMETER,
    ...CATALOGUE_PARAMETERS,
    ANCHOR_MARKETS_PARAMETER,
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description:
        "Fields to empty, so the area inherits them from its parent: `title_name`, `prefix`, `catalogues`, `leading_catalogue`, `price_books`, `valuing_book`, `anchor_markets`, and `description`; `symbol` takes the symbol off, which nothing inherits.",
      values: [...CLEARABLE],
    },
  ],
  result: { kind: "object", description: "The area as `list_areas` now states it." },
  handler: async (context, params) => updateAreaFromParams(context, params),
};

// ── Moving and ordering ────────────────────────────────────────────────────

/** An area whose issues resolve their catalogues differently after a move. */
export interface AgentAreaCatalogueChange {
  readonly areaId: string;
  readonly areaPath: string;
  readonly issueCount: number;
  readonly before: AgentAreaResolvedCatalogues;
  readonly after: AgentAreaResolvedCatalogues;
}

export async function moveAreaFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{ area: AgentArea; previousPath: string; moved: boolean; catalogueChanges: AgentAreaCatalogueChange[] }> {
  const world = await loadAreaWorld(context);
  const area = loadArea(world, requiredString(params, "area_id"));
  const parentRef = optionalString(params, "parent");
  const topLevel = optionalBoolean(params, "top_level") === true;
  if ((parentRef === null) === !topLevel) {
    throw invalidRequest('Send either "parent", the area to move it under, or "top_level": true — one of them.');
  }
  const parent = parentRef === null ? null : resolveArea(world, parentRef, "parent");
  if (parent && areaSubtree(world.areas, area.id).has(parent.id)) {
    throw areaUnderItself(area.name, parent.name, parent.id === area.id);
  }
  const previousPath = pathOf(world, area.id) ?? area.name;
  const parentId = parent?.id ?? null;
  if (parentId === area.parentId) {
    return { area: describeArea(world, area.id), previousPath, moved: false, catalogueChanges: [] };
  }
  requireValuingBook(world, area.name, area.assignable, area.primaryCatalogNameId, parentId);

  const subtree = [...areaSubtree(world.areas, area.id)];
  const before = new Map(subtree.map((id) => [id, resolvedCatalogues(world.areas, id, world.names)]));
  // The form's edit with only the parent changed: every other field restated as it is.
  await updateCollectionArea(context.ownerId, area.id, {
    name: area.name,
    parentId,
    description: area.description,
    primaryCatalogNameId: area.primaryCatalogNameId,
    primaryCatalogVendorId: area.primaryCatalogVendorId,
    catalogPrefix: area.catalogPrefix,
    titleName: area.titleName,
    assignable: area.assignable,
  });
  const after = await loadAreaWorld(context);
  const catalogueChanges = areaTreeOrder(after.areas)
    .filter((row) => before.has(row.id))
    .flatMap((row) => {
      const was = before.get(row.id)!;
      const now = resolvedCatalogues(after.areas, row.id, after.names);
      return sameResolvedCatalogues(was, now)
        ? []
        : [{ areaId: row.id, areaPath: pathOf(after, row.id) ?? row.name, issueCount: after.issueCounts.get(row.id) ?? 0, before: was, after: now }];
    });
  return { area: describeArea(after, area.id), previousPath, moved: true, catalogueChanges };
}

export const moveAreaOperation: Operation = {
  name: "move_area",
  method: "POST",
  path: "/areas/{area_id}/move",
  description:
    "Move an area, with its sub-areas and the issues filed under them, to another parent or to the top level, as the parent picker on the collector's area form does; it goes to the end of its new siblings. Its issues then inherit their catalogue configuration from the new place, so the answer says which areas' issues now resolve their catalogues, prefixes or valuing book differently. An area cannot go under itself or one of its own sub-areas. An issue's own prefix, set on the issue, is kept either way.",
  writes: true,
  parameters: [
    AREA_ID_PARAMETER,
    { name: "parent", in: "body", type: "string", required: false, description: "The area to move it under, by name or id." },
    { name: "top_level", in: "body", type: "boolean", required: false, description: "true to make it a top-level area. Send this or `parent`." },
  ],
  result: {
    kind: "object",
    description:
      "`area` as `list_areas` now states it — `areaPath` is its new place — `previousPath`, `moved` (false when it already sat there), and `catalogueChanges`: each area of the moved branch whose issues now resolve their catalogues differently, with its `issueCount` and the resolved configuration `before` and `after`. Empty when nothing changed for any issue.",
  },
  handler: async (context, params) => moveAreaFromParams(context, params),
};

export async function setAreaOrderFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{ parent?: { areaId: string; areaPath: string }; areas: { areaId: string; name: string; position: number }[]; placed: number; keptAfter: number }> {
  const world = await loadAreaWorld(context);
  const refs = stringList(params, "areas");
  if (refs.length === 0) throw invalidRequest('"areas" must name at least one area, by name or id.');
  const named: CollectionAreaData[] = [];
  for (const ref of refs) {
    const area = resolveArea(world, ref, "areas");
    if (!named.some((row) => row.id === area.id)) named.push(area);
  }
  const parents = [...new Set(named.map((area) => area.parentId))];
  if (parents.length > 1) {
    throw notSiblings(
      parents.map((parentId) => {
        const under = named.filter((area) => area.parentId === parentId).map((area) => area.name).join(", ");
        return `${under} under ${parentId === null ? "the top level" : `"${pathOf(world, parentId)}"`}`;
      })
    );
  }
  const parentId = parents[0];
  const siblings = siblingGroups(world.areas).get(parentId) ?? [];
  const placing = new Set(named.map((area) => area.id));
  const ordered = [...named.map((area) => area.id), ...siblings.filter((area) => !placing.has(area.id)).map((area) => area.id)];
  await reorderCollectionAreas(context.ownerId, context.collectionId, parentId, ordered);

  const after = await loadAreaWorld(context);
  const group = siblingGroups(after.areas).get(parentId) ?? [];
  return {
    ...(parentId === null ? {} : { parent: { areaId: parentId, areaPath: pathOf(after, parentId) ?? parentId } }),
    areas: group.map((area, i) => ({ areaId: area.id, name: area.name, position: i + 1 })),
    placed: named.length,
    keptAfter: group.length - named.length,
  };
}

export const setAreaOrderOperation: Operation = {
  name: "set_area_order",
  method: "POST",
  path: "/areas/order",
  description:
    "Set the order of areas among their siblings — the collector's own order, which the Areas screen and every area picker read. The areas sent must share one parent; they come first, in the order sent, and any sibling not sent follows them, keeping its order. Send every sibling to set the whole order. Nothing moves to another parent; `move_area` does that.",
  writes: true,
  parameters: [
    { name: "areas", in: "body", type: "string[]", required: true, description: "The sibling areas in the order they should read, by name or id." },
  ],
  result: {
    kind: "object",
    description: "`parent` (absent at the top level), `areas` — the whole sibling group in its new order with each `position` — `placed`, how many now lead it as sent, and `keptAfter`.",
  },
  handler: async (context, params) => setAreaOrderFromParams(context, params),
};

// ── Moving an issue ────────────────────────────────────────────────────────

export async function moveIssueToAreaFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{
  issueId: string;
  name?: string;
  moved: boolean;
  from: { areaId: string; areaPath: string };
  to: { areaId: string; areaPath: string };
  catalogues: { changed: boolean; before: AgentAreaResolvedCatalogues; after: AgentAreaResolvedCatalogues };
  numbersOutsideArea?: string[];
}> {
  const issueId = requiredString(params, "issue_id");
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, collectionId: context.collectionId },
    select: {
      id: true,
      name: true,
      collectionAreaId: true,
      catalogPrefixes: { select: { catalogVendorId: true, areaPrefix: true } },
    },
  });
  if (!issue) {
    throw notFound(`No issue with id "${issueId}" is in this token's collection. Use \`search_collection\` or \`get_stamp\` to find the right id.`);
  }
  const world = await loadAreaWorld(context);
  const target = resolveArea(world, requiredString(params, "area"), "area");
  if (!target.assignable) {
    const children = world.areas.filter((area) => area.parentId === target.id && area.assignable);
    throw invalidRequest(
      `"${target.name}" is a grouping-only area: it organises the areas under it and holds no issues itself. Nothing was moved. Move the issue to one of the areas under it.`,
      children.map((area) => area.name)
    );
  }
  const own = new Map(issue.catalogPrefixes.map((row) => [row.catalogVendorId, row.areaPrefix]));
  const before = resolvedCatalogues(world.areas, issue.collectionAreaId, world.names, own);
  const from = { areaId: issue.collectionAreaId, areaPath: pathOf(world, issue.collectionAreaId) ?? issue.collectionAreaId };
  const moved = target.id !== issue.collectionAreaId;
  if (moved) await moveIssueToArea(context.ownerId, context.collectionId, issue.id, target.id);

  const after = resolvedCatalogues(world.areas, target.id, world.names, own);
  // Numbers its stamps carry in a catalogue the new area does not keep: they stay on the stamps, but
  // the stamp and issue forms there offer no field for them.
  const kept = new Set(effectiveVendorsForArea(world.areas, target.id).map((entry) => entry.catalogVendorId));
  const numbered = await prisma.stampCatalogNumber.findMany({
    where: { stamp: { issueMemberships: { some: { issueId: issue.id } } } },
    distinct: ["catalogVendorId"],
    select: { catalogVendorId: true },
  });
  const outside = numbered
    .filter((row) => !kept.has(row.catalogVendorId))
    .map((row) => world.names.catalogues.get(row.catalogVendorId) ?? row.catalogVendorId)
    .sort();
  return {
    issueId: issue.id,
    ...(issue.name ? { name: issue.name } : {}),
    moved,
    from,
    to: { areaId: target.id, areaPath: pathOf(world, target.id) ?? target.name },
    catalogues: { changed: !sameResolvedCatalogues(before, after), before, after },
    ...(outside.length > 0 ? { numbersOutsideArea: outside } : {}),
  };
}

export const moveIssueToAreaOperation: Operation = {
  name: "move_issue_to_area",
  method: "POST",
  path: "/issues/{issue_id}/move",
  description:
    "Move an issue to another area, as the Issues list's Move to area does: the issue and its stamps are filed under the new area, and a stamp another issue keeps in the old area stays there too. The issue then inherits the new area's catalogue configuration, so the answer states its resolved catalogues before and after — a changed prefix changes how its numbers read — and names any catalogue its stamps have numbers in that the new area does not keep. A grouping-only area is refused. Nothing is deleted.",
  writes: true,
  parameters: [
    { name: "issue_id", in: "path", type: "string", required: true, description: "The issue's id, as `search_collection` or `get_stamp` reports it." },
    { name: "area", in: "body", type: "string", required: true, description: "The area to file it under, by name or id from `list_areas`." },
  ],
  result: {
    kind: "object",
    description:
      "`issueId`, `name`, `moved` (false when it was already there), `from` and `to` with each area's `areaPath`, `catalogues` — the issue's resolved `leadingCatalogue`, `catalogues` with their prefixes and `valuingBook`, `before` and `after`, and whether they `changed` — and `numbersOutsideArea`, catalogues its stamps carry numbers in that the new area does not keep.",
  },
  handler: async (context, params) => moveIssueToAreaFromParams(context, params),
};
