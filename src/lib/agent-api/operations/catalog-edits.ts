import "server-only";
import { prisma } from "../../db";
import { effectivePrimaryVendorId, effectiveVendorsForArea } from "../../area-vendor";
import { readCollectionAreas, type CollectionAreaData } from "../../areas";
import {
  AUTO_CREATE_MAX_STAMPS,
  parseCatalogNumberSpec,
  parseVariantNumberSpec,
  type CatalogNumberSpec,
} from "../../catalog-number";
import { getCollectionTranslationContext } from "../../contacts";
import {
  findCatalogDuplicatesForCandidates,
  findCatalogDuplicatesForStamp,
  type CatalogPrefixContext,
} from "../../duplicate-catalog";
import {
  addStampRangeToIssue,
  addVariantRangeToStamp,
  createIssue,
  updateIssue,
  type AutoCreateStampsInput,
} from "../../issues";
import { STAMP_ATTRIBUTE_KINDS, type StampAttributeInput, type StampAttributeKind } from "../../stamp-attribute-kinds";
import { getStampAttributeLists } from "../../stamp-attributes";
import { getStampSizePresets } from "../../stamp-size-presets";
import { getStampCatalogNumber, updateStampWithCatalog } from "../../stamps";
import type { TranslationValueMap } from "../../translations";
import {
  checkDatePart,
  checkTranslationLanguage,
  duplicateCatalogNumbers,
  parseKeyedEntries,
  parseTranslatedNames,
} from "../catalog-edits";
import { invalidRequest, notFound } from "../errors";
import { optionalBoolean, optionalInteger, optionalString, requiredString, stringList } from "../params";
import { presetVocabularyEntry } from "../size-reads";
import { acceptedNames, resolveVocabularyValue, type VocabularyEntry, type VocabularyName } from "../vocabulary";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import { readIssue, readStamp } from "./records";
import { loadStampLabels } from "./stamp-refs";
import type { AgentIssueDetail, AgentStampDetail } from "../collection-reads";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// Building the catalogue (#1438): create an issue with the stamps its catalogue numbers generate,
// add stamps and variant runs to it, and correct names, translated names, catalogue numbers and
// attributes — so the catalogue an assistant can read off a page is not retyped by the collector.
//
// **Every write is the app's own.** An issue is `createIssue`, a range is `addStampRangeToIssue`, a
// variant run is `addVariantRangeToStamp`, an issue edit is `updateIssue` and a stamp edit is
// `updateStampWithCatalog` — the issue form's, the add-range dialog's, the variant-range dialog's and
// the two edit dialogs' writes. What this module adds is what those dialogs do in their server
// actions before they write: the spec parse, the same-span rule, the dialog's stamp cap, the year
// bounds, and the duplicate check — each read here so its refusal is written for an agent.
//
// **Nothing is deleted and nothing is moved** (#1438): no issue or stamp is deleted, no stamp moves
// between issues or under another parent, and nothing is reordered — a new stamp takes the issue's
// order as the dialogs' generation gives it. Those are decisions for the screen, and
// `tests/unit/agent-api-operation-boundary.test.ts` keeps them out of every operation module.
//
// **An edit restates what it does not change.** `updateIssue` and `updateStampWithCatalog` replace
// the name, the year and — for a stamp — every catalogue number, because that is what an edit dialog
// submits. So each edit reads the record first and sends back whatever the agent left alone: only
// what is sent changes.

// ── The collection's side ──────────────────────────────────────────────────

interface CatalogueWorld {
  areas: CollectionAreaData[];
  vendors: VocabularyEntry[];
}

async function loadCatalogueWorld(context: OperationContext): Promise<CatalogueWorld> {
  const [areas, vendors] = await Promise.all([
    readCollectionAreas(context.collectionId),
    prisma.catalogVendor.findMany({
      where: { collectionId: context.collectionId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, abbreviation: true },
    }),
  ]);
  return { areas, vendors };
}

/**
 * The catalogues an area keeps — its own and those it inherits, which is exactly what the issue and
 * stamp forms offer a number field for (`effectiveVendorsForArea`).
 */
function areaCatalogues(world: CatalogueWorld, areaId: string): VocabularyEntry[] {
  const kept = new Set(effectiveVendorsForArea(world.areas, areaId).map((entry) => entry.catalogVendorId));
  return world.vendors.filter((vendor) => kept.has(vendor.id));
}

function areaName(world: CatalogueWorld, areaId: string): string {
  return world.areas.find((area) => area.id === areaId)?.name ?? areaId;
}

/**
 * The catalogue a key names, among those the area keeps. A catalogue the collection has but this
 * area does not keep is refused in its own words: the collector's forms offer no field for it, so a
 * number there would be one nobody could see or correct on the stamp's own screen.
 */
function resolveAreaCatalogue(
  world: CatalogueWorld,
  areaId: string,
  key: string,
  parameter: string
): string {
  const kept = areaCatalogues(world, areaId);
  if (kept.length === 0) {
    throw invalidRequest(
      `The area "${areaName(world, areaId)}" keeps no catalogue, so it has nowhere to record a number. The collector sets an area's catalogues on the Areas screen.`
    );
  }
  const vendorId = resolveVocabularyValue(key, world.vendors, { vocabulary: "catalog vendor", parameter });
  if (!kept.some((vendor) => vendor.id === vendorId)) {
    throw invalidRequest(
      `The area "${areaName(world, areaId)}" does not keep the catalogue "${key}", so a number in it would have no field on the collector's screens. Use one of the catalogues it keeps.`,
      acceptedNames(kept)
    );
  }
  return vendorId;
}

/** One catalogue's entry parsed in the issue form's own syntax (#452): ranges and single numbers. */
interface CatalogueSpec {
  readonly catalogVendorId: string;
  readonly key: string;
  readonly spec: CatalogNumberSpec;
}

function parseCatalogueSpecs(
  world: CatalogueWorld,
  areaId: string,
  entries: readonly string[],
  parameter: string
): CatalogueSpec[] {
  return parseKeyedEntries(entries, parameter, "catalogue", "Mi: 100-105").map(({ key, value }) => {
    const catalogVendorId = resolveAreaCatalogue(world, areaId, key, parameter);
    const spec = parseCatalogNumberSpec(value);
    if ("error" in spec) {
      throw invalidRequest(`"${parameter}" entry "${key}: ${value}" cannot be read: ${spec.error}`);
    }
    return { catalogVendorId, key, spec };
  });
}

/**
 * The stamps a set of specs generates, matched across catalogues by position — the issue form's and
 * the add-range dialog's rule (#70, #219), so every catalogue generating stamps must span the same
 * number of them, and a run is capped at the dialog's `AUTO_CREATE_MAX_STAMPS`.
 */
function generatedStamps(specs: readonly CatalogueSpec[], parameter: string): AutoCreateStampsInput {
  const counts = new Set(specs.map((entry) => entry.spec.numbers.length));
  if (counts.size > 1) {
    throw invalidRequest(
      `The catalogues in "${parameter}" generate different numbers of stamps (${specs
        .map((entry) => `${entry.key}: ${entry.spec.numbers.length}`)
        .join(", ")}). Stamps are matched across catalogues by position, so every catalogue that generates them must span the same count. Name the ones that do in "stamps_from", or correct the ranges.`
    );
  }
  const count = specs[0].spec.numbers.length;
  if (count > AUTO_CREATE_MAX_STAMPS) {
    throw invalidRequest(
      `"${parameter}" generates ${count} stamps and at most ${AUTO_CREATE_MAX_STAMPS} are created in one call, as in the collector's own dialog. Split the run into several calls.`
    );
  }
  return {
    count,
    vendors: specs.map((entry) => ({ catalogVendorId: entry.catalogVendorId, numbers: entry.spec.numbers })),
  };
}

/**
 * Refuse numbers that already exist in the same catalogue under the same prefix — the catalogue
 * identity duplicate detection compares (#85) and the resolver answers from (#1037). Refused
 * whatever the collection's duplicate setting is: see `duplicateCatalogNumbers`.
 */
async function refuseDuplicates(
  context: OperationContext,
  prefixContext: CatalogPrefixContext,
  candidates: { catalogVendorId: string; number: string }[]
): Promise<void> {
  if (candidates.length === 0) return;
  const groups = await findCatalogDuplicatesForCandidates(
    context.ownerId,
    context.collectionId,
    prefixContext,
    candidates,
    null
  );
  if (groups.length > 0) throw duplicateCatalogNumbers(groups);
}

function candidatesOf(input: AutoCreateStampsInput): { catalogVendorId: string; number: string }[] {
  return input.vendors.flatMap((vendor) =>
    vendor.numbers.map((number) => ({ catalogVendorId: vendor.catalogVendorId, number }))
  );
}

async function resolveSizePreset(context: OperationContext, ref: string): Promise<string> {
  const presets = await getStampSizePresets(context.ownerId, context.collectionId);
  return resolveVocabularyValue(ref, presets.map(presetVocabularyEntry), {
    vocabulary: "size preset",
    parameter: "size_preset",
  });
}

/** A stamp this call created, as the collector reads it. */
export interface AgentCreatedStamp {
  readonly stampId: string;
  readonly catalogNumbers: readonly string[];
}

async function createdStamps(
  context: OperationContext,
  stampIds: readonly string[]
): Promise<AgentCreatedStamp[]> {
  const labels = await loadStampLabels(context, stampIds);
  return stampIds.map((stampId) => ({ stampId, catalogNumbers: labels.get(stampId)?.catalogNumbers ?? [] }));
}

async function translationLanguages(context: OperationContext) {
  const { titleLanguages, defaultLanguage } = await getCollectionTranslationContext(
    context.ownerId,
    context.collectionId
  );
  return { languages: titleLanguages, defaultLanguage };
}

/**
 * The translated names an edit or a creation writes: `names` sets, `clear_names` removes. A language
 * named in both is refused rather than decided.
 */
async function translationWrites(
  context: OperationContext,
  params: ParsedParams
): Promise<TranslationValueMap | undefined> {
  const names = stringList(params, "names");
  const cleared = stringList(params, "clear_names");
  if (names.length === 0 && cleared.length === 0) return undefined;
  const { languages, defaultLanguage } = await translationLanguages(context);
  const set = parseTranslatedNames(names, "names", languages, defaultLanguage);
  const writes: TranslationValueMap = {};
  for (const [language, name] of set) writes[language] = { name };
  for (const raw of cleared) {
    const language = checkTranslationLanguage(raw, "clear_names", languages, defaultLanguage);
    if (set.has(language)) {
      throw invalidRequest(`The language "${language}" is both in "names" and in "clear_names". Send one or the other.`);
    }
    writes[language] = { name: null };
  }
  return writes;
}

const NAMES_PARAMETER: ParameterSpec = {
  name: "names",
  in: "body",
  type: "string[]",
  required: false,
  description:
    'The name in other languages, one `"language: name"` entry each — `["de: Freimarken"]`. Only the languages this collection lists or prints in are accepted, never its own language, which is `name`.',
};

const CLEAR_NAMES_PARAMETER: ParameterSpec = {
  name: "clear_names",
  in: "body",
  type: "string[]",
  required: false,
  description: 'Languages whose translated name to take off — `["de"]`. The name then reads in the collection\'s own language there.',
};

function catalogNumbersParameter(description: string, required = false): ParameterSpec {
  return { name: "catalog_numbers", in: "body", type: "string[]", required, description };
}

const SIZE_PRESET_PARAMETER: ParameterSpec = {
  name: "size_preset",
  in: "body",
  type: "string",
  required: false,
  description:
    "A size preset every stamp created here is given — its id, its name, or its pair as `list_size_presets` labels it. Optional; without it the stamps state no size.",
};

const NUMBERS_SYNTAX =
  'written as the collector\'s issue form reads them: comma-separated ranges or single numbers, `"Mi: 100-105, 107"`, suffixed runs such as `"Mi: 2895A-2897A, 2895B-2897B"` included.';

// ── Creating an issue ──────────────────────────────────────────────────────

export async function createIssueFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentIssueDetail & { createdStamps: AgentCreatedStamp[] }> {
  const world = await loadCatalogueWorld(context);
  const areaEntries = world.areas.map((area) => ({ id: area.id, name: area.name, label: area.titleName ?? undefined }));
  const areaId = resolveVocabularyValue(requiredString(params, "area"), areaEntries, {
    vocabulary: "area",
    parameter: "area",
  });
  const area = world.areas.find((row) => row.id === areaId)!;
  if (!area.assignable) {
    const children = world.areas.filter((row) => row.parentId === areaId && row.assignable);
    throw invalidRequest(
      `"${area.name}" is a grouping-only area: it organises the areas under it and holds no issues itself. Create the issue in one of the areas under it.`,
      acceptedNames(children)
    );
  }

  const yearValue = optionalInteger(params, "year");
  const year = yearValue === null ? null : checkDatePart(yearValue, "year", "year");
  const name = optionalString(params, "name");
  const translations = await translationWrites(context, params);

  const specs = parseCatalogueSpecs(world, areaId, stringList(params, "catalog_numbers"), "catalog_numbers");
  const generate = optionalBoolean(params, "generate_stamps") ?? true;
  const fromKeys = stringList(params, "stamps_from");
  if (!generate && fromKeys.length > 0) {
    throw invalidRequest('"stamps_from" names catalogues to generate stamps from, and "generate_stamps" is false. Send one or the other.');
  }
  let generating: CatalogueSpec[] = [];
  if (generate && specs.length > 0) {
    if (fromKeys.length === 0) {
      generating = specs;
    } else {
      generating = fromKeys.map((key) => {
        const vendorId = resolveAreaCatalogue(world, areaId, key, "stamps_from");
        const found = specs.find((entry) => entry.catalogVendorId === vendorId);
        if (!found) {
          throw invalidRequest(
            `"stamps_from" names "${key}", which has no entry in "catalog_numbers". Stamps are generated from the numbers given there.`,
            specs.map((entry) => entry.key)
          );
        }
        return found;
      });
    }
  }
  const autoCreateStamps = generating.length > 0 ? generatedStamps(generating, "catalog_numbers") : undefined;

  const presetRef = optionalString(params, "size_preset");
  if (presetRef !== null && !autoCreateStamps) {
    throw invalidRequest('"size_preset" sizes the stamps this call creates, and it creates none. Send "catalog_numbers" to generate stamps, or leave "size_preset" out.');
  }
  const sizePresetId = presetRef !== null ? await resolveSizePreset(context, presetRef) : null;

  if (autoCreateStamps) await refuseDuplicates(context, { areaId }, candidatesOf(autoCreateStamps));

  const created = await createIssue(context.ownerId, context.collectionId, areaId, {
    name,
    year,
    catalogNumbers: specs.map((entry) => ({
      catalogVendorId: entry.catalogVendorId,
      firstNumber: entry.spec.declared.firstNumber,
      lastNumber: entry.spec.declared.lastNumber,
    })),
    translations,
    autoCreateStamps,
    sizePresetId,
  });
  const issue = await readIssue(context, Object.freeze({ issue_id: created.id }));
  return { ...issue, createdStamps: await createdStamps(context, created.stampIds) };
}

export const createIssueOperation: Operation = {
  name: "create_issue",
  method: "POST",
  path: "/issues",
  description: `Create an issue — a series — in an area, the way the collector's Add issue form does: a year, a name, and each catalogue's numbers ${NUMBERS_SYNTAX} Those numbers declare the issue's range in each catalogue and generate its stamps, one per number, matched across catalogues by position and put on the issue's checklist. A catalogue number this collection already has — the same catalogue and prefix — is refused with the stamp that has it: call \`resolve_catalog_numbers\` first, and never create what it finds. Nothing created here can be deleted through this API.`,
  writes: true,
  parameters: [
    {
      name: "area",
      in: "body",
      type: "string",
      required: true,
      description: "The area the issue belongs to, by name or id from `get_collection_vocabulary`. A grouping-only area (`assignable: false`) holds no issues and is refused.",
    },
    { name: "year", in: "body", type: "integer", required: false, description: "The year of issue, 1840–2100." },
    { name: "name", in: "body", type: "string", required: false, description: "The issue's name in the collection's own language." },
    NAMES_PARAMETER,
    catalogNumbersParameter(
      `One entry per catalogue, \`"catalogue: numbers"\`, the catalogue by name or abbreviation among those the area keeps, the numbers ${NUMBERS_SYNTAX}`
    ),
    {
      name: "stamps_from",
      in: "body",
      type: "string[]",
      required: false,
      description:
        "The catalogues whose numbers generate the stamps. Defaults to every catalogue in `catalog_numbers`; name fewer when a catalogue numbers the series differently and should only declare its range.",
    },
    {
      name: "generate_stamps",
      in: "body",
      type: "boolean",
      required: false,
      description: "Send false to create the issue with its declared ranges and no stamps. Defaults to true.",
    },
    SIZE_PRESET_PARAMETER,
  ],
  result: {
    kind: "object",
    description:
      "The issue as `get_issue` reads it, and `createdStamps` — each stamp created, with its id and its catalogue numbers, in the order the numbers were given.",
  },
  handler: async (context, params) => createIssueFromParams(context, params),
};

// ── Adding stamps and variants ─────────────────────────────────────────────

async function loadIssue(context: OperationContext, issueId: string) {
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, collectionId: context.collectionId },
    select: {
      id: true,
      name: true,
      year: true,
      collectionAreaId: true,
      catalogNumbers: { select: { catalogVendorId: true, firstNumber: true, lastNumber: true } },
    },
  });
  if (!issue) {
    throw notFound(
      `No issue with id "${issueId}" is in this token's collection. Use \`search_collection\` or \`get_stamp\` to find the right id.`
    );
  }
  return issue;
}

export async function addIssueStampsFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{ issueId: string; path: string; createdStamps: AgentCreatedStamp[] }> {
  const issue = await loadIssue(context, requiredString(params, "issue_id"));
  const world = await loadCatalogueWorld(context);
  const specs = parseCatalogueSpecs(world, issue.collectionAreaId, stringList(params, "catalog_numbers"), "catalog_numbers");
  const input = generatedStamps(specs, "catalog_numbers");
  const presetRef = optionalString(params, "size_preset");
  const sizePresetId = presetRef !== null ? await resolveSizePreset(context, presetRef) : null;

  await refuseDuplicates(context, { areaId: issue.collectionAreaId, issueId: issue.id }, candidatesOf(input));
  const stampIds = await addStampRangeToIssue(context.ownerId, context.collectionId, issue.id, input, { sizePresetId });
  const header = await loadCollectionHeader(context);
  return {
    issueId: issue.id,
    path: collectionPath(header, `/issues/${issue.id}`),
    createdStamps: await createdStamps(context, stampIds),
  };
}

export const addIssueStampsOperation: Operation = {
  name: "add_issue_stamps",
  method: "POST",
  path: "/issues/{issue_id}/stamps",
  description: `Add stamps to an existing issue, one per catalogue number, the way the issue's Add range dialog does — a single number adds one stamp. Each catalogue's numbers are ${NUMBERS_SYNTAX} New stamps go at the end of the issue's order and on its checklist, and take the issue's year. A catalogue number this collection already has is refused with the stamp that has it. The issue's declared range is not widened; correct it with \`update_issue\`.`,
  writes: true,
  parameters: [
    { name: "issue_id", in: "path", type: "string", required: true, description: "The issue's id, as `search_collection` or `get_stamp` reports it." },
    catalogNumbersParameter(
      "One entry per catalogue, `\"catalogue: numbers\"`, among the catalogues the issue's area keeps. Every catalogue given must span the same number of stamps.",
      true
    ),
    SIZE_PRESET_PARAMETER,
  ],
  result: {
    kind: "object",
    description: "`createdStamps` — each stamp created, with its id and catalogue numbers, in the order the numbers were given — and the issue's `path` in the app.",
  },
  handler: async (context, params) => addIssueStampsFromParams(context, params),
};

async function loadStamp(context: OperationContext, stampId: string) {
  const stamp = await prisma.stamp.findFirst({
    where: { id: stampId, collectionId: context.collectionId },
    select: {
      id: true,
      name: true,
      parentId: true,
      issuedDay: true,
      issuedMonth: true,
      issuedYear: true,
      catalogNumbers: { select: { catalogVendorId: true, number: true } },
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      issueMemberships: { select: { issueId: true }, orderBy: { issueId: "asc" } },
    },
  });
  if (!stamp) {
    throw notFound(
      `No stamp with id "${stampId}" is in this token's collection. Use \`search_collection\` or \`resolve_catalog_numbers\` to find the right id.`
    );
  }
  return stamp;
}

export async function addStampVariantsFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{ stampId: string; issueId: string; path: string; createdStamps: AgentCreatedStamp[] }> {
  const stamp = await loadStamp(context, requiredString(params, "stamp_id"));
  const memberships = stamp.issueMemberships.map((row) => row.issueId);
  const issueParam = optionalString(params, "issue_id");
  let issueId: string;
  if (issueParam !== null) {
    if (!memberships.includes(issueParam)) {
      throw invalidRequest(
        `The stamp is not filed under the issue "${issueParam}", and a variant is filed where its base stamp is. Use one of its issues.`,
        memberships
      );
    }
    issueId = issueParam;
  } else if (memberships.length === 1) {
    issueId = memberships[0];
  } else if (memberships.length === 0) {
    throw invalidRequest("The stamp is filed under no issue, so its variants would have nowhere to be filed. Add it to an issue on the collector's screen first.");
  } else {
    throw invalidRequest('The stamp is filed under several issues. Name the one its variants belong to in "issue_id".', memberships);
  }
  const issue = await loadIssue(context, issueId);
  const world = await loadCatalogueWorld(context);

  const catalogueRef = optionalString(params, "catalogue");
  let catalogVendorId: string;
  if (catalogueRef !== null) {
    catalogVendorId = resolveAreaCatalogue(world, issue.collectionAreaId, catalogueRef, "catalogue");
  } else {
    const primary = effectivePrimaryVendorId(world.areas, issue.collectionAreaId);
    if (!primary) {
      throw invalidRequest(
        `The area "${areaName(world, issue.collectionAreaId)}" names no leading catalogue, so say which catalogue the numbers are in with "catalogue".`,
        acceptedNames(areaCatalogues(world, issue.collectionAreaId))
      );
    }
    catalogVendorId = primary;
  }

  const raw = requiredString(params, "numbers");
  const baseNumber = await getStampCatalogNumber(context.ownerId, context.collectionId, stamp.id, catalogVendorId);
  const parsed = parseVariantNumberSpec(raw, baseNumber ?? "");
  if ("error" in parsed) {
    throw invalidRequest(
      `"numbers" cannot be read: ${parsed.error}${baseNumber === null ? " The base stamp has no number in this catalogue, so write each variant's full number." : ""}`
    );
  }
  if (parsed.numbers.length > AUTO_CREATE_MAX_STAMPS) {
    throw invalidRequest(
      `"numbers" generates ${parsed.numbers.length} variants and at most ${AUTO_CREATE_MAX_STAMPS} are created in one call, as in the collector's own dialog. Split the run.`
    );
  }

  const subtypeRef = optionalString(params, "subtype");
  let subtypeId: string | null = null;
  if (subtypeRef !== null) {
    const subtypes = await prisma.stampSubtype.findMany({
      where: { collectionId: context.collectionId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    });
    subtypeId = resolveVocabularyValue(subtypeRef, subtypes, { vocabulary: "subtype", parameter: "subtype" });
  }

  await refuseDuplicates(
    context,
    { areaId: issue.collectionAreaId, issueId },
    parsed.numbers.map((number) => ({ catalogVendorId, number }))
  );
  const stampIds = await addVariantRangeToStamp(context.ownerId, context.collectionId, issueId, stamp.id, {
    catalogVendorId,
    numbers: parsed.numbers,
    subtypeId,
  });
  const header = await loadCollectionHeader(context);
  return {
    stampId: stamp.id,
    issueId,
    path: collectionPath(header, `/stamps/${stamp.id}`),
    createdStamps: await createdStamps(context, stampIds),
  };
}

export const addStampVariantsOperation: Operation = {
  name: "add_stamp_variants",
  method: "POST",
  path: "/stamps/{stamp_id}/variants",
  description:
    "Add a run of variants under one stamp, the way the collector's variant range dialog does: `a-f` under `240` makes `240a` … `240f`, `I-III` makes Roman-numbered ones, and full numbers (`240a-240f`, `309AP`) are taken as written. Every variant carries the same subtype, the base stamp's year, no name and no checklist entry, and goes at the end of the issue's order. A catalogue number this collection already has is refused with the stamp that has it.",
  writes: true,
  parameters: [
    { name: "stamp_id", in: "path", type: "string", required: true, description: "The base stamp's id, as `search_collection` or `resolve_catalog_numbers` reports it." },
    {
      name: "numbers",
      in: "body",
      type: "string",
      required: true,
      description:
        "The variants' numbers: a suffix run hung off the base stamp's number (`a-f`, `A-C`, `I-III`), full numbers (`240a-240f`), or several of either separated by commas. A lone suffix is taken literally: `P` under `309A` is `309AP`.",
    },
    {
      name: "catalogue",
      in: "body",
      type: "string",
      required: false,
      description: "The catalogue the numbers are in, by name or abbreviation. Defaults to the area's leading catalogue; a secondary catalogue's lettering is typed per stamp with `update_stamp`.",
    },
    {
      name: "subtype",
      in: "body",
      type: "string",
      required: false,
      description: "What kind of variant these are — a subtype from `get_collection_vocabulary`, by name or id (`Color`, `Perforation`, `Forgery`). Defaults to the collection's default subtype.",
    },
    {
      name: "issue_id",
      in: "body",
      type: "string",
      required: false,
      description: "The issue the variants are filed under. Needed only when the base stamp is filed under more than one.",
    },
  ],
  result: {
    kind: "object",
    description: "`createdStamps` — each variant created, with its id and catalogue numbers, in order — and the base stamp's `path` in the app.",
  },
  handler: async (context, params) => addStampVariantsFromParams(context, params),
};

// ── Editing ────────────────────────────────────────────────────────────────

function clearList(params: ParsedParams): Set<string> {
  return new Set(stringList(params, "clear"));
}

function refuseSentAndCleared(field: string, sent: boolean, cleared: Set<string>): void {
  if (sent && cleared.has(field)) {
    throw invalidRequest(`"${field}" is both sent and named in "clear". Send one or the other.`);
  }
}

export async function updateIssueFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentIssueDetail> {
  const issue = await loadIssue(context, requiredString(params, "issue_id"));
  const cleared = clearList(params);
  const name = optionalString(params, "name");
  const yearValue = optionalInteger(params, "year");
  refuseSentAndCleared("name", name !== null, cleared);
  refuseSentAndCleared("year", yearValue !== null, cleared);
  const year = yearValue === null ? null : checkDatePart(yearValue, "year", "year");
  const translations = await translationWrites(context, params);
  const entries = stringList(params, "catalog_numbers");
  if (name === null && yearValue === null && cleared.size === 0 && !translations && entries.length === 0) {
    throw invalidRequest('Nothing to change: send "name", "year", "names", "clear_names", "catalog_numbers" or "clear".');
  }

  let catalogNumbers: { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[] | undefined;
  if (entries.length > 0) {
    const world = await loadCatalogueWorld(context);
    const specs = parseCatalogueSpecs(world, issue.collectionAreaId, entries, "catalog_numbers");
    const byVendor = new Map(issue.catalogNumbers.map((row) => [row.catalogVendorId, row]));
    for (const entry of specs) {
      byVendor.set(entry.catalogVendorId, {
        catalogVendorId: entry.catalogVendorId,
        firstNumber: entry.spec.declared.firstNumber,
        lastNumber: entry.spec.declared.lastNumber,
      });
    }
    catalogNumbers = [...byVendor.values()];
  }

  // `updateIssue` writes the name and the year whatever it is handed, so each is restated.
  await updateIssue(context.ownerId, context.collectionId, issue.id, {
    name: cleared.has("name") ? null : (name ?? issue.name),
    year: cleared.has("year") ? null : (year ?? issue.year),
    catalogNumbers,
    translations,
  });
  return readIssue(context, Object.freeze({ issue_id: issue.id }));
}

export const updateIssueOperation: Operation = {
  name: "update_issue",
  method: "PATCH",
  path: "/issues/{issue_id}",
  description: `Correct an issue: its name, its year, its translated names, or the range it declares in a catalogue — only what is sent changes. A range is written ${NUMBERS_SYNTAX} It restates the declared range only; it creates, renames and renumbers no stamp. Nothing here deletes an issue or moves it to another area.`,
  writes: true,
  parameters: [
    { name: "issue_id", in: "path", type: "string", required: true, description: "The issue's id, as `search_collection` or `get_stamp` reports it." },
    { name: "name", in: "body", type: "string", required: false, description: "The issue's name in the collection's own language." },
    { name: "year", in: "body", type: "integer", required: false, description: "The year of issue, 1840–2100." },
    NAMES_PARAMETER,
    CLEAR_NAMES_PARAMETER,
    catalogNumbersParameter(
      "The declared range in each catalogue named, `\"catalogue: numbers\"`, among the catalogues the issue's area keeps. A catalogue not named keeps its range."
    ),
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: 'Fields to empty: `["name"]`, `["year"]` or both.',
      values: ["name", "year"],
    },
  ],
  result: { kind: "object", description: "The issue as `get_issue` now reads it." },
  handler: async (context, params) => updateIssueFromParams(context, params),
};

const STAMP_CLEARABLE = [
  "name",
  "issued_year",
  "issued_month",
  "issued_day",
  "denomination",
  "perforation",
  ...STAMP_ATTRIBUTE_KINDS,
] as const;

const ATTRIBUTE_FIELD: Record<StampAttributeKind, "colorId" | "watermarkId" | "paperId" | "printingId"> = {
  color: "colorId",
  watermark: "watermarkId",
  paper: "paperId",
  printing: "printingId",
};

export async function updateStampFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentStampDetail> {
  const stamp = await loadStamp(context, requiredString(params, "stamp_id"));
  const cleared = clearList(params);

  const name = optionalString(params, "name");
  refuseSentAndCleared("name", name !== null, cleared);
  const date: Record<"issued_year" | "issued_month" | "issued_day", number | null> = {
    issued_year: optionalInteger(params, "issued_year"),
    issued_month: optionalInteger(params, "issued_month"),
    issued_day: optionalInteger(params, "issued_day"),
  };
  for (const field of ["issued_year", "issued_month", "issued_day"] as const) {
    refuseSentAndCleared(field, date[field] !== null, cleared);
    const value = date[field];
    if (value !== null) checkDatePart(value, field, field === "issued_year" ? "year" : field === "issued_month" ? "month" : "day");
  }

  const attributes: StampAttributeInput = {};
  for (const field of ["denomination", "perforation"] as const) {
    const value = optionalString(params, field);
    refuseSentAndCleared(field, value !== null, cleared);
    if (value !== null) attributes[field] = value;
    else if (cleared.has(field)) attributes[field] = null;
  }
  const attributeRefs = STAMP_ATTRIBUTE_KINDS.map((kind) => [kind, optionalString(params, kind)] as const);
  if (attributeRefs.some(([, ref]) => ref !== null)) {
    const lists = await getStampAttributeLists(context.ownerId, context.collectionId);
    for (const [kind, ref] of attributeRefs) {
      if (ref === null) continue;
      refuseSentAndCleared(kind, true, cleared);
      attributes[ATTRIBUTE_FIELD[kind]] = resolveVocabularyValue(ref, lists[kind], {
        vocabulary: kind satisfies VocabularyName,
        parameter: kind,
      });
    }
  }
  for (const kind of STAMP_ATTRIBUTE_KINDS) {
    if (cleared.has(kind)) attributes[ATTRIBUTE_FIELD[kind]] = null;
  }

  const translations = await translationWrites(context, params);
  const entries = stringList(params, "catalog_numbers");
  const changesDate = Object.values(date).some((value) => value !== null);
  if (name === null && !changesDate && cleared.size === 0 && !translations && entries.length === 0 && Object.keys(attributes).length === 0) {
    throw invalidRequest(
      'Nothing to change: send a field to set — "name", "names", "issued_year", "catalog_numbers", "denomination", "color" and the rest — or "clear" / "clear_names".'
    );
  }

  const catalogNumbers = new Map(stamp.catalogNumbers.map((row) => [row.catalogVendorId, row.number]));
  const sent: { catalogVendorId: string; number: string }[] = [];
  if (entries.length > 0) {
    const areaId = (stamp.stampAreaLinks.find((link) => link.isPrimary) ?? stamp.stampAreaLinks[0])?.collectionAreaId;
    if (!areaId) {
      throw invalidRequest("The stamp belongs to no area, so it has no catalogues to hold a number. The collector files it under an area first.");
    }
    const world = await loadCatalogueWorld(context);
    for (const { key, value } of parseKeyedEntries(entries, "catalog_numbers", "catalogue", "Mi: 123a")) {
      const catalogVendorId = resolveAreaCatalogue(world, areaId, key, "catalog_numbers");
      const spec = parseCatalogNumberSpec(value);
      if (!("error" in spec) && spec.numbers.length > 1) {
        throw invalidRequest(
          `"catalog_numbers" entry "${key}: ${value}" is a run of ${spec.numbers.length} numbers, and a stamp has one number in each catalogue. Send its own number; new stamps are added with \`add_issue_stamps\`.`
        );
      }
      sent.push({ catalogVendorId, number: value });
      catalogNumbers.set(catalogVendorId, value);
    }
    const groups = await findCatalogDuplicatesForStamp(context.ownerId, context.collectionId, stamp.id, sent);
    if (groups.length > 0) throw duplicateCatalogNumbers(groups);
  }

  const restated = (field: "issued_year" | "issued_month" | "issued_day", current: number | null) =>
    cleared.has(field) ? null : (date[field] ?? current);
  // `updateStampWithCatalog` is the stamp form's write: the name, the date and every catalogue
  // number are written whatever it is handed, so each is restated; the attributes and the
  // translations take only what is sent.
  await updateStampWithCatalog(context.ownerId, stamp.id, {
    name: cleared.has("name") ? null : (name ?? stamp.name),
    issuedYear: restated("issued_year", stamp.issuedYear),
    issuedMonth: restated("issued_month", stamp.issuedMonth),
    issuedDay: restated("issued_day", stamp.issuedDay),
    catalogNumbers: [...catalogNumbers].map(([catalogVendorId, number]) => ({ catalogVendorId, number })),
    translations,
    ...attributes,
  });
  return readStamp(context, Object.freeze({ stamp_id: stamp.id }));
}

export const updateStampOperation: Operation = {
  name: "update_stamp",
  method: "PATCH",
  path: "/stamps/{stamp_id}",
  description:
    "Correct a stamp — or a variant — the way the collector's stamp form does: its name and translated names, its date of issue, its number in any catalogue its area keeps, and its catalogue attributes (denomination and perforation as printed; colour, watermark, paper and printing by name from `get_collection_vocabulary`). Only what is sent changes. A catalogue number another stamp already has is refused with that stamp. Nothing here deletes a stamp, moves it to another issue or parent, or reorders it; its size is `set_stamp_size`'s.",
  writes: true,
  parameters: [
    { name: "stamp_id", in: "path", type: "string", required: true, description: "The stamp's id, as `search_collection` or `resolve_catalog_numbers` reports it." },
    { name: "name", in: "body", type: "string", required: false, description: "The stamp's name in the collection's own language." },
    NAMES_PARAMETER,
    CLEAR_NAMES_PARAMETER,
    { name: "issued_year", in: "body", type: "integer", required: false, description: "The year of issue, 1840–2100." },
    { name: "issued_month", in: "body", type: "integer", required: false, description: "The month of issue, 1–12." },
    { name: "issued_day", in: "body", type: "integer", required: false, description: "The day of issue, 1–31." },
    catalogNumbersParameter(
      "The stamp's number in each catalogue named, `\"catalogue: number\"` — `[\"Mi: 123a\", \"Fi: 456\"]` — among the catalogues its area keeps. A catalogue not named keeps its number."
    ),
    { name: "denomination", in: "body", type: "string", required: false, description: "The face value as printed — `10 gr`, `1 zł`." },
    { name: "perforation", in: "body", type: "string", required: false, description: "The perforation as the catalogue writes it — `11½`, `11½:12`, `imperf`." },
    { name: "color", in: "body", type: "string", required: false, description: "The colour, by name or id from `colors` in the vocabulary." },
    { name: "watermark", in: "body", type: "string", required: false, description: "The watermark, by name or id from `watermarks` in the vocabulary." },
    { name: "paper", in: "body", type: "string", required: false, description: "The paper, by name or id from `papers` in the vocabulary." },
    { name: "printing", in: "body", type: "string", required: false, description: "The printing, by name or id from `printings` in the vocabulary." },
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: "Fields to empty — any of the accepted names.",
      values: STAMP_CLEARABLE,
    },
  ],
  result: { kind: "object", description: "The stamp as `get_stamp` now reads it." },
  handler: async (context, params) => updateStampFromParams(context, params),
};
