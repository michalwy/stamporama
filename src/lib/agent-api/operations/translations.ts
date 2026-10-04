import "server-only";
import { prisma } from "../../db";
import { albumTranslationGaps } from "../../album-editor";
import { getAlbums } from "../../albums";
import { areaSubtreeIds } from "../../areas";
import { getCollectionTranslationContext } from "../../contacts";
import { saveEntityTranslation } from "../../entity-translations";
import { TRANSLATABLE_ENTITY_FIELDS } from "../../translations";
import { invalidRequest } from "../errors";
import { listResponse, parseListWindow, type ListWindow } from "../list";
import { optionalBoolean, optionalString, requiredString, stringList } from "../params";
import {
  AREA_BOUND_KINDS,
  TRANSLATION_KINDS,
  checkCollectionLanguage,
  parseTranslationEntries,
  translationEntity,
  translationKey,
  translationTarget,
  unknownTranslationTargets,
  untranslatableTargets,
  type AgentMissingTranslation,
  type AgentTranslationWrite,
  type TranslationKind,
  type TranslationTarget,
} from "../translations";
import { resolveVocabularyValue } from "../vocabulary";
import { loadStampLabels } from "./stamp-refs";
import type { Operation, OperationContext, ParsedParams } from "../types";
import { includeSpecialisedParam, INCLUDE_SPECIALISED_PARAMETER } from "./checklist-type-params";
import { shownChecklistWhere } from "../../checklist-kind";

// Translating the collection's texts through the agent API (#1452): finding the texts a language is
// missing, and filling them.
//
// **Every text the app translates, through the path the app's in-place translation uses** — the
// title preview's and the album editor's gap editor (#299, #300, #1308) — so a translation written
// here is the row the collector's own dialogs write, read by every listing title and album page at
// once. `saveEntityTranslation` is that path; nothing here writes a translation row itself.
//
// **What is missing is what the app would fall back on**: a text with words in the collection's own
// language and no translation into the asked one. A checklist still named after its issue is not
// missing anything of its own — it prints the issue's translation (`checklist-name.ts`) — so the
// issue is what is listed. Narrowed to an album, the list is the album editor's own: the texts its
// live sheets would print untranslated, in the order the sheets reach them. A printed card is left
// out, as the editor leaves it out; a translation filled in since is reported on the card as a
// divergence (#778), and nothing here touches one.
//
// **A write fills gaps and keeps what is there** unless `replace` is sent, and then names the text it
// replaced — the protective default the size operations keep (#1415).

// -- Finding the gaps ----------------------------------------------------------------

interface Scope {
  readonly collectionId: string;
  readonly language: string;
  /** The area subtree to stay inside, or null for the whole collection. */
  readonly areaIds: readonly string[] | null;
  /** Whether specialised checklists are listed too (#1617). An album's own list ignores it: what an
   *  album prints is named by the album. */
  readonly includeSpecialised: boolean;
}

interface GapRow {
  readonly id: string;
  readonly text: string;
}

/** One kind and field of text the gaps are counted and paged over. */
interface GapSource {
  readonly kind: TranslationKind;
  /** The entity's column. */
  readonly field: string;
  count(scope: Scope): Promise<number>;
  page(scope: Scope, skip: number, take: number): Promise<GapRow[]>;
}

/** A filled translation column: not null and not blank. */
function filled(field: string) {
  return { AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }] };
}

/**
 * The part of a model delegate the gap sources use. Twelve delegates share the shape — a
 * `collectionId`, a `translations` relation, the translated columns — and Prisma types each one
 * separately, so the sources read them through this one shape rather than as twelve copies of the
 * same two queries. The `where` each builds is checked by the integration suite, not the compiler.
 */
interface TranslatableDelegate {
  count(args: { where: object }): Promise<number>;
  findMany(args: {
    where: object;
    select: object;
    orderBy: object[];
    skip: number;
    take: number;
  }): Promise<Record<string, unknown>[]>;
}

interface ColumnSpec {
  readonly delegate: TranslatableDelegate;
  /** Whether the entity's own column may be null — a stamp or an issue without a name. */
  readonly nullable: boolean;
  readonly orderBy: object[];
  /** Keeping to an area subtree, for the kinds that belong to one. */
  readonly inAreas?: (areaIds: readonly string[]) => object;
}

const byOrder = [{ sortOrder: "asc" }, { id: "asc" }];

function columnSpecs(): Record<Exclude<TranslationKind, "checklist">, ColumnSpec> {
  const d = (delegate: unknown) => delegate as TranslatableDelegate;
  return {
    area: {
      delegate: d(prisma.collectionArea),
      nullable: true,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      inAreas: (ids) => ({ id: { in: [...ids] } }),
    },
    issue: {
      delegate: d(prisma.issue),
      nullable: true,
      orderBy: [{ year: "asc" }, { primaryCatalogSortKey: "asc" }, { id: "asc" }],
      inAreas: (ids) => ({ collectionAreaId: { in: [...ids] } }),
    },
    stamp: {
      delegate: d(prisma.stamp),
      nullable: true,
      orderBy: [{ primaryCatalogSortKey: "asc" }, { id: "asc" }],
      inAreas: (ids) => ({ stampAreaLinks: { some: { collectionAreaId: { in: [...ids] } } } }),
    },
    condition: { delegate: d(prisma.stampCondition), nullable: false, orderBy: byOrder },
    certificate_status: { delegate: d(prisma.certificateStatus), nullable: false, orderBy: byOrder },
    format: { delegate: d(prisma.stampFormat), nullable: false, orderBy: byOrder },
    subtype: { delegate: d(prisma.stampSubtype), nullable: false, orderBy: byOrder },
    color: { delegate: d(prisma.stampColor), nullable: false, orderBy: byOrder },
    watermark: { delegate: d(prisma.stampWatermark), nullable: false, orderBy: byOrder },
    paper: { delegate: d(prisma.stampPaper), nullable: false, orderBy: byOrder },
    printing: { delegate: d(prisma.stampPrinting), nullable: false, orderBy: byOrder },
    fault: { delegate: d(prisma.fault), nullable: false, orderBy: byOrder },
  };
}

/** A column source: rows with words in the column and no filled translation of it. */
function columnSource(kind: Exclude<TranslationKind, "checklist">, field: string, spec: ColumnSpec): GapSource {
  const where = (scope: Scope) => ({
    collectionId: scope.collectionId,
    ...(spec.nullable ? filled(field) : { NOT: { [field]: "" } }),
    translations: { none: { language: scope.language, ...filled(field) } },
    ...(scope.areaIds && spec.inAreas ? spec.inAreas(scope.areaIds) : {}),
  });
  return {
    kind,
    field,
    count: (scope) => spec.delegate.count({ where: where(scope) }),
    page: async (scope, skip, take) => {
      const rows = await spec.delegate.findMany({
        where: where(scope),
        select: { id: true, [field]: true },
        orderBy: spec.orderBy,
        skip,
        take,
      });
      return rows.map((row) => ({ id: row.id as string, text: (row[field] as string).trim() }));
    },
  };
}

/**
 * The checklists named by hand without a translation. One still named after its issue follows the
 * issue's translation (`resolveChecklistName`), and a column cannot be compared with a column through
 * the query builder — so the few checklists a collection has are filtered here.
 */
async function handNamedChecklistGaps(scope: Scope): Promise<GapRow[]> {
  const rows = await prisma.checklist.findMany({
    where: {
      collectionId: scope.collectionId,
      translations: { none: { language: scope.language, ...filled("name") } },
      ...(scope.areaIds ? { issue: { collectionAreaId: { in: [...scope.areaIds] } } } : {}),
      ...shownChecklistWhere(scope.includeSpecialised),
    },
    select: { id: true, name: true, issue: { select: { name: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return rows
    .filter((row) => {
      const name = row.name.trim();
      return name !== "" && !(row.issue && row.issue.name?.trim() === name);
    })
    .map((row) => ({ id: row.id, text: row.name.trim() }));
}

const checklistSource: GapSource = {
  kind: "checklist",
  field: "name",
  count: async (scope) => (await handNamedChecklistGaps(scope)).length,
  page: async (scope, skip, take) => (await handNamedChecklistGaps(scope)).slice(skip, skip + take),
};

/** Every source, in `TRANSLATION_KINDS` order and each kind's fields in their form order. */
function gapSources(kinds: readonly TranslationKind[]): GapSource[] {
  const specs = columnSpecs();
  return kinds.flatMap((kind) =>
    kind === "checklist"
      ? [checklistSource]
      : entityFields(kind).map((field) => columnSource(kind, field, specs[kind]))
  );
}

/** The entity columns of a kind, in the form's order. */
function entityFields(kind: TranslationKind): readonly string[] {
  return TRANSLATABLE_ENTITY_FIELDS[translationEntity(kind)];
}

/** The window of gaps across the sources, and the full count. */
async function pageSources(
  sources: readonly GapSource[],
  scope: Scope,
  window: ListWindow
): Promise<{ targets: { target: TranslationTarget; text: string }[]; total: number }> {
  const counts = await Promise.all(sources.map((source) => source.count(scope)));
  const targets: { target: TranslationTarget; text: string }[] = [];
  let skip = window.offset;
  let room = window.limit;
  for (const [i, source] of sources.entries()) {
    const n = counts[i];
    if (room > 0 && skip < n) {
      const rows = await source.page(scope, skip, Math.min(room, n - skip));
      for (const row of rows) {
        targets.push({ target: translationTarget(translationEntity(source.kind), source.field, row.id), text: row.text });
      }
      room -= rows.length;
    }
    skip = Math.max(0, skip - n);
  }
  return { targets, total: counts.reduce((a, b) => a + b, 0) };
}

// -- What a text belongs to -----------------------------------------------------------

function yearly(name: string | null | undefined, year: number | null | undefined): string {
  return [name?.trim(), year].filter((part) => part !== undefined && part !== null && part !== "").join(", ");
}

/** A short phrase saying what each text belongs to, by `kind:id`, for the kinds the kind alone does
 *  not place. The collection's own terms get none. */
async function loadBelongings(
  context: OperationContext,
  targets: readonly TranslationTarget[]
): Promise<Map<string, string>> {
  const ids = (kind: TranslationKind) => [...new Set(targets.filter((t) => t.kind === kind).map((t) => t.id))];
  const out = new Map<string, string>();
  const put = (kind: TranslationKind, id: string, value: string) => {
    if (value) out.set(`${kind}:${id}`, value);
  };

  const stampIds = ids("stamp");
  const [stamps, stampLabels, issues, areas, checklists] = await Promise.all([
    stampIds.length === 0
      ? []
      : prisma.stamp.findMany({
          where: { id: { in: stampIds }, collectionId: context.collectionId },
          select: {
            id: true,
            issueMemberships: {
              select: { issue: { select: { name: true, year: true } } },
              orderBy: { issueId: "asc" },
              take: 1,
            },
          },
        }),
    loadStampLabels(context, stampIds),
    prisma.issue.findMany({
      where: { id: { in: ids("issue") }, collectionId: context.collectionId },
      select: { id: true, year: true, collectionArea: { select: { name: true } } },
    }),
    prisma.collectionArea.findMany({
      where: { id: { in: ids("area") }, collectionId: context.collectionId },
      select: { id: true, parent: { select: { name: true } } },
    }),
    prisma.checklist.findMany({
      where: { id: { in: ids("checklist") }, collectionId: context.collectionId },
      select: { id: true, issue: { select: { name: true, year: true } } },
    }),
  ]);
  for (const stamp of stamps) {
    const numbers = stampLabels.get(stamp.id)?.catalogNumbers.join(", ") ?? "";
    const issue = stamp.issueMemberships[0]?.issue;
    const series = issue ? yearly(issue.name, issue.year) : "";
    put("stamp", stamp.id, [numbers, series && `in ${series}`].filter(Boolean).join(" "));
  }
  for (const issue of issues) put("issue", issue.id, yearly(issue.collectionArea.name, issue.year));
  for (const area of areas) if (area.parent) put("area", area.id, `under ${area.parent.name}`);
  for (const checklist of checklists) {
    if (checklist.issue) put("checklist", checklist.id, `of ${yearly(checklist.issue.name, checklist.issue.year)}`);
  }
  return out;
}

async function describe(
  context: OperationContext,
  rows: readonly { target: TranslationTarget; text: string }[]
): Promise<AgentMissingTranslation[]> {
  const belongings = await loadBelongings(context, rows.map((row) => row.target));
  return rows.map(({ target, text }) => {
    const belongsTo = belongings.get(`${target.kind}:${target.id}`);
    return {
      key: translationKey(target),
      kind: target.kind,
      field: target.field,
      text,
      ...(belongsTo ? { belongsTo } : {}),
    };
  });
}

async function collectionLanguage(context: OperationContext, raw: string): Promise<string> {
  const { titleLanguages, defaultLanguage } = await getCollectionTranslationContext(
    context.ownerId,
    context.collectionId
  );
  return checkCollectionLanguage(raw, titleLanguages, defaultLanguage);
}

async function findMissing(context: OperationContext, params: ParsedParams) {
  const window = parseListWindow(params);
  const language = await collectionLanguage(context, requiredString(params, "language"));
  const kind = optionalString(params, "kind") as TranslationKind | null;
  const area = optionalString(params, "area");
  const album = optionalString(params, "album");
  if (area !== null && album !== null) {
    throw invalidRequest(
      'Send "area" or "album", not both: an album already keeps to its own area, and lists what its pages print.',
      ["area", "album"]
    );
  }

  if (album !== null) {
    const albums = await getAlbums(context.ownerId, context.collectionId);
    const albumId = resolveVocabularyValue(album, albums, { vocabulary: "album", parameter: "album" });
    const found = await albumTranslationGaps(context.ownerId, albumId);
    if (!found) throw invalidRequest(`No album "${album}" in this collection.`);
    if (found.language !== language) {
      throw invalidRequest(
        `That album prints in "${found.language}", so the texts it is missing are missing in that language. Ask with "language": "${found.language}".`,
        [found.language]
      );
    }
    const gaps = found.gaps
      .map((gap) => ({ target: translationTarget(gap.entityType, gap.entityField, gap.entityId), text: gap.defaultValue }))
      .filter((gap) => kind === null || gap.target.kind === kind);
    const slice = gaps.slice(window.offset, window.offset + window.limit);
    return listResponse(await describe(context, slice), gaps.length, window);
  }

  let areaIds: string[] | null = null;
  if (area !== null) {
    if (kind !== null && !AREA_BOUND_KINDS.has(kind)) {
      throw invalidRequest(
        `A ${kind.replace("_", " ")} belongs to no area — it is one of the collection's own terms. Drop "area", or ask for a kind that belongs to one.`,
        [...AREA_BOUND_KINDS]
      );
    }
    const areas = await prisma.collectionArea.findMany({
      where: { collectionId: context.collectionId },
      select: { id: true, name: true, titleName: true },
    });
    const areaId = resolveVocabularyValue(
      area,
      areas.map((row) => ({ id: row.id, name: row.name, ...(row.titleName ? { label: row.titleName } : {}) })),
      { vocabulary: "area", parameter: "area" }
    );
    areaIds = await areaSubtreeIds(context.collectionId, areaId);
  }

  const kinds = kind !== null ? [kind] : TRANSLATION_KINDS.filter((k) => areaIds === null || AREA_BOUND_KINDS.has(k));
  const { targets, total } = await pageSources(
    gapSources(kinds),
    {
      collectionId: context.collectionId,
      language,
      areaIds,
      includeSpecialised: includeSpecialisedParam(params),
    },
    window
  );
  return listResponse(await describe(context, targets), total, window);
}

export const findMissingTranslationsOperation: Operation = {
  name: "find_missing_translations",
  method: "GET",
  path: "/translations/missing",
  description:
    "The collection's texts that have no translation into a language it lists or prints in — area, issue, checklist and stamp names, and the names and abbreviations of its conditions, certificates, formats, subtypes, colours, watermarks, papers and printing methods, and the names of the faults a copy can carry. Until a translation exists, a listing title, an offer's description or an album page in that language prints the text in the collection's own language, and a printed album card keeps it for good. Each row carries the `key` to send to `set_translations`, the text to translate, and what it belongs to. Narrow it to one `kind`, to an `area` and every area under it, or to an `album`, which lists exactly what that album's unprinted pages would print untranslated, in page order.",
  writes: false,
  parameters: [
    {
      name: "language",
      in: "query",
      type: "string",
      required: true,
      description:
        "The language code to find missing translations for, such as `de` — one the collection lists or prints in, other than its own.",
    },
    {
      name: "kind",
      in: "query",
      type: "string",
      required: false,
      values: TRANSLATION_KINDS,
      description: "Only this kind of text.",
    },
    {
      name: "area",
      in: "query",
      type: "string",
      required: false,
      description:
        "Only area, issue, checklist and stamp names in this area and every area nested under it. Takes the area's name from `get_collection_vocabulary` or its id.",
    },
    {
      name: "album",
      in: "query",
      type: "string",
      required: false,
      description:
        "Only what this album's pages not yet printed would print untranslated. Takes the album's name or id; `language` must be the album's own.",
    },
    {
      ...INCLUDE_SPECIALISED_PARAMETER,
      description:
        "true to list specialised checklists' names too. Left out, only standard checklists are listed, as the app shows them by default; an `album` lists what it prints whatever its type.",
    },
  ],
  result: {
    kind: "list",
    description:
      "One row per text: `key`, `kind`, `field` (`name`, `abbreviation`, or `title_name` for an area's public name), `text` in the collection's own language, and `belongsTo` — a stamp's catalogue numbers and issue, an issue's area and year, an area's parent — where the kind alone does not place it.",
  },
  handler: async (context, params) => findMissing(context, params),
};

// -- Writing them ---------------------------------------------------------------------

/** Each target's own text and its current translation, by key — or refusals for keys naming nothing. */
async function loadTargets(
  context: OperationContext,
  language: string,
  targets: readonly TranslationTarget[]
): Promise<Map<string, { text: string; current: string | null }>> {
  const specs = columnSpecs();
  const out = new Map<string, { text: string; current: string | null }>();
  const byKind = new Map<TranslationKind, TranslationTarget[]>();
  for (const target of targets) byKind.set(target.kind, [...(byKind.get(target.kind) ?? []), target]);

  for (const [kind, group] of byKind) {
    const fields = entityFields(kind);
    const where = { id: { in: group.map((t) => t.id) }, collectionId: context.collectionId };
    const select = {
      id: true,
      ...Object.fromEntries(fields.map((f) => [f, true])),
      translations: { where: { language }, select: Object.fromEntries(fields.map((f) => [f, true])) },
    };
    const rows =
      kind === "checklist"
        ? await prisma.checklist.findMany({ where, select: { id: true, name: true, translations: { where: { language }, select: { name: true } } } })
        : await specs[kind].delegate.findMany({ where, select, orderBy: [{ id: "asc" }], skip: 0, take: group.length });
    const byId = new Map(rows.map((row) => [row.id as string, row as Record<string, unknown>]));
    for (const target of group) {
      const row = byId.get(target.id);
      if (!row) continue;
      const translation = (row.translations as Record<string, string | null>[])[0];
      out.set(translationKey(target), {
        text: ((row[target.entityField] as string | null) ?? "").trim(),
        current: translation?.[target.entityField]?.trim() || null,
      });
    }
  }
  return out;
}

async function writeTranslations(context: OperationContext, params: ParsedParams): Promise<AgentTranslationWrite> {
  const language = await collectionLanguage(context, requiredString(params, "language"));
  const entries = parseTranslationEntries(stringList(params, "translations"), "translations");
  const replace = optionalBoolean(params, "replace") ?? false;

  const found = await loadTargets(context, language, entries.map((entry) => entry.target));
  const unknown = entries.filter((entry) => !found.has(entry.key)).map((entry) => entry.key);
  if (unknown.length > 0) throw unknownTranslationTargets(unknown);
  const empty = entries.filter((entry) => found.get(entry.key)!.text === "").map((entry) => entry.key);
  if (empty.length > 0) throw untranslatableTargets(empty);

  const written: { key: string; text: string; replaced?: string }[] = [];
  const kept: { key: string; current: string }[] = [];
  for (const entry of entries) {
    const { current } = found.get(entry.key)!;
    if (current !== null && (!replace || current === entry.text)) {
      kept.push({ key: entry.key, current });
      continue;
    }
    await saveEntityTranslation(context.ownerId, context.collectionId, {
      entityType: entry.target.entityType,
      entityId: entry.target.id,
      entityField: entry.target.entityField,
      language,
      value: entry.text,
    });
    written.push({ key: entry.key, text: entry.text, ...(current !== null ? { replaced: current } : {}) });
  }
  return { language, written, kept };
}

export const setTranslationsOperation: Operation = {
  name: "set_translations",
  method: "POST",
  path: "/translations",
  description:
    "Write translations of the collection's texts into one language, each named by the `key` `find_missing_translations` returned. They are the collector's own translations from then on: every listing title and album page in that language prints them, and the collector reviews them where they are shown. A text that already has a translation is kept as it is unless `replace` is sent, and the answer names every text kept and every translation replaced. An album card already printed is never changed; the album reports the new wording on it as a difference to look at. Every entry is checked before anything is written.",
  writes: true,
  parameters: [
    {
      name: "language",
      in: "body",
      type: "string",
      required: true,
      description: "The language code the translations are in, such as `de` — one the collection lists or prints in, other than its own.",
    },
    {
      name: "translations",
      in: "body",
      type: "string[]",
      required: true,
      description:
        "One `\"key: translation\"` entry per text, at most 100 — `\"issue.name.<id>: Freimarken\"`. Split on the first colon, so a translation may carry colons of its own.",
    },
    {
      name: "replace",
      in: "body",
      type: "boolean",
      required: false,
      description:
        "True to replace translations that already exist. Without it they are kept, and listed as kept.",
    },
  ],
  result: {
    kind: "object",
    description:
      "`written` lists each text written, with `replaced` carrying the translation it replaced; `kept` lists each text that already had a translation and was left as it was, with that translation as `current`.",
  },
  handler: async (context, params) => writeTranslations(context, params),
};
