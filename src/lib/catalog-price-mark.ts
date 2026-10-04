// A catalogue price cell that says the catalogue gives **no price on purpose** (#1615).
//
// Catalogues list a stamp and print *—* where it does not exist in that condition, or *?* where its
// price cannot be stated — usually a great rarity. A `StampCatalogPrice` row holds either a price or
// one of these marks (a CHECK in the migration keeps it to exactly one); no row at all is still
// *not entered yet*. The difference matters wherever the app asks for prices: a marked cell has
// nothing to enter, so no count, mark, worklist or warning about missing prices may include it.
//
// Pure — no Prisma, no React — so the grid, the valuation rule and the agent API read one vocabulary.

import { normalizeDecimalInput } from "./decimal-input";

/** The two marks, in the order a picker offers them. */
export const CATALOG_PRICE_MARKS = ["nonexistent", "undeterminable"] as const;

/** `nonexistent` — the catalogue prints *—*; `undeterminable` — it prints *?*. */
export type CatalogPriceMark = (typeof CATALOG_PRICE_MARKS)[number];

export function isCatalogPriceMark(value: unknown): value is CatalogPriceMark {
  return value === "nonexistent" || value === "undeterminable";
}

/** The column read back as a mark — anything the CHECK would refuse reads as none. */
export function catalogPriceMarkOf(value: string | null | undefined): CatalogPriceMark | null {
  return isCatalogPriceMark(value) ? value : null;
}

/** How a mark is drawn in a cell: the catalogue's own sign. */
export const CATALOG_PRICE_MARK_SYMBOL: Record<CatalogPriceMark, string> = {
  nonexistent: "—",
  undeterminable: "?",
};

/** How a mark is said in a sentence — *catalogue price does not exist*. */
export const CATALOG_PRICE_MARK_LABEL: Record<CatalogPriceMark, string> = {
  nonexistent: "does not exist",
  undeterminable: "not determinable",
};

/** The whole phrase a value slot shows in place of a figure. */
export function catalogPriceMarkPhrase(mark: CatalogPriceMark): string {
  return `catalogue price ${CATALOG_PRICE_MARK_LABEL[mark]}`;
}

/** What is typed into a price cell, read: nothing, a mark, an amount, or something that is none. */
export type PriceCellInput =
  | { kind: "empty" }
  | { kind: "mark"; mark: CatalogPriceMark }
  | { kind: "amount"; amount: number }
  | { kind: "invalid" };

/**
 * Read a typed cell. `-` (and the dashes a keyboard or a paste may give instead, `–` and `—`) is
 * *does not exist*; `?` is *not determinable*; blank is *not entered yet*. Anything else must be a
 * non-negative amount.
 */
export function parsePriceCellInput(raw: string): PriceCellInput {
  const typed = raw.trim();
  if (typed === "") return { kind: "empty" };
  if (typed === "-" || typed === "–" || typed === "—") return { kind: "mark", mark: "nonexistent" };
  if (typed === "?") return { kind: "mark", mark: "undeterminable" };
  const amount = Number(normalizeDecimalInput(typed));
  if (!Number.isFinite(amount) || amount < 0) return { kind: "invalid" };
  return { kind: "amount", amount };
}

/** A mark as a cell holds it once left: the catalogue's own sign, `—` or `?`, which
 *  {@link parsePriceCellInput} reads back as the same mark. */
export function catalogPriceMarkInput(mark: CatalogPriceMark): string {
  return CATALOG_PRICE_MARK_SYMBOL[mark];
}

/** A typed mark settled to its sign (`-` → `—`), or null when the text is not a mark. */
export function settlePriceMarkInput(raw: string): string | null {
  const cell = parsePriceCellInput(raw);
  return cell.kind === "mark" ? catalogPriceMarkInput(cell.mark) : null;
}

/**
 * The state an umbrella takes when **every** variant under it is marked and none is priced (#1615):
 * *does not exist* when all of them do, otherwise *not determinable* — one variant whose price cannot
 * be stated is enough to make the umbrella's unstateable too. Null when there are no marks to combine.
 */
export function combineCatalogPriceMarks(
  marks: readonly CatalogPriceMark[]
): CatalogPriceMark | null {
  if (marks.length === 0) return null;
  return marks.every((m) => m === "nonexistent") ? "nonexistent" : "undeterminable";
}

/** The sentence a hover gives a mark — what the catalogue prints, and that nothing is to be entered. */
export function catalogPriceMarkHint(mark: CatalogPriceMark): string {
  return mark === "nonexistent"
    ? "The catalogue prints — here: the stamp does not exist in this condition, so there is no price to enter."
    : "The catalogue prints ? here: its price cannot be determined, so there is no price to enter.";
}

/** What a total says about the copies it left out because their catalogue gives no price (#1615):
 *  *2 copies with no catalogue price*. */
export function markedCopiesNote(count: number): string {
  return `${count} ${count === 1 ? "copy" : "copies"} with no catalogue price`;
}
