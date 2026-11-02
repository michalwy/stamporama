import {
  FRANKING_LABELS,
  PIECE_PRICE_LABELS,
  VALUATION_METHOD_LABELS,
  type MissingPiecePrice,
  type PieceRule,
} from "./piece-valuation";
import type { PieceValuation } from "./valuation";

// The words a surface puts beside a piece's value (#2359) — pure, so the row, the copy page and the
// Valuation window say the same thing. The full arithmetic is the Valuation window's (#2353).

const RULE_WORDS: Record<PieceRule, string> = {
  sum_of_used: "sum of the stamps' used prices",
  on_piece: "sum of the stamps' on-piece prices",
  cover_price: "the stamp's price on cover",
  highest_mif: "the highest MiF price",
  philatelic: "the most expensive used price + 15 %",
  fischer_mef: "150 % of ⊠ for two stamps, the rest at used prices",
  fischer_mif: "50 % of the highest ⊠, the rest at used prices",
};

/** How the figure was reached, in one line: *Michel · Rate-correct · MiF — the highest MiF price*. */
export function pieceValueRule(piece: PieceValuation): string {
  if (piece.kind === null) {
    return "Sum of used — the piece's format is neither on cover nor on piece";
  }
  const parts = [VALUATION_METHOD_LABELS[piece.method]];
  if (piece.kind === "on_cover") parts.push(FRANKING_LABELS[piece.franking]);
  else parts.push("On piece");
  if (piece.usage) parts.push(piece.usage === "ef" ? "EF" : piece.usage === "mef" ? "MeF" : "MiF");
  return `${parts.join(" · ")} — ${RULE_WORDS[piece.rule]}`;
}

/** *Cover MiF price missing for 2 stamps*, or null when nothing is. */
export function missingPricesText(missing: readonly MissingPiecePrice[]): string | null {
  if (missing.length === 0) return null;
  const byPrice = new Map<string, number>();
  for (const m of missing) {
    const label = PIECE_PRICE_LABELS[m.price];
    byPrice.set(label, (byPrice.get(label) ?? 0) + 1);
  }
  return [...byPrice]
    .map(([label, n]) => `${label} price missing for ${n} stamp${n === 1 ? "" : "s"}`)
    .join(", ");
}

/** The hover over a piece's value on a row. */
export function pieceValueTitle(piece: PieceValuation): string {
  const missing = missingPricesText(piece.missing);
  return `Computed for this piece: ${pieceValueRule(piece)}${missing ? `. Partial — ${missing}.` : ""}`;
}
