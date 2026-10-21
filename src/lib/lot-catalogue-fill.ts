// Which of an auction lot's lines **Fill catalogue values** lists, and what a typed value comes to
// on a multiple (#2094). Pure — the lot screens and the dialog call it, and the unit suite can.
//
// The list is #1223's, applied to a lot: one field per value to be typed, Tab to the next, nothing
// in between. A value is recorded at `stamp × condition × certificate` on the area's primary
// catalogue at the **single** (#147/#170 — what `+ catalog value` writes), so two lines of one stamp
// at one condition and certificate are one value however many formats or quantities they come in,
// and are asked for once.

import type { CatalogPriceMark } from "./catalog-price-mark";
import { parsePriceCellInput } from "./catalog-price-mark";
import { roundAmount } from "./decimal-input";

/** The fields of a composition line the choice reads — `AuctionLotLineItem` satisfies it. */
export interface FillableLotLine {
  stampId: string;
  /** Null while the line is unknown or one of several (#1623). */
  conditionId: string | null;
  certificateStatusId: string | null;
  formatId: string | null;
  unpriced: boolean;
  mark: CatalogPriceMark | null;
  unknownVariant: boolean;
}

/** One value the dialog asks for, and the lot's lines it prices. */
export interface CatalogueFillEntry<L extends FillableLotLine> {
  key: string;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  /** In the lot's own order; never empty. The first is the one the entry is drawn from. */
  lines: L[];
}

/** The key a catalogue value is recorded against, minus the catalogue. */
export function catalogueFillKey(line: {
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
}): string {
  return `${line.stampId}~${line.conditionId}~${line.certificateStatusId ?? ""}`;
}

/**
 * Whether a line is one the dialog asks a value for. It must have **no catalogue price**, and
 * three kinds of unpriced line are left out:
 *
 * - a **marked** one (#1615) — the catalogue says on purpose there is no price, which is an answer;
 * - one whose **condition is not settled** (#1623) — a value is entered at one condition, and an
 *   *MNH or MH* line has no single cell to fill, exactly as its `+ catalog value` slot is absent;
 * - one pointed at a **base stamp** (variant not identified, #238) — its value is its variants',
 *   which the variant price grid fills, and a figure typed at the base would override that rollup.
 */
export function needsCatalogueValue(line: FillableLotLine): boolean {
  return line.unpriced && line.mark === null && line.conditionId !== null && !line.unknownVariant;
}

/**
 * The values to ask for, in the order the lot's lines first name them — one per `stamp × condition
 * × certificate`, carrying every line it prices.
 */
export function catalogueFillEntries<L extends FillableLotLine>(lines: L[]): CatalogueFillEntry<L>[] {
  const byKey = new Map<string, CatalogueFillEntry<L>>();
  for (const line of lines) {
    if (!needsCatalogueValue(line) || line.conditionId === null) continue;
    const key = catalogueFillKey({ ...line, conditionId: line.conditionId });
    const entry = byKey.get(key);
    if (entry) entry.lines.push(line);
    else
      byKey.set(key, {
        key,
        stampId: line.stampId,
        conditionId: line.conditionId,
        certificateStatusId: line.certificateStatusId,
        lines: [line],
      });
  }
  return [...byKey.values()];
}

/**
 * What a typed single's value comes to on a multiple — `single × factor`, 2-dp — or null when there
 * is nothing to show: no figure typed (blank, a mark, or not a number) or no factor for the format.
 */
export function multipliedCatalogueValue(typed: string, factor: number | null): string | null {
  if (factor === null) return null;
  const cell = parsePriceCellInput(typed);
  if (cell.kind !== "amount") return null;
  return roundAmount(cell.amount * factor);
}
