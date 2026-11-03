// The pure half of catalogue prices through the agent API (#1540): how an edition is named, how one
// cell of the variant price grid is spelled in a batch write, what a price reads back as, and what a
// write answers per cell.
//
// **A cell is the variant price grid's cell and nothing else** (#618): a stamp, an edition, a
// condition, a certificate and a format, the five axes `StampCatalogPrice` is keyed on. A write is a
// batch because a catalogue page is entered a whole set at a time, and a parameter on this surface is
// a scalar or a string list and nothing richer (#706) — so one cell is one string of `name=value`
// pairs, `"stamp=Mi 309AP; condition=MNH; price=12.50"`. The edition is the call's, because a page
// comes from one book; the certificate and the format default to *none* and *single*, the axes'
// own nulls (ADR-0006 §2, ADR-0020) and what a catalogue quotes.
//
// **A batch answers per cell and never fails whole over one** — the collector's decision on #1540: a
// page with one misread number is a page with one cell to send again, not a page to re-enter. Only
// what belongs to the call — the edition, the list being empty or over the cap — refuses the call.
//
// **What a price reads back as is the grid's arithmetic, called rather than restated.** An umbrella
// with no price of its own is worth the lowest of its variants' (#238, #627), and an empty cell on a
// format axis may be derived from the single's price by a multiplier (ADR-0020 §5) — both computed by
// `variant-price-cells.ts`, the module the grid and the identification step already share so that
// they cannot disagree. A figure read here that is not recorded says so.
//
// **A cell may say the catalogue gives no price** (#1615) — `nonexistent` where it prints —,
// `undeterminable` where it prints ?. It is read back as a `mark` in place of an `amount`, written as
// `price=-` or `price=?`, and cleared like a figure; a clear still means *not entered yet*.
//
// Pure: no Prisma, so `pnpm test:unit` holds every rule here.

import { formatAmountInput, roundAmount } from "../decimal-input";
import {
  catalogPriceMarkInput,
  isCatalogPriceMark,
  parsePriceCellInput,
  type CatalogPriceMark,
} from "../catalog-price-mark";
import {
  cellMark,
  derivedCellAmount,
  lowestVariantAmount,
  rolledUpCellMark,
  shownCellAmount,
  variantDescendantMap,
  variantPriceCellKey,
  type VariantTreeRow,
} from "../variant-price-cells";
import { invalidRequest, isApiError, type ApiError } from "./errors";
import { resolveVocabularyValue, type VocabularyEntry } from "./vocabulary";
import type { AgentCatalogResolution } from "./catalog-resolve";

// -- Editions ----------------------------------------------------------------------------

/** One catalogue edition, as the agent reads it. */
export interface AgentCatalogEdition {
  /** The edition's id — what `edition` takes, beside {@link name}. */
  readonly id: string;
  /** `"Michel Polen 2024"`: the book's name and the year, which is how `edition` names it. */
  readonly name: string;
  /** The book, as `get_collection_vocabulary` names it under `catalogs`. */
  readonly catalog: string;
  /** The vendor's abbreviation — `"Mi 2024"` names the edition too, where the vendor has one book. */
  readonly vendor: string;
  readonly year: number;
  /** What every price in this edition is stated in — the book's currency. */
  readonly currency: string;
  /** The area's primary catalogue, where the list was asked for one area. */
  readonly primary?: true;
}

/** The fields an edition is built from — structural, so this side never names a Prisma type. */
export interface EditionSource {
  readonly id: string;
  readonly catalogName: string;
  readonly vendorAbbreviation: string;
  readonly year: number;
  readonly currency: string;
}

export function agentEdition(source: EditionSource, primary = false): AgentCatalogEdition {
  return {
    id: source.id,
    name: `${source.catalogName} ${source.year}`,
    catalog: source.catalogName,
    vendor: source.vendorAbbreviation,
    year: source.year,
    currency: source.currency,
    ...(primary ? { primary: true as const } : {}),
  };
}

/**
 * The edition `value` names: its id, `"<book> <year>"`, or `"<vendor> <year>"`. Resolved by #708's
 * resolver, so a name two editions answer to is refused with their ids rather than guessed — two
 * Michel books of one year are `Mi 2024` twice.
 */
export function resolveEdition(
  value: string,
  editions: readonly EditionSource[],
  parameter: string
): EditionSource {
  if (editions.length === 0) {
    throw invalidRequest(
      "This collection has no catalogue edition, so there is nothing a price could be recorded in. The collector adds catalogues and their editions under Settings → Catalogs."
    );
  }
  const entries: VocabularyEntry[] = editions.map((edition) => ({
    id: edition.id,
    name: `${edition.catalogName} ${edition.year}`,
    abbreviation: `${edition.vendorAbbreviation} ${edition.year}`,
  }));
  try {
    const id = resolveVocabularyValue(value, entries, { vocabulary: "catalog edition", parameter });
    return editions.find((edition) => edition.id === id)!;
  } catch (err) {
    if (!isApiError(err)) throw err;
    // The shared sentences send the agent to the vocabulary, which carries the books and not their
    // editions; the list that answers these is `list_catalog_editions`.
    if (isAmbiguity(err, entries)) {
      throw invalidRequest(
        `"${value.trim()}" names ${err.accepted!.length} catalogue editions here, so the name is not enough. Send one of these ids as "${parameter}"; \`list_catalog_editions\` says which is which.`,
        err.accepted
      );
    }
    throw invalidRequest(
      `"${value.trim()}" is not a catalogue edition in this collection. Name it as \`list_catalog_editions\` does — the book and the year, such as "${entries[0].name}" — or send its id as "${parameter}".`,
      err.accepted
    );
  }
}

/** Whether a resolver refusal is the ambiguous one: it hands back the matching rows' ids. */
function isAmbiguity(err: ApiError, entries: readonly VocabularyEntry[]): boolean {
  const ids = new Set(entries.map((entry) => entry.id));
  return (err.accepted ?? []).length > 0 && err.accepted!.every((value) => ids.has(value));
}

/**
 * A certificate or a format named by name or id, or the axis's null: *no certificate*, *single*. The
 * collection's own rows are matched first, so a format a collector named `Single` is that row; the
 * keyword is what is left when nothing answers to it.
 */
export function resolveAxisValue(
  value: string | null,
  entries: readonly VocabularyEntry[],
  nullWord: "none" | "single",
  context: { readonly vocabulary: "certificate status" | "format"; readonly parameter: string }
): string | null {
  if (value === null || value.trim() === "") return null;
  try {
    return resolveVocabularyValue(value, entries, context);
  } catch (err) {
    if (!isApiError(err) || isAmbiguity(err, entries)) throw err;
    if (value.trim().toLocaleLowerCase() === nullWord) return null;
    throw invalidRequest(err.message, [nullWord, ...(err.accepted ?? [])]);
  }
}

// -- What a price reads back as ----------------------------------------------------------

/** One recorded price of the grid — `VariantPriceRecord`'s fields, structurally. */
export interface RecordedPrice {
  readonly stampId: string;
  readonly catalogEditionId: string;
  readonly conditionId: string;
  readonly certificateStatusId: string | null;
  readonly formatId: string | null;
  /** 2-dp string, in the edition's currency; empty for a mark. */
  readonly amount: string;
  /** The catalogue gives no price here (#1615). */
  readonly mark: CatalogPriceMark | null;
}

/** One resolved format multiplier — `VariantPriceFactor`'s fields, structurally. */
export interface FormatFactor {
  readonly stampId: string;
  readonly formatId: string;
  readonly conditionId: string;
  readonly factor: number;
}

/** A row of the grid's tree: what the arithmetic reads, plus what the answer names. */
export interface PriceTreeRow extends VariantTreeRow {
  readonly label: string;
  readonly name: string | null;
}

/** One figure of one cell, and whether it was recorded. */
export interface PriceCell {
  readonly stampId: string;
  readonly catalogEditionId: string;
  readonly conditionId: string;
  readonly certificateStatusId: string | null;
  readonly formatId: string | null;
  /** The figure, 2-dp; empty when the cell is a {@link mark}. */
  readonly amount: string;
  /** The catalogue gives no price here (#1615) — recorded, rolled up from every variant, or carried
   *  from a marked single onto a format. */
  readonly mark: CatalogPriceMark | null;
  /**
   * `recorded` is a `StampCatalogPrice` row. `rolled_up` is an umbrella's lowest-variant figure, on
   * an umbrella with no price of its own (#238). `derived` is an empty format cell's single price
   * times the stamp's multiplier (ADR-0020 §5). The last two are what the grid draws greyed, and
   * neither is stored.
   */
  readonly source: "recorded" | "rolled_up" | "derived";
}

/**
 * Every figure the grid would draw for the tree, in every edition, condition, certificate and format
 * something is recorded in — the grid's three controls above it walked through in one pass.
 *
 * Per row and per axis combination, exactly as one grid cell decides it: a recorded price is the
 * figure; failing that an **umbrella** (a row with variant children, `identified: false`) is worth
 * the lowest of its variant descendants' figures as drawn, derived ones included — the grid's
 * `rollupFor` — and an ordinary row on a format axis may take a derived figure. A combination is
 * reached when any row records a price in it, or records the single a multiplier derives it from;
 * nothing else could put a figure there.
 */
export function catalogPriceCells(input: {
  readonly rows: readonly PriceTreeRow[];
  readonly prices: readonly RecordedPrice[];
  readonly factors: readonly FormatFactor[];
}): PriceCell[] {
  // As the grid holds them: a figure, or a mark as its sign — so the derivation and the rollup below
  // read marks exactly as the grid's cells do.
  const recorded = new Map<string, string>();
  for (const p of input.prices) {
    recorded.set(
      variantPriceCellKey(p.stampId, p.catalogEditionId, p.conditionId, p.certificateStatusId, p.formatId),
      p.mark ? catalogPriceMarkInput(p.mark) : p.amount
    );
  }
  const factorFor = new Map(input.factors.map((f) => [`${f.stampId}~${f.formatId}~${f.conditionId}`, f.factor]));

  type Combo = { editionId: string; conditionId: string; certId: string | null; formatId: string | null };
  const combos = new Map<string, Combo>();
  const addCombo = (combo: Combo) => {
    const key = `${combo.editionId}~${combo.conditionId}~${combo.certId ?? ""}~${combo.formatId ?? ""}`;
    if (!combos.has(key)) combos.set(key, combo);
  };
  for (const p of input.prices) {
    addCombo({ editionId: p.catalogEditionId, conditionId: p.conditionId, certId: p.certificateStatusId, formatId: p.formatId });
    if (p.formatId !== null) continue;
    for (const f of input.factors) {
      if (f.stampId === p.stampId && f.conditionId === p.conditionId) {
        addCombo({ editionId: p.catalogEditionId, conditionId: p.conditionId, certId: p.certificateStatusId, formatId: f.formatId });
      }
    }
  }

  const descendants = variantDescendantMap(input.rows);
  const cells: PriceCell[] = [];
  for (const combo of combos.values()) {
    const own = (stampId: string) =>
      recorded.get(variantPriceCellKey(stampId, combo.editionId, combo.conditionId, combo.certId, combo.formatId)) ?? "";
    // The grid's `derivedFor`: nothing derives on the single, and nothing without a multiplier.
    const derived = (stampId: string) =>
      combo.formatId === null
        ? null
        : derivedCellAmount(
            recorded.get(variantPriceCellKey(stampId, combo.editionId, combo.conditionId, combo.certId, null)) ?? "",
            factorFor.get(`${stampId}~${combo.formatId}~${combo.conditionId}`)
          );
    const shown = (stampId: string) => {
      const typed = own(stampId);
      return shownCellAmount(typed, typed.trim() === "" ? derived(stampId) : null);
    };
    const shownMark = (stampId: string) => {
      const typed = own(stampId);
      return cellMark(typed.trim() === "" ? (derived(stampId) ?? "") : typed);
    };
    const cell = (stampId: string, value: string, source: PriceCell["source"]): PriceCell => {
      const mark = cellMark(value);
      return {
        stampId,
        catalogEditionId: combo.editionId,
        conditionId: combo.conditionId,
        certificateStatusId: combo.certId,
        formatId: combo.formatId,
        amount: mark ? "" : value,
        mark,
        source,
      };
    };

    for (const row of input.rows) {
      const typed = own(row.stampId);
      if (typed !== "") {
        cells.push(cell(row.stampId, typed, "recorded"));
      } else if (!row.identified) {
        const rolled =
          lowestVariantAmount(descendants.get(row.stampId) ?? [], shown) ??
          rolledUpCellMark(input.rows, row.stampId, shownMark);
        if (rolled !== null) cells.push(cell(row.stampId, rolled, "rolled_up"));
      } else {
        const figure = derived(row.stampId);
        if (figure !== null) cells.push(cell(row.stampId, figure, "derived"));
      }
    }
  }
  return cells;
}

// -- Writing them --------------------------------------------------------------------------

/** The most cells one write carries — the list cap, for the same reason: an answer must fit. */
export const MAX_PRICE_CELLS = 100;

/** `StampCatalogPrice.price` is `Decimal(10, 2)`: below this, or it cannot be stored at all. */
export const PRICE_CEILING = 100_000_000;

/** The names a cell may carry. */
export const CELL_FIELDS = ["stamp", "condition", "certificate", "format", "price"] as const;

export type CellField = (typeof CELL_FIELDS)[number];

/** One cell as sent, split into its fields — nothing resolved yet. */
export interface CellSpec {
  readonly stamp: string;
  readonly condition: string;
  readonly certificate: string | null;
  readonly format: string | null;
  /** The price as typed; null on a clear. */
  readonly price: string | null;
}

/** Refuse a write that carries no cells or more than one call writes. */
export function checkCellCount(entries: readonly string[], parameter: string): void {
  if (entries.length === 0) {
    throw invalidRequest(`"${parameter}" must carry at least one cell, such as \`stamp=Mi 309AP; condition=MNH; price=12.50\`.`);
  }
  if (entries.length > MAX_PRICE_CELLS) {
    throw invalidRequest(
      `"${parameter}" carries ${entries.length} cells; one call writes at most ${MAX_PRICE_CELLS}. Send the rest in a second call.`
    );
  }
}

/**
 * One cell's `name=value` pairs, separated by `;`, or the reason it is not one. A set needs a
 * `price`; a clear refuses one, since what it does is the opposite of recording a figure.
 */
export function parseCellSpec(
  entry: string,
  mode: "set" | "clear"
): { ok: true; cell: CellSpec } | { ok: false; reason: string } {
  const example =
    mode === "set" ? "`stamp=Mi 309AP; condition=MNH; price=12.50`" : "`stamp=Mi 309AP; condition=MNH`";
  const fields = new Map<CellField, string>();
  for (const part of entry.split(";")) {
    if (part.trim() === "") continue;
    const eq = part.indexOf("=");
    const name = eq < 0 ? "" : part.slice(0, eq).trim().toLocaleLowerCase();
    const value = eq < 0 ? "" : part.slice(eq + 1).trim();
    if (!name || !value) {
      return { ok: false, reason: `"${part.trim()}" is not \`name=value\`. Write the cell as ${example}.` };
    }
    if (!(CELL_FIELDS as readonly string[]).includes(name)) {
      return { ok: false, reason: `"${name}" is not a cell field; a cell takes ${CELL_FIELDS.join(", ")}.` };
    }
    if (fields.has(name as CellField)) {
      return { ok: false, reason: `The cell names "${name}" twice.` };
    }
    fields.set(name as CellField, value);
  }
  const missing = (["stamp", "condition"] as const).filter((name) => !fields.has(name));
  if (mode === "set" && !fields.has("price")) missing.push("price" as never);
  if (missing.length > 0) {
    return { ok: false, reason: `The cell has no ${missing.join(" and no ")}. Write it as ${example}.` };
  }
  if (mode === "clear" && fields.has("price")) {
    return {
      ok: false,
      reason: "A clear takes no price: it removes the figure, leaving the cell empty. Send prices with `set_catalog_prices`.",
    };
  }
  return {
    ok: true,
    cell: {
      stamp: fields.get("stamp")!,
      condition: fields.get("condition")!,
      certificate: fields.get("certificate") ?? null,
      format: fields.get("format") ?? null,
      price: fields.get("price") ?? null,
    },
  };
}

/**
 * The price as typed, read the way the grid reads a cell when it is left (`formatAmountInput`: a
 * comma or a point, a sum such as `12+3`, rounded to cents), or the reason it is not one. The grid's
 * write refuses a negative figure; the column refuses one it cannot hold.
 *
 * `-` records that the catalogue says the stamp does not exist there, `?` that its price cannot be
 * determined (#1615) — as the grid takes them — and so do the marks' own names, `nonexistent` and
 * `undeterminable`. A mark's `text` is its name.
 */
export function parseCellPrice(
  raw: string
):
  | { ok: true; amount: number | CatalogPriceMark; text: string }
  | { ok: false; reason: string } {
  const named = raw.trim().toLocaleLowerCase();
  if (isCatalogPriceMark(named)) return { ok: true, amount: named, text: named };
  const typed = parsePriceCellInput(raw);
  if (typed.kind === "mark") return { ok: true, amount: typed.mark, text: typed.mark };
  const normalized = formatAmountInput(raw);
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return {
      ok: false,
      reason: `"${raw}" is not an amount. Send a figure of zero or more, such as 12.50 — or \`-\` where the catalogue prints — and \`?\` where it prints ?.`,
    };
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount >= PRICE_CEILING) {
    return { ok: false, reason: `"${raw}" is more than a catalogue price can hold; the largest is 99999999.99.` };
  }
  return { ok: true, amount, text: roundAmount(amount) };
}

/** What happened to one cell. */
export type CellOutcome = "written" | "cleared" | "unchanged" | "refused";

/** One cell of a write's answer. */
export interface AgentPriceCellAnswer {
  /** The cell as it was sent. */
  readonly entry: string;
  readonly outcome: CellOutcome;
  readonly stampId?: string;
  /** The stamp's leading catalogue number, as the collector reads it. */
  readonly stamp?: string;
  readonly condition?: string;
  /** Absent for *no certificate*. */
  readonly certificate?: string;
  /** Absent for *single*. */
  readonly format?: string;
  /** The figure the cell holds after the call; absent when it is empty or a mark. */
  readonly amount?: string;
  /** The mark the cell holds after the call (#1615): `nonexistent` or `undeterminable`. */
  readonly mark?: CatalogPriceMark;
  /** The figure — or the mark's name — the call replaced or cleared. */
  readonly replaced?: string;
  /** The stamp has variants: a price on it is its own and outranks their lowest (#616). */
  readonly umbrella?: true;
  /** Why a refused cell was refused, in a sentence an agent can act on. */
  readonly reason?: string;
}

/** What `set_catalog_prices` and `clear_catalog_prices` answer. */
export interface AgentPriceWrite {
  readonly edition: string;
  readonly currency: string;
  readonly written: number;
  readonly cleared: number;
  readonly unchanged: number;
  readonly refused: number;
  readonly cells: readonly AgentPriceCellAnswer[];
}

export function summarizeCells(
  edition: AgentCatalogEdition,
  cells: readonly AgentPriceCellAnswer[]
): AgentPriceWrite {
  const count = (outcome: CellOutcome) => cells.filter((cell) => cell.outcome === outcome).length;
  return {
    edition: edition.name,
    currency: edition.currency,
    written: count("written"),
    cleared: count("cleared"),
    unchanged: count("unchanged"),
    refused: count("refused"),
    cells,
  };
}

/**
 * Why a cell's `stamp` named no stamp — `unresolvedStamps`'s sentence for one entry, since here one
 * unresolvable stamp refuses its own cell and not the call.
 */
export function unresolvedStampReason(resolution: AgentCatalogResolution): string {
  if (resolution.verdict === "ambiguous") {
    const candidates = resolution.stamps.map((stamp) => `${stamp.matchedNumber} (${stamp.stampId})`);
    return `"${resolution.input}" matches ${resolution.stamps.length} stamps: ${candidates.join(", ")}. Send the id of the one you mean.`;
  }
  if (resolution.verdict === "unknown_vendor") {
    const kept = resolution.acceptedVendors?.join(", ") || "none";
    return `"${resolution.input}" names a catalogue this collection does not keep (catalogues kept: ${kept}).`;
  }
  return `"${resolution.input}" is no stamp id and no catalogue number of a stamp in this collection — \`resolve_catalog_numbers\` shows what a number reaches.`;
}
