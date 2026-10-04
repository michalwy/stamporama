import "server-only";
import { prisma } from "../../db";
import { getStampConditions } from "../../conditions";
import { getCertificateStatuses } from "../../certificate-statuses";
import { getStampFormats } from "../../stamp-formats";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "../../variant-classification";
import { variantPriceCellKey } from "../../variant-price-cells";
import { getVariantPriceGrid, readAreaEditions, setVariantCatalogPrice } from "../../variant-prices";
import { invalidRequest, isApiError, notFound } from "../errors";
import { listResponse, parseListWindow } from "../list";
import { optionalString, requiredString, stringList } from "../params";
import {
  agentEdition,
  catalogPriceCells,
  checkCellCount,
  parseCellPrice,
  parseCellSpec,
  resolveAxisValue,
  resolveEdition,
  summarizeCells,
  unresolvedStampReason,
  type AgentCatalogEdition,
  type AgentPriceCellAnswer,
  type AgentPriceWrite,
  type CellSpec,
  type EditionSource,
} from "../catalog-prices";
import { resolveVocabularyValue, type VocabularyEntry } from "../vocabulary";
import { catalogPriceMarkOf, type CatalogPriceMark } from "../../catalog-price-mark";
import { resolveCatalogStrings } from "./catalog";
import { loadStampLabels, resolveStampRefs } from "./stamp-refs";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// Catalogue prices through the agent API (#1540): the editions a price can be recorded in, an issue's
// or a stamp tree's prices in one read, and many cells set or cleared in one write.
//
// **The variant price grid's read and the grid's write, and nothing beside them** (#618).
// `getVariantPriceGrid` is the read — the tree, its dictionaries, every price on it and the format
// multipliers — and `setVariantCatalogPrice` is the write, one cell at a time, a null amount clearing
// it exactly as an emptied cell does. The same validation, the same rounding, the currency taken from
// the edition's book and never from the caller, and so the same effect on valuation: nothing here
// writes a `StampCatalogPrice` row itself, and nothing is filled or derived on a write — a format
// multiplier or a certificate percentage the grid offers as a fill is a figure an assistant sends as
// a price if it wants one.
//
// **Clearing a price is the one catalogue delete this surface makes** — the collector's decision on
// #1540, amending #1438's *nothing is deleted*. It goes through the grid's own write, which takes a
// cell's row away and nothing else; every other delete stays out (`CATALOG_BOUNDARY`).

// -- The editions ------------------------------------------------------------------------

/** Every edition of every book the collection keeps, as {@link EditionSource}s. */
async function loadEditions(context: OperationContext): Promise<EditionSource[]> {
  const rows = await prisma.catalogEdition.findMany({
    where: { catalogName: { vendor: { collectionId: context.collectionId } } },
    select: {
      id: true,
      year: true,
      catalogName: { select: { name: true, currency: true, vendor: { select: { abbreviation: true } } } },
    },
  });
  return rows
    .map((row) => ({
      id: row.id,
      catalogName: row.catalogName.name,
      vendorAbbreviation: row.catalogName.vendor.abbreviation,
      year: row.year,
      currency: row.catalogName.currency,
    }))
    .sort(
      (a, b) =>
        a.vendorAbbreviation.localeCompare(b.vendorAbbreviation) ||
        a.catalogName.localeCompare(b.catalogName) ||
        b.year - a.year
    );
}

async function areaEntries(context: OperationContext): Promise<VocabularyEntry[]> {
  const areas = await prisma.collectionArea.findMany({
    where: { collectionId: context.collectionId },
    select: { id: true, name: true, titleName: true },
  });
  return areas.map((row) => ({ id: row.id, name: row.name, ...(row.titleName ? { label: row.titleName } : {}) }));
}

async function listEditions(context: OperationContext, params: ParsedParams) {
  const window = parseListWindow(params);
  const area = optionalString(params, "area");
  let editions: AgentCatalogEdition[];
  if (area === null) {
    editions = (await loadEditions(context)).map((edition) => agentEdition(edition));
  } else {
    const areaId = resolveVocabularyValue(area, await areaEntries(context), { vocabulary: "area", parameter: "area" });
    // The grid's own list for the area: its effective books, the primary first (#675).
    editions = (await readAreaEditions(context.collectionId, areaId)).map((edition) =>
      agentEdition(
        {
          id: edition.editionId,
          catalogName: edition.catalogLabel,
          vendorAbbreviation: edition.vendorAbbreviation,
          year: edition.year,
          currency: edition.currency,
        },
        edition.isPrimary
      )
    );
  }
  return listResponse(editions.slice(window.offset, window.offset + window.limit), editions.length, window);
}

export const listCatalogEditionsOperation: Operation = {
  name: "list_catalog_editions",
  method: "GET",
  path: "/catalog-editions",
  description:
    "The catalogue editions this collection records prices in — each a book and a year, with the currency its prices are stated in. A catalogue price always belongs to one edition, so this is how to name the edition a printed page comes from. Narrowed to an `area`, it lists the editions the variant price grid offers there: the area's own catalogues, or the nearest parent area's, the primary one first.",
  writes: false,
  parameters: [
    {
      name: "area",
      in: "query",
      type: "string",
      required: false,
      description:
        "Only the editions of the catalogues this area prices in. Takes the area's name from `get_collection_vocabulary` or its id.",
    },
  ],
  result: {
    kind: "list",
    description:
      "One row per edition: `id`, `name` (the book and the year, which is what `edition` takes, as is `\"<vendor> <year>\"` where the vendor has one book), `catalog`, `vendor`, `year`, `currency`, and `primary` on the area's primary catalogue when an area was asked about.",
  },
  handler: async (context, params) => listEditions(context, params),
};

// -- Reading prices ----------------------------------------------------------------------

/** The dictionaries a cell is named in, by id and as entries the resolver takes. */
export interface Axes {
  readonly conditions: VocabularyEntry[];
  readonly certificates: VocabularyEntry[];
  readonly formats: VocabularyEntry[];
}

export async function loadAxes(context: OperationContext): Promise<Axes> {
  const [conditions, certificates, formats] = await Promise.all([
    getStampConditions(context.ownerId, context.collectionId),
    getCertificateStatuses(context.ownerId, context.collectionId),
    getStampFormats(context.ownerId, context.collectionId),
  ]);
  const entries = (rows: { id: string; name: string; abbreviation: string }[]) =>
    rows.map((row) => ({ id: row.id, name: row.name, ...(row.abbreviation ? { abbreviation: row.abbreviation } : {}) }));
  return { conditions: entries(conditions), certificates: entries(certificates), formats: entries(formats) };
}

/** One figure of a stamp, as the agent reads it. */
export interface AgentCatalogPrice {
  readonly edition: string;
  readonly condition: string;
  /** Absent for *no certificate*. */
  readonly certificate?: string;
  /** Absent for *single*. */
  readonly format?: string;
  /** The figure; absent when the cell is a {@link mark}. */
  readonly amount?: string;
  /** The catalogue gives no price here (#1615): `nonexistent` (it prints —) or `undeterminable` (?). */
  readonly mark?: CatalogPriceMark;
  readonly currency: string;
  /** An umbrella's lowest-variant figure, computed and not recorded (#238). */
  readonly rolledUp?: true;
  /** The single's price times this format's multiplier, computed and not recorded (ADR-0020 §5). */
  readonly derived?: true;
}

/** One stamp of the tree, with its figures. */
export interface AgentCatalogPriceRow {
  readonly stampId: string;
  readonly stampNo: number;
  /** The stamp's leading catalogue number with its prefix, else its name. */
  readonly label: string;
  readonly name?: string;
  /** How deep in the tree it hangs — 0 for a root of what was read. */
  readonly depth: number;
  /** Has variants under it: its value is the lowest of theirs unless a price is recorded on it. */
  readonly umbrella?: true;
  readonly prices: readonly AgentCatalogPrice[];
}

async function readPrices(context: OperationContext, params: ParsedParams) {
  const window = parseListWindow(params);
  const issue = optionalString(params, "issue");
  const stamp = optionalString(params, "stamp");
  if ((issue === null) === (stamp === null)) {
    throw invalidRequest(
      'Send "issue" or "stamp", one of them: an issue reads every stamp of it, a stamp reads the whole tree it hangs in.',
      ["issue", "stamp"]
    );
  }

  let grid;
  if (issue !== null) {
    const found = await prisma.issue.findFirst({
      where: { id: issue.trim(), collectionId: context.collectionId },
      select: { id: true },
    });
    if (!found) throw notFound(`No issue "${issue}" in this collection. Send an issue's id — \`search_collection\` finds one.`);
    grid = await getVariantPriceGrid(context.ownerId, { kind: "issue", issueId: found.id });
  } else {
    const [stampId] = await resolveStampRefs(context, [stamp!], "stamp");
    grid = await getVariantPriceGrid(context.ownerId, { kind: "stamp", stampId });
  }

  const [editions, axes] = await Promise.all([loadEditions(context), loadAxes(context)]);
  const editionById = new Map(editions.map((edition) => [edition.id, agentEdition(edition)]));
  const editionFilter = optionalString(params, "edition");
  const conditionFilter = optionalString(params, "condition");
  const certificateFilter = optionalString(params, "certificate");
  const formatFilter = optionalString(params, "format");
  const wantEdition = editionFilter === null ? undefined : resolveEdition(editionFilter, editions, "edition").id;
  const wantCondition =
    conditionFilter === null
      ? undefined
      : resolveVocabularyValue(conditionFilter, axes.conditions, { vocabulary: "condition", parameter: "condition" });
  const wantCertificate =
    certificateFilter === null
      ? undefined
      : resolveAxisValue(certificateFilter, axes.certificates, "none", { vocabulary: "certificate status", parameter: "certificate" });
  const wantFormat =
    formatFilter === null
      ? undefined
      : resolveAxisValue(formatFilter, axes.formats, "single", { vocabulary: "format", parameter: "format" });

  const nameOf = (entries: VocabularyEntry[], id: string) => entries.find((entry) => entry.id === id)?.name ?? id;
  const conditionRank = new Map(axes.conditions.map((entry, i) => [entry.id, i]));
  const editionRank = new Map(editions.map((edition, i) => [edition.id, i]));

  const cells = catalogPriceCells({ rows: grid.rows, prices: grid.prices, factors: grid.formatFactors }).filter(
    (cell) =>
      (wantEdition === undefined || cell.catalogEditionId === wantEdition) &&
      (wantCondition === undefined || cell.conditionId === wantCondition) &&
      (wantCertificate === undefined || cell.certificateStatusId === wantCertificate) &&
      (wantFormat === undefined || cell.formatId === wantFormat)
  );
  cells.sort(
    (a, b) =>
      (editionRank.get(a.catalogEditionId) ?? 0) - (editionRank.get(b.catalogEditionId) ?? 0) ||
      (a.certificateStatusId ?? "").localeCompare(b.certificateStatusId ?? "") ||
      (a.formatId ?? "").localeCompare(b.formatId ?? "") ||
      (conditionRank.get(a.conditionId) ?? 0) - (conditionRank.get(b.conditionId) ?? 0)
  );
  const byStamp = new Map<string, AgentCatalogPrice[]>();
  for (const cell of cells) {
    const edition = editionById.get(cell.catalogEditionId);
    const price: AgentCatalogPrice = {
      edition: edition?.name ?? cell.catalogEditionId,
      condition: nameOf(axes.conditions, cell.conditionId),
      ...(cell.certificateStatusId ? { certificate: nameOf(axes.certificates, cell.certificateStatusId) } : {}),
      ...(cell.formatId ? { format: nameOf(axes.formats, cell.formatId) } : {}),
      ...(cell.mark ? { mark: cell.mark } : { amount: cell.amount }),
      currency: edition?.currency ?? "",
      ...(cell.source === "rolled_up" ? { rolledUp: true as const } : {}),
      ...(cell.source === "derived" ? { derived: true as const } : {}),
    };
    byStamp.set(cell.stampId, [...(byStamp.get(cell.stampId) ?? []), price]);
  }

  // The grid is the screen's and carries no short numbers; they are read here, for this answer only.
  const stampNos = new Map(
    (
      await prisma.stamp.findMany({
        where: { id: { in: grid.rows.map((row) => row.stampId) }, collectionId: context.collectionId },
        select: { id: true, stampNo: true },
      })
    ).map((row) => [row.id, row.stampNo])
  );
  const rows: AgentCatalogPriceRow[] = grid.rows.map((row) => ({
    stampId: row.stampId,
    stampNo: stampNos.get(row.stampId)!,
    label: row.label,
    ...(row.name ? { name: row.name } : {}),
    depth: row.depth,
    ...(!row.identified ? { umbrella: true as const } : {}),
    prices: byStamp.get(row.stampId) ?? [],
  }));
  return listResponse(rows.slice(window.offset, window.offset + window.limit), rows.length, window);
}

const CELL_AXIS_PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "edition",
    in: "query",
    type: "string",
    required: false,
    description: "Only prices in this edition — its name from `list_catalog_editions`, such as `Michel Polen 2024`, or its id.",
  },
  {
    name: "condition",
    in: "query",
    type: "string",
    required: false,
    description: "Only prices at this condition, by name, abbreviation or id.",
  },
  {
    name: "certificate",
    in: "query",
    type: "string",
    required: false,
    description: "Only prices for this certificate status; `none` for prices of a piece without one.",
  },
  {
    name: "format",
    in: "query",
    type: "string",
    required: false,
    description: "Only prices for this format; `single` for a single stamp.",
  },
];

export const getCatalogPricesOperation: Operation = {
  name: "get_catalog_prices",
  method: "GET",
  path: "/catalog-prices",
  description:
    "The catalogue prices of an issue's stamps, or of the whole stamp tree a stamp hangs in — the variant price grid, read in one call. Each stamp comes in tree order with its depth, and every price recorded on it in every edition, condition, certificate and format. A stamp marked `umbrella` has variants under it: with no price of its own it is worth the lowest of its variants', reported `rolledUp`; a price recorded on it outranks that. On a format, an empty cell may be the single's price times the format's multiplier, reported `derived`. Neither is recorded — `set_catalog_prices` records a figure. A cell where the catalogue gives no price on purpose carries a `mark` instead of an `amount`: `nonexistent` where it prints — (the stamp does not exist in that condition), `undeterminable` where it prints ?. Such a cell is not missing a price; an umbrella none of whose variants is priced, and all of them marked, reports their mark rolled up. Narrow by edition, condition, certificate or format.",
  writes: false,
  parameters: [
    {
      name: "issue",
      in: "query",
      type: "string",
      required: false,
      description: "The issue whose stamps to read, by id. Send this or `stamp`.",
    },
    {
      name: "stamp",
      in: "query",
      type: "string",
      required: false,
      description:
        "A stamp of the tree to read, by id, by its short number (`st 123`) or by a catalogue number that names only it, such as `Mi 309AP`; the whole tree it hangs in is read. Send this or `issue`.",
    },
    ...CELL_AXIS_PARAMETERS,
  ],
  result: {
    kind: "list",
    description:
      "One row per stamp of the tree: `stampId`, `stampNo` (its short number), `label`, `name`, `depth`, `umbrella` where it has variants, and `prices` — each with `edition`, `condition`, `certificate` and `format` (absent for none and single), `amount` and `currency` — or `mark` (`nonexistent`, `undeterminable`) in place of `amount` where the catalogue gives no price — and `rolledUp` or `derived` on a figure computed rather than recorded. A stamp with nothing recorded has empty `prices`.",
  },
  handler: async (context, params) => readPrices(context, params),
};

// -- Setting and clearing them -----------------------------------------------------------

/** A cell resolved to its axes, or refused. */
type Resolved =
  | {
      readonly ok: true;
      readonly stampId: string;
      readonly conditionId: string;
      readonly certificateStatusId: string | null;
      readonly formatId: string | null;
      /** On a set: the figure, rounded as it will be stored, or a mark (#1615) named by `text`. */
      readonly amount: { value: number | CatalogPriceMark; text: string } | null;
    }
  | { readonly ok: false; readonly reason: string };

/** Every cell's `stamp`, resolved once for the batch: an id here, or a number naming only one stamp. */
async function resolveCellStamps(
  context: OperationContext,
  refs: readonly string[]
): Promise<Map<string, { stampId: string } | { reason: string }>> {
  const wanted = [...new Set(refs)];
  const byId = await prisma.stamp.findMany({
    where: { id: { in: wanted }, collectionId: context.collectionId },
    select: { id: true },
  });
  const ids = new Set(byId.map((stamp) => stamp.id));
  const numbers = wanted.filter((ref) => !ids.has(ref));
  const resolutions = await resolveCatalogStrings(context, numbers);
  const out = new Map<string, { stampId: string } | { reason: string }>();
  for (const id of ids) out.set(id, { stampId: id });
  numbers.forEach((ref, i) => {
    const resolution = resolutions[i];
    out.set(
      ref,
      resolution.verdict === "resolved" ? { stampId: resolution.stamps[0].stampId } : { reason: unresolvedStampReason(resolution) }
    );
  });
  return out;
}

/** A vocabulary refusal's sentence, for a cell — the call's refusals become the cell's reason. */
function reasonOf(err: unknown): string {
  if (isApiError(err)) {
    const accepted = err.accepted && err.accepted.length > 0 ? ` Accepted: ${err.accepted.join(", ")}.` : "";
    return `${err.message}${accepted}`;
  }
  throw err;
}

async function writeCells(context: OperationContext, params: ParsedParams, mode: "set" | "clear"): Promise<AgentPriceWrite> {
  const parameter = mode === "set" ? "prices" : "cells";
  const entries = stringList(params, parameter);
  checkCellCount(entries, parameter);
  const editions = await loadEditions(context);
  const editionSource = resolveEdition(requiredString(params, "edition"), editions, "edition");
  const edition = agentEdition(editionSource);
  const axes = await loadAxes(context);

  const parsed = entries.map((entry) => parseCellSpec(entry, mode));
  const specs = parsed.filter((p): p is { ok: true; cell: CellSpec } => p.ok).map((p) => p.cell);
  const stamps = await resolveCellStamps(context, specs.map((cell) => cell.stamp.trim()));

  const resolved: Resolved[] = parsed.map((p) => {
    if (!p.ok) return { ok: false, reason: p.reason };
    const stamp = stamps.get(p.cell.stamp.trim())!;
    if ("reason" in stamp) return { ok: false, reason: stamp.reason };
    try {
      const conditionId = resolveVocabularyValue(p.cell.condition, axes.conditions, { vocabulary: "condition", parameter: "condition" });
      const certificateStatusId = resolveAxisValue(p.cell.certificate, axes.certificates, "none", {
        vocabulary: "certificate status",
        parameter: "certificate",
      });
      const formatId = resolveAxisValue(p.cell.format, axes.formats, "single", { vocabulary: "format", parameter: "format" });
      let amount: { value: number | CatalogPriceMark; text: string } | null = null;
      if (p.cell.price !== null) {
        const price = parseCellPrice(p.cell.price);
        if (!price.ok) return { ok: false, reason: price.reason };
        amount = { value: price.amount, text: price.text };
      }
      return { ok: true, stampId: stamp.stampId, conditionId, certificateStatusId, formatId, amount };
    } catch (err) {
      return { ok: false, reason: reasonOf(err) };
    }
  });

  const stampIds = [...new Set(resolved.flatMap((r) => (r.ok ? [r.stampId] : [])))];
  const [existing, labels, flags] = await Promise.all([
    prisma.stampCatalogPrice.findMany({
      where: { stampId: { in: stampIds }, catalogEditionId: editionSource.id },
      select: { stampId: true, conditionId: true, certificateStatusId: true, formatId: true, price: true, mark: true },
    }),
    loadStampLabels(context, stampIds),
    prisma.stamp.findMany({
      where: { id: { in: stampIds }, collectionId: context.collectionId },
      select: { id: true, ...VARIANT_FLAG_SELECT, variants: { select: VARIANT_FLAG_SELECT } },
    }),
  ]);
  const current = new Map(
    existing.map((row) => [
      variantPriceCellKey(row.stampId, editionSource.id, row.conditionId, row.certificateStatusId, row.formatId),
      // A mark compares by its name, which is what `parseCellPrice` gives a mark sent back (#1615).
      catalogPriceMarkOf(row.mark) ?? row.price?.toFixed(2) ?? "",
    ])
  );
  const umbrellas = new Set(flags.filter((stamp) => isUnknownVariantStamp(stamp)).map((stamp) => stamp.id));
  const nameOf = (entries: VocabularyEntry[], id: string) => entries.find((entry) => entry.id === id)?.name ?? id;

  const seen = new Map<string, number>();
  const answers: AgentPriceCellAnswer[] = [];
  for (const [i, cell] of resolved.entries()) {
    const entry = entries[i];
    if (!cell.ok) {
      answers.push({ entry, outcome: "refused", reason: cell.reason });
      continue;
    }
    const named = {
      stampId: cell.stampId,
      stamp: labels.get(cell.stampId)?.catalogNumbers[0] ?? labels.get(cell.stampId)?.name ?? cell.stampId,
      condition: nameOf(axes.conditions, cell.conditionId),
      ...(cell.certificateStatusId ? { certificate: nameOf(axes.certificates, cell.certificateStatusId) } : {}),
      ...(cell.formatId ? { format: nameOf(axes.formats, cell.formatId) } : {}),
      ...(umbrellas.has(cell.stampId) ? { umbrella: true as const } : {}),
    };
    const key = variantPriceCellKey(cell.stampId, editionSource.id, cell.conditionId, cell.certificateStatusId, cell.formatId);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      answers.push({
        entry,
        outcome: "refused",
        ...named,
        reason: `It names the same cell as entry ${earlier + 1}, which was answered first. Send each cell once.`,
      });
      continue;
    }
    seen.set(key, i);

    const before = current.get(key);
    const after = cell.amount?.text;
    /** What the cell holds afterwards, as the answer names it: a figure or a mark. */
    const holds = (text: string | undefined) => {
      if (text === undefined) return {};
      const mark = catalogPriceMarkOf(text);
      return mark ? { mark } : { amount: text };
    };
    if (before === after) {
      answers.push({ entry, outcome: "unchanged", ...named, ...holds(after) });
      continue;
    }
    try {
      await setVariantCatalogPrice(context.ownerId, {
        stampId: cell.stampId,
        catalogEditionId: editionSource.id,
        conditionId: cell.conditionId,
        certificateStatusId: cell.certificateStatusId,
        formatId: cell.formatId,
        amount: cell.amount?.value ?? null,
      });
    } catch {
      answers.push({ entry, outcome: "refused", ...named, reason: "The price could not be saved. Nothing changed in this cell." });
      continue;
    }
    if (after !== undefined) current.set(key, after);
    else current.delete(key);
    answers.push({
      entry,
      outcome: after !== undefined ? "written" : "cleared",
      ...named,
      ...holds(after),
      ...(before !== undefined ? { replaced: before } : {}),
    });
  }
  return summarizeCells(edition, answers);
}

const EDITION_PARAMETER: ParameterSpec = {
  name: "edition",
  in: "body",
  type: "string",
  required: true,
  description:
    "The edition every cell is in — the edition the page comes from, by its name from `list_catalog_editions` (`Michel Polen 2024`, or `Mi 2024` where the vendor has one book) or its id.",
};

export const setCatalogPricesOperation: Operation = {
  name: "set_catalog_prices",
  method: "POST",
  path: "/catalog-prices",
  description:
    "Record catalogue prices in one edition, many cells at a time — a catalogue page entered as a set. Each cell names a stamp, a condition and the price, and a certificate and a format where the price is not for a plain single. A figure is stored as the variant price grid stores one: rounded to cents, in the edition's currency, used for valuation from then on. A price on an umbrella is recorded on it and outranks the lowest of its variants'. Nothing is derived: a format multiplier or a certificate percentage is applied only by sending the resulting figure. Where the catalogue prints — or ? instead of a price, send `price=-` or `price=?`: the cell then records that the catalogue gives none, and is no longer counted as missing. A figure replaces a mark, and a mark a figure, as an ordinary edit. Each cell is answered on its own — written, unchanged, or refused with the reason — and a refused cell does not stop the others.",
  writes: true,
  parameters: [
    EDITION_PARAMETER,
    {
      name: "prices",
      in: "body",
      type: "string[]",
      required: true,
      description:
        "One cell per entry, at most 100, as `name=value` pairs separated by `;`: `stamp=Mi 309AP; condition=MNH; price=12.50`. `stamp` is an id or a catalogue number naming only that stamp; `condition` a name, abbreviation or id; `certificate` (default `none`) and `format` (default `single`) likewise; `price` a figure of zero or more, a comma or a point as the decimal mark — or `-` (the catalogue prints —: the stamp does not exist there) or `?` (the catalogue prints ?: its price cannot be determined).",
    },
  ],
  result: {
    kind: "object",
    description:
      "`edition` and `currency`, the counts `written`, `unchanged` and `refused`, and `cells` in the order sent — each with the `entry` as sent, its `outcome`, the `stampId`, `stamp`, `condition`, `certificate` and `format` it resolved to, `amount` as stored or `mark` for a cell recorded as `-`/`?` (`nonexistent`, `undeterminable`), `replaced` with the figure or mark it replaced, `umbrella` on a stamp with variants, and `reason` on a refused cell.",
  },
  handler: async (context, params) => writeCells(context, params, "set"),
};

export const clearCatalogPricesOperation: Operation = {
  name: "clear_catalog_prices",
  method: "POST",
  path: "/catalog-prices/clear",
  description:
    "Clear catalogue prices in one edition, as emptying a cell of the variant price grid does: the cell records nothing afterwards, which is not a price of zero — to record a zero, set one. A cell recorded as `-` or `?` is cleared the same way, back to *not entered yet*. Each cell names a stamp and a condition, and a certificate and a format where the price is not for a plain single. Clearing an umbrella's own price leaves it worth the lowest of its variants' again. Nothing else is removed. Each cell is answered on its own — cleared, unchanged when nothing was recorded, or refused with the reason — and a refused cell does not stop the others.",
  writes: true,
  parameters: [
    EDITION_PARAMETER,
    {
      name: "cells",
      in: "body",
      type: "string[]",
      required: true,
      description:
        "One cell per entry, at most 100, as `name=value` pairs separated by `;`: `stamp=Mi 309AP; condition=MNH`, with `certificate` (default `none`) and `format` (default `single`) where needed. No `price`.",
    },
  ],
  result: {
    kind: "object",
    description:
      "`edition` and `currency`, the counts `cleared`, `unchanged` and `refused`, and `cells` in the order sent — each with the `entry` as sent, its `outcome`, what it resolved to, `replaced` with the figure or mark it cleared, and `reason` on a refused cell.",
  },
  handler: async (context, params) => writeCells(context, params, "clear"),
};
