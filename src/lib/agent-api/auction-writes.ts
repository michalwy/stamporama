// The pure half of the auction writes through the agent API (#1627): how a lot line is spelled, how
// an amount, a premium, an instant and a tag are read, and what a written lot's lines read back as.
//
// **A line is one string of `name=value` pairs**, `"stamp=Mi 309; condition=MNH; quantity=2"`,
// because a parameter on this surface is a scalar or a string list and nothing richer (#706) — the
// cell grammar `set_catalog_prices` already uses (#1540), with the line's own fields. The condition
// is said one of three ways (#1623): one grade (`condition=MNH`), the grades it may be in
// (`condition=MNH|MH`), or `condition=unknown`. A certificate and a format default to *none* and
// *single*, the axes' own nulls (ADR-0006 §2, ADR-0020), and the quantity to one.
//
// **Lines are refused whole**: one line that does not parse, or names no stamp, refuses the call and
// writes nothing, as the other catalogue writes are (`resolveStampRefs`). A lot's lines are its whole
// contents, and a composition missing the line that failed would read as a smaller lot.
//
// Pure: no Prisma, so `pnpm test:unit` holds every rule here.

import { invalidRequest } from "./errors";
import { compact } from "./collection-reads";

// -- Lines ---------------------------------------------------------------------------------

/** The most lines one call writes — the list cap, so an answer always fits. */
export const MAX_LOT_LINES = 100;

/** The names a line may carry. */
export const LOT_LINE_FIELDS = ["stamp", "condition", "certificate", "format", "quantity"] as const;

type LotLineField = (typeof LOT_LINE_FIELDS)[number];

/** The keyword for a condition the listing does not state (#1623). */
export const CONDITION_UNKNOWN = "unknown";

/** A line's condition as sent: one grade, the grades it may be in, or unknown. */
export type LineConditionSpec =
  | { readonly kind: "one"; readonly value: string }
  | { readonly kind: "oneOf"; readonly values: readonly string[] }
  | { readonly kind: "unknown" };

/** One line as sent, split into its fields — nothing resolved yet. */
export interface LotLineSpec {
  readonly stamp: string;
  readonly condition: LineConditionSpec;
  readonly certificate: string | null;
  readonly format: string | null;
  readonly quantity: number;
}

const LINE_EXAMPLE = "`stamp=Mi 309; condition=MNH|MH; quantity=2`";

/**
 * The condition field: `MNH`, `MNH|MH`, or `unknown`. A set of one is that grade — *one of MNH* is
 * MNH — and a repeated grade is one grade, `normalizeLineCondition`'s rule.
 */
export function parseLineCondition(raw: string): LineConditionSpec | { readonly error: string } {
  const parts = raw.split("|").map((part) => part.trim());
  if (parts.some((part) => part === "")) {
    return { error: `"${raw}" is not a condition. Name one grade, the grades it may be in separated by "|" (\`MNH|MH\`), or \`unknown\`.` };
  }
  const byFold = new Map<string, string>();
  for (const part of parts) if (!byFold.has(part.toLocaleLowerCase())) byFold.set(part.toLocaleLowerCase(), part);
  const unique = [...byFold.values()];
  if (unique.length === 1) {
    return unique[0].toLocaleLowerCase() === CONDITION_UNKNOWN
      ? { kind: "unknown" }
      : { kind: "one", value: unique[0] };
  }
  if (unique.some((part) => part.toLocaleLowerCase() === CONDITION_UNKNOWN)) {
    return { error: `"${raw}" lists \`unknown\` beside grades. Send the grades the stamp may be in, or \`unknown\` alone.` };
  }
  return { kind: "oneOf", values: unique };
}

/** One line's `name=value` pairs, separated by `;`, or the reason it is not one. */
export function parseLotLineSpec(entry: string): { ok: true; line: LotLineSpec } | { ok: false; reason: string } {
  const fields = new Map<LotLineField, string>();
  for (const part of entry.split(";")) {
    if (part.trim() === "") continue;
    const eq = part.indexOf("=");
    const name = eq < 0 ? "" : part.slice(0, eq).trim().toLocaleLowerCase();
    const value = eq < 0 ? "" : part.slice(eq + 1).trim();
    if (!name || !value) {
      return { ok: false, reason: `"${part.trim()}" is not \`name=value\`. Write the line as ${LINE_EXAMPLE}.` };
    }
    if (!(LOT_LINE_FIELDS as readonly string[]).includes(name)) {
      return { ok: false, reason: `"${name}" is not a line field; a line takes ${LOT_LINE_FIELDS.join(", ")}.` };
    }
    if (fields.has(name as LotLineField)) return { ok: false, reason: `The line names "${name}" twice.` };
    fields.set(name as LotLineField, value);
  }
  const missing = (["stamp", "condition"] as const).filter((name) => !fields.has(name));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `The line has no ${missing.join(" and no ")}. Write it as ${LINE_EXAMPLE} — a condition the listing does not state is \`condition=unknown\`, never a guess.`,
    };
  }
  const condition = parseLineCondition(fields.get("condition")!);
  if ("error" in condition) return { ok: false, reason: condition.error };
  const rawQuantity = fields.get("quantity");
  let quantity = 1;
  if (rawQuantity !== undefined) {
    if (!/^\d+$/.test(rawQuantity) || Number(rawQuantity) < 1 || Number(rawQuantity) > 100_000) {
      return { ok: false, reason: `"${rawQuantity}" is not a quantity. Send a whole number of one or more.` };
    }
    quantity = Number(rawQuantity);
  }
  return {
    ok: true,
    line: {
      stamp: fields.get("stamp")!,
      condition,
      certificate: fields.get("certificate") ?? null,
      format: fields.get("format") ?? null,
      quantity,
    },
  };
}

/** Every line of a call, or a refusal naming the first that does not parse — nothing is written. */
export function parseLotLines(entries: readonly string[], parameter: string): LotLineSpec[] {
  if (entries.length > MAX_LOT_LINES) {
    throw invalidRequest(
      `"${parameter}" carries ${entries.length} lines; a lot is written with at most ${MAX_LOT_LINES}. A lot larger than that is one for the collector to describe in the app. Nothing was written.`
    );
  }
  return entries.map((entry, index) => {
    const parsed = parseLotLineSpec(entry);
    if (!parsed.ok) {
      throw invalidRequest(`Line ${index + 1} of "${parameter}" ("${entry}"): ${parsed.reason} Nothing was written.`);
    }
    return parsed.line;
  });
}

// -- Amounts, instants, tags ------------------------------------------------------------------

/** `Decimal(10, 2)`: an amount at or above this cannot be stored. */
const AMOUNT_CEILING = 100_000_000;

/** `Decimal(5, 2)`: a premium percentage at or above this cannot be stored. */
const PERCENT_CEILING = 1_000;

/**
 * An amount in the sale's currency, to the cent, as a 2-dp string — `"12.5"` reads as `"12.50"`. A
 * comma, a third decimal or a sign is refused rather than read, the purchase writes' rule: an agent
 * that sent `12,50` meant something, and a guess at what would be written as a bid figure.
 */
export function parseAuctionAmount(value: string, parameter: string, ceiling = AMOUNT_CEILING): string {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) >= ceiling) {
    throw invalidRequest(
      `"${text}" is not an amount for "${parameter}". Send a number below ${ceiling} with at most two decimal places and a period as the separator — "12.50" — in the sale's own currency.`
    );
  }
  return Number(text).toFixed(2);
}

/** A buyer's premium in percent of the hammer price — `"20"`, `"17.5"`. */
export function parsePremiumPercent(value: string, parameter: string): string {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) >= PERCENT_CEILING) {
    throw invalidRequest(
      `"${text}" is not a percentage for "${parameter}". Send the premium as a number of percent with at most two decimal places — "20" or "17.5".`
    );
  }
  return Number(text).toFixed(2);
}

/**
 * An instant, ISO 8601 with its offset — `2026-10-12T20:00:00+02:00` or `…Z`. **A time with no
 * offset is refused**: an auction closes at one moment, and a clock time without its zone is two
 * hours wrong half the year for a collector in Poland reading a German house's catalogue.
 */
export function parseInstant(value: string, parameter: string): Date {
  const text = value.trim();
  const shaped = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(text);
  const date = shaped ? new Date(text) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw invalidRequest(
      `"${text}" is not an instant for "${parameter}". Send it as ISO 8601 with the time zone — "2026-10-12T20:00:00+02:00" or "2026-10-12T18:00:00Z".`
    );
  }
  return date;
}

/**
 * Tag names, as the lot dialog's chips are: a word each, since a space ends a tag there (#1192).
 * Repeats differing only in case are one tag. A name the collection has no tag for becomes one, as
 * a chip typed into the dialog does.
 */
export function parseTagNames(values: readonly string[], parameter: string): string[] {
  const names = new Map<string, string>();
  for (const value of values) {
    const name = value.trim();
    if (name === "" || /\s/.test(name)) {
      throw invalidRequest(
        `"${value}" is not a tag for "${parameter}". A tag is one word, as the app's tag field takes it — \`agent-found\`, not \`agent found\`.`
      );
    }
    if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()];
}

// -- What a written lot's lines read back as --------------------------------------------------

/** One line as the lot answer reads it — `AuctionLotLineItem`, structurally. */
export interface LotLineRow {
  readonly stampId: string;
  readonly stampName: string | null;
  readonly catalogLabel: string | null;
  readonly conditionId: string | null;
  readonly conditionName: string;
  readonly conditionAbbreviation: string;
  readonly possibleConditionIds: readonly string[];
  readonly conditions: readonly {
    readonly conditionId: string;
    readonly conditionName: string;
    readonly conditionAbbreviation: string;
  }[];
  readonly certificateStatusName: string | null;
  readonly certificateStatusAbbreviation: string | null;
  readonly formatName: string | null;
  readonly formatAbbreviation: string | null;
  readonly quantity: number;
  readonly lineValue: string | null;
  readonly lineValueHigh: string | null;
}

/** One line of a lot, as the agent reads it. Amounts are in the sale's currency. */
export interface AgentLotLine {
  readonly stampId: string;
  /** The stamp's leading catalogue number, as the collector reads it — else its name. */
  readonly stamp: string;
  /** The grade, where the line is settled at one. */
  readonly condition?: string;
  /** The grades it may be in, where it is one of several (#1623). */
  readonly possibleConditions?: readonly string[];
  /** The listing does not state the grade: any of the collection's (#1623). */
  readonly conditionUnknown?: true;
  /** Absent for *no certificate*. */
  readonly certificate?: string;
  /** Absent for the single. */
  readonly format?: string;
  readonly quantity: number;
  /** What the line lists at in the catalogue — the low end while its grade is to settle. */
  readonly catalogueValue?: string;
  readonly catalogueValueHigh?: string;
}

const short = (abbreviation: string | null, name: string | null) => abbreviation || name || undefined;

export function lotLine(row: LotLineRow): AgentLotLine {
  const unknown = row.conditionId === null && row.possibleConditionIds.length === 0;
  const oneOf = row.conditionId === null && !unknown;
  return compact({
    stampId: row.stampId,
    stamp: row.catalogLabel ?? row.stampName ?? row.stampId,
    condition: row.conditionId !== null ? short(row.conditionAbbreviation, row.conditionName) : undefined,
    possibleConditions: oneOf
      ? row.conditions.map((condition) => short(condition.conditionAbbreviation, condition.conditionName)!)
      : undefined,
    conditionUnknown: unknown ? (true as const) : undefined,
    certificate: short(row.certificateStatusAbbreviation, row.certificateStatusName),
    format: short(row.formatAbbreviation, row.formatName),
    quantity: row.quantity,
    catalogueValue: row.lineValue,
    catalogueValueHigh: row.lineValueHigh,
  }) as AgentLotLine;
}
