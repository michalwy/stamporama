import {
  FRANKING_LABELS,
  VALUATION_METHOD_LABELS,
  coverUsage,
  termCents,
  type InheritedMethod,
  type MissingPiecePrice,
  type PieceComponent,
  type PiecePrice,
  type PieceRule,
} from "./piece-valuation";
import type { PieceValuation } from "./valuation";
import { METHOD_ROLE_LABELS, roleOfPrice, type UnmappedRole } from "./valuation-method-roles";

// The words a surface puts beside a piece's value (#2359) — pure, so the row, the copy page, the
// Valuation window and the identification step say the same thing. The arithmetic (#2353) is the
// Valuation window's and the identification step's. A price is named by the condition its method
// maps it to (#2375) — *U*, *FM*, ⊠ — and by its role while the role is not set up.

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
    // The method is not what is missing (#2369): no method reads a cover price off a format that
    // does not say the piece is a cover.
    return "Sum of used — the piece's format is neither on cover nor on piece; give it a format of kind On cover or On piece to value it by a method";
  }
  const parts = [VALUATION_METHOD_LABELS[piece.method]];
  if (piece.kind === "on_cover") parts.push(FRANKING_LABELS[piece.franking]);
  else parts.push("On piece");
  if (piece.usage) parts.push(piece.usage === "ef" ? "EF" : piece.usage === "mef" ? "MeF" : "MiF");
  return `${parts.join(" · ")} — ${RULE_WORDS[piece.rule]}`;
}

/** Where a piece's method came from: *set on this copy*, *from Germany*, *the collection's default*. */
export function methodSourceText(piece: Pick<PieceValuation, "methodSource" | "inherited">): string {
  if (piece.methodSource.kind === "copy") return "set on this copy";
  return inheritedFrom(piece.inherited);
}

/** The first choice beside a piece's method (#2369), naming what it inherits and from where:
 *  *As inherited (Michel, from Germany)*. */
export function inheritedMethodLabel(inherited: InheritedMethod): string {
  return `As inherited (${VALUATION_METHOD_LABELS[inherited.method]}, ${inheritedFrom(inherited)})`;
}

function inheritedFrom(inherited: InheritedMethod): string {
  return inherited.areaId === null
    ? "the collection's default"
    : `from ${inherited.areaName ?? "its area"}`;
}

type PieceNaming = Pick<PieceValuation, "method" | "columns">;

/** The role a price stands for under the piece's method (#2375): *Cover MiF*, *Cover ⊠*, *FM*. */
export function priceRoleLabel(piece: Pick<PieceValuation, "method">, price: PiecePrice): string {
  const role = roleOfPrice(piece.method, price);
  return role ? METHOD_ROLE_LABELS[role] : price;
}

/** A price's column heading (#2375): the mapped condition's abbreviation — *U*, *FM* — or, with its
 *  role not set up, the role's name. */
export function priceHeading(piece: PieceNaming, price: PiecePrice): string {
  return piece.columns[price]?.abbreviation ?? priceRoleLabel(piece, price);
}

/** *FM price missing for 2 stamps*, or null when nothing is — each price named by its condition. */
export function missingPricesText(
  piece: PieceNaming & { missing: readonly MissingPiecePrice[] }
): string | null {
  if (piece.missing.length === 0) return null;
  const byPrice = new Map<string, number>();
  for (const m of piece.missing) {
    const label = priceHeading(piece, m.price);
    byPrice.set(label, (byPrice.get(label) ?? 0) + 1);
  }
  return [...byPrice]
    .map(([label, n]) => `${label} price missing for ${n} stamp${n === 1 ? "" : "s"}`)
    .join(", ");
}

/** *Michel's Cover MiF and Never hinged are not set up*, or null when every role read is (#2375). */
export function unmappedRolesText(unmapped: readonly UnmappedRole[]): string | null {
  if (unmapped.length === 0) return null;
  const byMethod = new Map<string, string[]>();
  for (const u of unmapped) {
    const label = VALUATION_METHOD_LABELS[u.method];
    byMethod.set(label, [...(byMethod.get(label) ?? []), METHOD_ROLE_LABELS[u.role]]);
  }
  return [...byMethod]
    .map(([method, roles]) => {
      const list =
        roles.length === 1 ? roles[0] : `${roles.slice(0, -1).join(", ")} and ${roles[roles.length - 1]}`;
      return `${method}'s ${list} ${roles.length === 1 ? "is" : "are"} not set up`;
    })
    .join("; ");
}

/** The hover over a piece's value on a row. */
export function pieceValueTitle(piece: PieceValuation): string {
  const gaps = [unmappedRolesText(piece.unmapped), missingPricesText(piece)].filter(Boolean);
  return `Computed for this piece: ${pieceValueRule(piece)}${gaps.length ? `. Partial — ${gaps.join("; ")}.` : ""}`;
}

/** Whether a component's price was worked out by Michel's rule rather than read (#2358, #2375) —
 *  shown as derived, `~`. */
export function isDerivedPrice(component: PieceComponent, price: PiecePrice): boolean {
  return component.derived?.includes(price) ?? false;
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

/** The short name of a price in the arithmetic (#2375): the mapped condition's symbol where it has
 *  one — ⊙, ⊠ — else its abbreviation, else the role's name while it is not set up. */
export function priceSymbol(piece: PieceNaming, price: PiecePrice): string {
  const column = piece.columns[price];
  return column ? (column.symbol ?? column.abbreviation) : priceRoleLabel(piece, price);
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
  piece: Pick<PieceValuation, "rule" | "usage" | "method" | "terms" | "columns" | "components">,
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
    const component = piece.components.find((c) => c.id === t.componentId);
    const derived = component ? isDerivedPrice(component, t.price) : false;
    const unit = t.unit === null ? "—" : `${derived ? "~" : ""}${t.unit.toFixed(2)}`;
    const times = t.times === 1 ? "" : ` × ${t.times}`;
    if (t.unit !== null) {
      cents += termCents(t.unit, t.percent) * t.times;
      priced = true;
    }
    return `${share}${label(t.componentId)} ${priceSymbol(piece, t.price)} ${unit}${times}`;
  });
  const sum = priced ? (cents / 100).toFixed(2) : "—";
  return `${head ? `${head}: ` : ""}${parts.join(" + ")} = ${sum}`;
}
