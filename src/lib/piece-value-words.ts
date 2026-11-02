import {
  FRANKING_LABELS,
  PIECE_PRICE_LABELS,
  VALUATION_METHOD_LABELS,
  coverUsage,
  termCents,
  type MissingPiecePrice,
  type PieceComponent,
  type PiecePrice,
  type PieceRule,
} from "./piece-valuation";
import type { PieceValuation } from "./valuation";

// The words a surface puts beside a piece's value (#2359) — pure, so the row, the copy page, the
// Valuation window and the identification step say the same thing. The arithmetic (#2353) is the
// Valuation window's and the identification step's.

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

/**
 * The price **on the piece** each stamp shows beside its used price (#2353): the one the method reads
 * for this piece — on a cover its EF, MeF or MiF price by what is on it (Fischer's ⊠, its MiF price,
 * whatever the franking), on a fragment its on-piece price. Null for a piece whose format has no kind,
 * which has no price on the piece to show. Named by what is on the piece rather than by the franking:
 * a cover not posted is valued at used prices, but what it would be worth posted is still the
 * catalogue's figure to compare.
 */
export function onPiecePrice(piece: Pick<PieceValuation, "kind" | "method" | "components">): PiecePrice | null {
  if (piece.kind === null) return null;
  if (piece.kind === "on_piece") return "on_piece";
  if (piece.method === "fischer") return "cover_mif";
  if (piece.components.length === 0) return null;
  const usage = coverUsage(piece.components);
  return usage === "ef" ? "cover_ef" : usage === "mef" ? "cover_mef" : "cover_mif";
}

/** A component's figure for `price`, in the collection currency, or null when it is missing. */
export function componentPrice(component: PieceComponent, price: PiecePrice): number | null {
  switch (price) {
    case "used":
      return component.used;
    case "cover_ef":
      return component.coverEf;
    case "cover_mef":
      return component.coverMef;
    case "cover_mif":
      return component.coverMif;
    case "on_piece":
      return component.onPiece;
  }
}

/** The short name of a price in the arithmetic: ⊙ for used, ⊠ for Fischer's cover price. */
export function priceSymbol(price: PiecePrice, method: PieceValuation["method"]): string {
  switch (price) {
    case "used":
      return "⊙";
    case "cover_ef":
      return method === "fischer_fp_fw_fm" ? "FP" : "EF";
    case "cover_mef":
      return method === "fischer_fp_fw_fm" ? "FW" : "MeF";
    case "cover_mif":
      return method === "fischer" ? "⊠" : method === "fischer_fp_fw_fm" ? "FM" : "MiF";
    case "on_piece":
      return "on piece";
  }
}

const ARITHMETIC_HEAD: Record<PieceRule, string | null> = {
  sum_of_used: "Sum of used",
  on_piece: "On piece",
  cover_price: null,
  highest_mif: null,
  philatelic: "Philatelic",
  fischer_mef: null,
  fischer_mif: null,
};

/**
 * How the figure was reached, as arithmetic that can be checked against the catalogue (#2353):
 * *MiF: 50 % × Mi 123 ⊠ 40.00 + Mi 124 ⊙ 2.00 = 22.00*. `label` names an entry — its catalogue
 * number, as the surface words one. A missing price is printed as a dash where it would have been
 * added, and the sum is of what is priced. Null when the rule added nothing at all.
 */
export function pieceArithmetic(
  piece: Pick<PieceValuation, "rule" | "usage" | "method" | "terms">,
  label: (componentId: string) => string
): string | null {
  if (piece.terms.length === 0) return null;
  const head =
    ARITHMETIC_HEAD[piece.rule] ??
    (piece.usage === "ef" ? "EF" : piece.usage === "mef" ? "MeF" : piece.usage === "mif" ? "MiF" : null);
  let cents = 0;
  let priced = false;
  const parts = piece.terms.map((t) => {
    const share = t.percent === 100 ? "" : `${t.percent} % × `;
    const unit = t.unit === null ? "—" : t.unit.toFixed(2);
    const times = t.times === 1 ? "" : ` × ${t.times}`;
    if (t.unit !== null) {
      cents += termCents(t.unit, t.percent) * t.times;
      priced = true;
    }
    return `${share}${label(t.componentId)} ${priceSymbol(t.price, piece.method)} ${unit}${times}`;
  });
  const sum = priced ? (cents / 100).toFixed(2) : "—";
  return `${head ? `${head}: ` : ""}${parts.join(" + ")} = ${sum}`;
}
