import { formatEntityNo } from "./quick-jump";

// How a sale's line is named (#2189): by the offer it sold through, since a set's own name is its
// copies' catalogue numbers — *Fi·PL 377-78,380-85,…* reads as nothing on a parcel of seventy copies,
// while *#2848 · 🇵🇱 Polska: Zestaw znaczków kasowanych* is the listing the buyer bought. The numbers
// are not dropped: they move to a muted second line. One rule for the sale's screen and its printed
// packing list, so the two name a line alike.

/** The offer a sale line sold through, as the line is named by it. */
export interface SaleLineOffer {
  offerNo: number;
  /** The offer's title as it reads **now** — its stored title, else its derived label — never one
   *  copied at the sale. The flag is part of it wherever the offer's template puts one. */
  title: string;
  /** Which of the offer's sets this line is, set when the offer held several and the sale took only
   *  some of them; null otherwise. */
  set: { position: number; count: number; ownName: string | null } | null;
}

export interface SaleLineNameInput {
  /** The set's own label: its title, else its derived catalogue numbers. */
  setLabel: string;
  /** The set's catalogue numbers, derived whatever its title. */
  setNumbers: string;
  /** Null on a set sold off no offer (#2021), and on one whose offer has since been deleted. */
  offer: SaleLineOffer | null;
}

export interface SaleLineName {
  /** The offer's number, or null when the line names none — the screen links the heading then. */
  offerNo: number | null;
  /** The offer's title, with which of its sets this is where that needs saying — else the set's
   *  own label. Printed after the number. */
  title: string;
  /** The set's catalogue numbers, muted under the heading; null where the heading already says them. */
  numbers: string | null;
}

/** `#2848 · <offer title> — set 2 of 5 · <set's own name>`, the parts as {@link SaleLineName} keeps them. */
export function saleLineName(line: SaleLineNameInput): SaleLineName {
  const { offer } = line;
  if (!offer) return { offerNo: null, title: line.setLabel, numbers: secondLine(line.setLabel, line.setNumbers) };
  const which = offer.set
    ? ` — set ${offer.set.position} of ${offer.set.count}${offer.set.ownName ? ` · ${offer.set.ownName}` : ""}`
    : "";
  const title = `${offer.title}${which}`;
  return { offerNo: offer.offerNo, title, numbers: secondLine(title, line.setNumbers) };
}

/** The whole heading as one string, for a surface that prints it plain (the packing list). */
export function saleLineHeading(name: SaleLineName): string {
  return name.offerNo === null ? name.title : `${formatEntityNo(name.offerNo)} · ${name.title}`;
}

function secondLine(heading: string, numbers: string): string | null {
  return numbers.trim() === "" || numbers === heading ? null : numbers;
}

/**
 * Which of an offer's sets a line is (#2189), or null when that needs no saying: the offer held one
 * set, or this sale took every one of them. `setIds` is the offer's sets in their own order;
 * `soldHere` how many of them this sale's lines name.
 */
export function offerSetOrdinal(
  setIds: readonly string[],
  setId: string,
  soldHere: number
): { position: number; count: number } | null {
  if (setIds.length < 2 || soldHere >= setIds.length) return null;
  const index = setIds.indexOf(setId);
  return index < 0 ? null : { position: index + 1, count: setIds.length };
}
