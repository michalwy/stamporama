// How a **piece** — a cover, a fragment, a card carrying stamps — is valued from its stamps' prices
// (#2359; ADR-0076). Pure: the database half is `item-valuation.ts`, which reads each stamp's prices
// at the keys below and hands them in already converted to the collection currency.
//
// A piece is a copy carrying several stamps (ADR-0044), or one stamp once on a format of kind *On
// cover* or *On piece*. Its format's kind says which rules apply: a fragment is valued from on-piece
// prices, a cover from the on-cover prices #2356 added — EF, MeF, MiF — by its **franking**, and a
// piece whose format has no kind (an FDC, until #2355 settles it) by the sum of its stamps' used prices.
//
// Four **methods**, set per area, inherited downwards, with a collection default (*Michel*) and a
// copy's own winning over all:
//
//   - *Sum of used* — every stamp at its used price, times its quantity, in its own format.
//   - *Michel* — on piece: Σ on-piece prices. On cover, rate-correct: EF → the EF price, MeF → the MeF
//     price, MiF → the highest MiF price (a cover's ⊠ price is the cover's, so the rest add nothing).
//     Philatelic, posted: the most expensive stamp's used price + 15 %. Not posted: Σ used prices.
//   - *Fischer* — each stamp's ⊠ price is its MiF price (#2356). EF → ⊠. MeF → 150 % of ⊠ for the
//     first two stamps, every further one at its used price. MiF → 50 % of the highest ⊠, every other
//     stamp (further copies of that one included) at its used price.
//   - *Fischer FP/FW/FM* — EF → FP (EF), MeF → FW (MeF), MiF → the highest FM (MiF), with no formula.
//
// Under both Fischer methods a fragment and a cover not posted are valued as under Michel, and a
// philatelic cover as a rate-correct one, since Fischer states no rule for it.
//
// **EF, MeF or MiF counts stamps, not rows**: one stamp once is EF; one stamp several times — a
// quantity above 1, or an entry in a multiple format such as a block — is MeF; more than one stamp is
// MiF. ADR-0020 gives a format no count of stamps, so where Fischer's formulas count, an entry in a
// multiple format counts as **one** stamp of its quantity, priced at its own format's used price.
//
// A missing price makes the value **partial** and says which stamp and which price. For the highest
// of several prices (MiF, the philatelic rule, Fischer's MiF) a stamp without one could have been the
// highest, so it makes the value partial too. A value with nothing priced is no value at all.

export const VALUATION_METHODS = ["sum_of_used", "michel", "fischer", "fischer_fp_fw_fm"] as const;
export type ValuationMethod = (typeof VALUATION_METHODS)[number];

/** The collection's default until the collector picks another (#2359, the collector's call). */
export const DEFAULT_VALUATION_METHOD: ValuationMethod = "michel";

export const VALUATION_METHOD_LABELS: Record<ValuationMethod, string> = {
  sum_of_used: "Sum of used",
  michel: "Michel",
  fischer: "Fischer",
  fischer_fp_fw_fm: "Fischer FP/FW/FM",
};

export function isValuationMethod(value: unknown): value is ValuationMethod {
  return typeof value === "string" && (VALUATION_METHODS as readonly string[]).includes(value);
}

export const FRANKINGS = ["rate_correct", "philatelic_posted", "not_posted"] as const;
export type Franking = (typeof FRANKINGS)[number];

export const DEFAULT_FRANKING: Franking = "rate_correct";

export const FRANKING_LABELS: Record<Franking, string> = {
  rate_correct: "Rate-correct",
  philatelic_posted: "Philatelic, posted",
  not_posted: "Not posted",
};

export function isFranking(value: unknown): value is Franking {
  return typeof value === "string" && (FRANKINGS as readonly string[]).includes(value);
}

/** What a copy in a format is (`StampFormat.pieceKind`). Null is neither. */
export const PIECE_KINDS = ["on_cover", "on_piece"] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

export const PIECE_KIND_LABELS: Record<PieceKind, string> = {
  on_cover: "On cover",
  on_piece: "On piece",
};

export function isPieceKind(value: unknown): value is PieceKind {
  return typeof value === "string" && (PIECE_KINDS as readonly string[]).includes(value);
}

/**
 * Whether a copy is a **piece** valued by a method: it carries several stamps (`stampCount` > 1,
 * ADR-0044), or its format has a kind. One stamp once on a cover is still a copy of that stamp and
 * still counted (#2359) — only its value is now the method's.
 */
export function isPiece(stampCount: number, formatKind: PieceKind | null): boolean {
  return stampCount > 1 || formatKind !== null;
}

/** The prices a method may read, by name — which one a missing-price note names. */
export type PiecePrice = "used" | "cover_ef" | "cover_mef" | "cover_mif" | "on_piece";

export const PIECE_PRICE_LABELS: Record<PiecePrice, string> = {
  used: "used",
  cover_ef: "Cover EF",
  cover_mef: "Cover MeF",
  cover_mif: "Cover MiF",
  on_piece: "On piece",
};

/** One entry on the piece, its prices in the collection currency (null when missing). */
export interface PieceComponent {
  /** The entry's id — a missing-price note points at it. */
  id: string;
  stampId: string;
  /** Described components, not sheets of paper (ADR-0044 §4). */
  quantity: number;
  /** True when the entry is in a multiple format (a pair, a block): its used price is the multiple's. */
  multiple: boolean;
  /** The used price at the entry's own format — a block as a block. */
  used: number | null;
  /** The used price as a single, which decides the most expensive stamp. */
  usedSingle: number | null;
  coverEf: number | null;
  coverMef: number | null;
  coverMif: number | null;
  onPiece: number | null;
}

/** How a cover is franked, by what is on it — counted in stamps, not rows. */
export type CoverUsage = "ef" | "mef" | "mif";

/** Which rule produced the figure — what the Valuation window explains (#2353). */
export type PieceRule =
  /** Every stamp at its used price: the *Sum of used* method, a cover not posted, or a piece whose
   *  format has no kind. */
  | "sum_of_used"
  /** Every stamp at its on-piece price. */
  | "on_piece"
  /** One price of one stamp — Michel's or Fischer FP/FW/FM's EF or MeF, Fischer's EF. */
  | "cover_price"
  /** The highest MiF price among the stamps — Michel's or Fischer FP/FW/FM's MiF. */
  | "highest_mif"
  /** Michel's philatelic, posted cover: the most expensive used price + 15 %. */
  | "philatelic"
  /** Fischer's multiple franking: 150 % of ⊠ for two stamps, the rest at used prices. */
  | "fischer_mef"
  /** Fischer's mixed franking: 50 % of the highest ⊠, the rest at used prices. */
  | "fischer_mif";

export interface MissingPiecePrice {
  /** The entry the price is missing on. */
  componentId: string;
  stampId: string;
  price: PiecePrice;
}

/**
 * One term of the sum the figure is (#2353) — a stamp's price as the rule read it, so the Valuation
 * window can print the arithmetic and the collector can check it against the catalogue: *50 % × Mi
 * 123 ⊠ 40.00*. A price the rule adds but is missing is a term too, with no unit, so the arithmetic
 * shows the gap where it is; a missing price among several compared for the highest is not, since it
 * would not have been added — it is in {@link PieceValueResult.missing} alone.
 */
export interface PieceTerm {
  componentId: string;
  stampId: string;
  price: PiecePrice;
  /** The price read, in the collection currency; null when it is missing. */
  unit: number | null;
  /** The share of `unit` counted: 100, or a rule's 50, 115 or 150. */
  percent: number;
  /** How many times it is counted — an entry's quantity under a summing rule, else 1. */
  times: number;
}

export interface PieceValueResult {
  /** The value in the collection currency, 2-dp — null when nothing it reads is priced. */
  amount: number | null;
  rule: PieceRule;
  /** The figure as a sum, in the order it was reached (#2353). */
  terms: PieceTerm[];
  /** EF, MeF or MiF for a cover valued by its franking; null otherwise. */
  usage: CoverUsage | null;
  /** True when a price the rule reads is missing: the figure, if any, is a lower bound. */
  partial: boolean;
  missing: MissingPiecePrice[];
}

export interface PieceValueInput {
  /** The format's kind; null values the piece by the sum of used prices, whatever the method. */
  kind: PieceKind | null;
  franking: Franking;
  method: ValuationMethod;
  /** In the collector's order. */
  components: readonly PieceComponent[];
}

/** What {@link coverUsage} and {@link piecePricesRead} count by — an entry without its prices. */
type PieceEntryShape = Pick<PieceComponent, "id" | "stampId" | "quantity" | "multiple">;

/** EF, MeF or MiF, counting stamps rather than rows (see the module header). */
export function coverUsage(components: readonly PieceEntryShape[]): CoverUsage {
  const stamps = new Set(components.map((c) => c.stampId));
  if (stamps.size > 1) return "mif";
  const [only] = components;
  if (components.length === 1 && only.quantity === 1 && !only.multiple) return "ef";
  return "mef";
}

/**
 * The piece's **most expensive stamp**: the one with the highest used price as a single — the stamp
 * whose area decides the method, and Michel's philatelic rule's base. Ties and a piece with no used
 * price at all fall to the collector's order. Null only for a piece with no stamps.
 */
export function mostExpensiveStamp(components: readonly PieceComponent[]): string | null {
  let best: PieceComponent | null = null;
  for (const c of components) {
    if (best === null) best = c;
    else if (c.usedSingle !== null && (best.usedSingle === null || c.usedSingle > best.usedSingle)) {
      best = c;
    }
  }
  return best?.stampId ?? null;
}

/** Value a piece by its method. Pure; see the module header for every rule. */
export function valuePiece(input: PieceValueInput): PieceValueResult {
  const { kind, franking, method, components } = input;
  const acc = new Accumulator();

  if (
    components.length === 0 ||
    kind === null ||
    method === "sum_of_used" ||
    (kind === "on_cover" && franking === "not_posted")
  ) {
    for (const c of components) acc.add(c, "used", c.used, c.quantity);
    return acc.result("sum_of_used", null);
  }
  if (kind === "on_piece") {
    for (const c of components) acc.add(c, "on_piece", c.onPiece, c.quantity);
    return acc.result("on_piece", null);
  }

  const usage = coverUsage(components);
  if (method === "michel" && franking === "philatelic_posted") {
    const top = acc.highest(distinctStamps(components), "used", (c) => c.usedSingle);
    if (top !== null) acc.add(top.component, "used", top.value, 1, 115);
    return acc.result("philatelic", usage);
  }

  if (method === "fischer") return fischer(components, usage, acc);

  // Michel, rate-correct — and Fischer FP/FW/FM in every posted franking: the price the franking
  // names, the other stamps adding nothing.
  if (usage === "mif") {
    const top = acc.highest(distinctStamps(components), "cover_mif", (c) => c.coverMif);
    if (top !== null) acc.add(top.component, "cover_mif", top.value, 1);
    return acc.result("highest_mif", usage);
  }
  const [first] = components;
  if (usage === "ef") acc.add(first, "cover_ef", first.coverEf, 1);
  else acc.add(first, "cover_mef", first.coverMef, 1);
  return acc.result("cover_price", usage);
}

/**
 * The prices the value reads for each entry, by its id (#2368) — the fields the piece's stamps are
 * priced in, in place. **Decided by the rule alone, never by the figures**, so a field does not come
 * and go as prices are typed: a price compared for the highest is read whether or not it wins, and
 * under Fischer's mixed franking every stamp's used price is read, the top stamp's included, since
 * which stamp is the top one is a matter of the figures. Mirrors {@link valuePiece} branch by branch.
 */
export function piecePricesRead(
  input: Omit<PieceValueInput, "components"> & { components: readonly PieceEntryShape[] }
): Map<string, PiecePrice[]> {
  const { kind, franking, method, components } = input;
  const read = new Map<string, PiecePrice[]>(components.map((c) => [c.id, []]));
  const add = (c: PieceEntryShape, price: PiecePrice) => {
    const prices = read.get(c.id)!;
    if (!prices.includes(price)) prices.push(price);
  };
  if (
    components.length === 0 ||
    kind === null ||
    method === "sum_of_used" ||
    (kind === "on_cover" && franking === "not_posted")
  ) {
    for (const c of components) add(c, "used");
    return read;
  }
  if (kind === "on_piece") {
    for (const c of components) add(c, "on_piece");
    return read;
  }
  const usage = coverUsage(components);
  if (method === "michel" && franking === "philatelic_posted") {
    for (const c of distinctStamps(components)) add(c, "used");
    return read;
  }
  if (method === "fischer") {
    if (usage === "ef") add(components[0], "cover_mif");
    else if (usage === "mef") {
      const units = fischerUnits(components);
      add(units[0], "cover_mif");
      for (const unit of units.slice(2)) add(unit, "used");
    } else {
      for (const c of distinctStamps(components)) add(c, "cover_mif");
      for (const c of components) add(c, "used");
    }
    return read;
  }
  if (usage === "mif") for (const c of distinctStamps(components)) add(c, "cover_mif");
  else add(components[0], usage === "ef" ? "cover_ef" : "cover_mef");
  return read;
}

/** One unit per stamp, multiples first — Fischer's count (module header). */
function fischerUnits<T extends PieceEntryShape>(components: readonly T[]): T[] {
  return [...components]
    .sort((a, b) => Number(b.multiple) - Number(a.multiple))
    .flatMap((c) => Array.from({ length: c.quantity }, () => c));
}

function fischer(
  components: readonly PieceComponent[],
  usage: CoverUsage,
  acc: Accumulator
): PieceValueResult {
  if (usage === "ef") {
    const [only] = components;
    acc.add(only, "cover_mif", only.coverMif, 1);
    return acc.result("cover_price", usage);
  }
  // One unit per stamp; an entry in a multiple format is one unit of its quantity (module header).
  // Multiples first, so the two stamps priced at ⊠ are taken from them before any loose single.
  const units = fischerUnits(components);

  if (usage === "mef") {
    const [first] = units;
    acc.add(first, "cover_mif", first.coverMif, 1, 150);
    for (const unit of units.slice(2)) acc.add(unit, "used", unit.used, 1);
    return acc.result("fischer_mef", usage);
  }

  // MiF: the stamp with the highest ⊠ — or, with none priced, the most expensive by used price —
  // takes 50 % of its ⊠ for one of its units; every other unit is at its used price.
  const stamps = distinctStamps(components);
  const topMif = acc.highest(stamps, "cover_mif", (c) => c.coverMif);
  const topStampId = topMif !== null ? topMif.component.stampId : mostExpensiveStamp(components);
  if (topMif !== null) acc.add(topMif.component, "cover_mif", topMif.value, 1, 50);
  // A loose copy of the top stamp is the one its ⊠ stands for, where there is one.
  let topIndex = units.findIndex((u) => u.stampId === topStampId && !u.multiple);
  if (topIndex === -1) topIndex = units.findIndex((u) => u.stampId === topStampId);
  units.forEach((unit, index) => {
    if (index !== topIndex) acc.add(unit, "used", unit.used, 1);
  });
  return acc.result("fischer_mif", usage);
}

/** The first entry of each stamp, in the collector's order. */
function distinctStamps<T extends PieceEntryShape>(components: readonly T[]): T[] {
  const seen = new Set<string>();
  return components.filter((c) => {
    if (seen.has(c.stampId)) return false;
    seen.add(c.stampId);
    return true;
  });
}

/** Sums in whole cents, so a breakdown adds up to the figure printed under it. */
class Accumulator {
  private cents = 0;
  private priced = 0;
  readonly missing: MissingPiecePrice[] = [];
  readonly terms: PieceTerm[] = [];

  /** `percent` of `unit`, rounded to the cent, `times` over — a missing unit is noted, not counted. */
  add(c: PieceComponent, price: PiecePrice, unit: number | null, times: number, percent = 100): void {
    this.terms.push({ componentId: c.id, stampId: c.stampId, price, unit, percent, times });
    if (unit === null) {
      this.note(c, price);
      return;
    }
    this.cents += termCents(unit, percent) * times;
    this.priced++;
  }

  /** The highest of `pick` over `stamps`, noting every stamp without one — it could have been higher. */
  highest(
    stamps: readonly PieceComponent[],
    price: PiecePrice,
    pick: (c: PieceComponent) => number | null
  ): { component: PieceComponent; value: number } | null {
    let top: { component: PieceComponent; value: number } | null = null;
    for (const c of stamps) {
      const value = pick(c);
      if (value === null) this.note(c, price);
      else if (top === null || value > top.value) top = { component: c, value };
    }
    return top;
  }

  private note(c: PieceComponent, price: PiecePrice): void {
    if (!this.missing.some((m) => m.componentId === c.id && m.price === price)) {
      this.missing.push({ componentId: c.id, stampId: c.stampId, price });
    }
  }

  result(rule: PieceRule, usage: CoverUsage | null): PieceValueResult {
    return {
      amount: this.priced === 0 ? null : this.cents / 100,
      rule,
      terms: this.terms,
      usage,
      partial: this.missing.length > 0,
      missing: this.missing,
    };
  }
}

/** One term in whole cents — `percent` of `unit`, rounded once — so the printed terms add up. */
export function termCents(unit: number, percent: number): number {
  return Math.round(unit * percent);
}

/**
 * The method a piece is valued by, and where it came from: the copy's own, else the nearest area up
 * from the most expensive stamp's that sets one, else the collection's.
 */
export type MethodSource =
  | { kind: "copy" }
  | { kind: "area"; areaId: string }
  | { kind: "collection" };

export interface ResolvedMethod {
  method: ValuationMethod;
  source: MethodSource;
}

export interface MethodArea {
  id: string;
  parentId: string | null;
  valuationMethod: string | null;
  /** For naming where an inherited method comes from (#2369). */
  name?: string;
}

/**
 * The method a piece has **without** its own (#2369) — the nearest area's or the collection's — and
 * where it comes from: what *As inherited* names beside the method choice. `areaId` null is the
 * collection's default.
 */
export interface InheritedMethod {
  method: ValuationMethod;
  areaId: string | null;
  areaName: string | null;
}

/** The nearest ancestor-or-self area that sets a method, and the method — null when none does. */
export function areaMethod(
  areas: ReadonlyMap<string, MethodArea>,
  areaId: string | null
): { method: ValuationMethod; areaId: string } | null {
  let current = areaId ? areas.get(areaId) : undefined;
  for (let depth = 0; current && depth < 50; depth++) {
    if (isValuationMethod(current.valuationMethod)) {
      return { method: current.valuationMethod, areaId: current.id };
    }
    current = current.parentId ? areas.get(current.parentId) : undefined;
  }
  return null;
}

/** {@link resolveMethod} with no method of the copy's own — what it inherits. */
export function inheritedMethod(
  areas: ReadonlyMap<string, MethodArea>,
  areaId: string | null,
  collectionMethod: ValuationMethod
): InheritedMethod {
  const fromArea = areaMethod(areas, areaId);
  if (!fromArea) return { method: collectionMethod, areaId: null, areaName: null };
  return {
    method: fromArea.method,
    areaId: fromArea.areaId,
    areaName: areas.get(fromArea.areaId)?.name ?? null,
  };
}

export function resolveMethod(
  copyMethod: ValuationMethod | null,
  areas: ReadonlyMap<string, MethodArea>,
  areaId: string | null,
  collectionMethod: ValuationMethod
): ResolvedMethod {
  if (copyMethod) return { method: copyMethod, source: { kind: "copy" } };
  const fromArea = areaMethod(areas, areaId);
  if (fromArea) return { method: fromArea.method, source: { kind: "area", areaId: fromArea.areaId } };
  return { method: collectionMethod, source: { kind: "collection" } };
}
