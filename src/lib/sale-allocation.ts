// Pure sale profit/loss allocation engine (ADR-0012 §6). No Prisma / server-only imports,
// so it is unit-testable in isolation (`pnpm test:unit`); the server (#166/#168) assembles
// the inputs from `Sale`/`SaleLine`/`SaleLineItem`/`Item` and surfaces the result.
//
// Symmetric to the purchase allocation engine (`purchase-allocation.ts`, #119), but the
// money flows the other way and the shared amounts have signs:
//
//   1. A sale's three shared amounts are each distributed across ALL lines proportionally
//      to line sale price (transaction currency):
//        - buyer-paid handling  (+)  adds to proceeds,
//        - my actual shipping   (−)  subtracts,
//        - platform commission  (−)  subtracts.
//      Each is a non-negative amount split by the same price weights, so the same
//      largest-remainder apportionment as purchases applies unchanged.
//   2. A line's net proceeds (transaction currency) = price + handlingShare − shippingShare
//      − commissionShare. This can be negative (a line whose fees exceed its price).
//   3. The net is converted to the base currency at the FX rate frozen at the sale date
//      (ADR-0012 §4), then distributed to the line's `Item`s proportionally to the
//      primary-catalog price for each item's condition × certificate (ADR-0006) — the same
//      weight the purchase engine uses, so a komplet's items split symmetrically.
//   4. Per item: P/L = net proceeds (base) − `Item.costBasis` (base). A `null` cost-basis
//      (lot still open / channel wrote no cost) yields a `null` P/L, never a phantom profit.
//
// Rounding: everything reconciles to the cent via integer-cent largest-remainder
// apportionment. Each shared amount's shares sum exactly to that amount; per-item proceeds
// sum exactly to the line's base-currency net.

/** A priced line of a sale — one unit lot or sub-lot that was sold. */
export interface SaleLineInput {
  id: string;
  /** Line sale price in the sale's transaction currency (>= 0). */
  price: number;
}

/** The shared amounts of a whole sale, in its single transaction currency. */
export interface SaleSharedAmounts {
  /** Buyer-paid handling/postage collected from the buyer; adds to proceeds (>= 0). */
  buyerHandling: number;
  /** My actual shipping/postage cost; subtracts from proceeds (>= 0). */
  shippingCost: number;
  /** Platform commission/fees, entered manually; subtracts from proceeds (>= 0). */
  commission: number;
  /** Base-currency rate frozen at the sale date; null when base == transaction currency. */
  fxRateToBase: number | null;
}

/** One line with the three shared amounts apportioned to it and its resolved net. */
export interface SaleLineNet {
  id: string;
  price: number;
  /** This line's share of buyer handling (transaction currency, +). */
  handlingShare: number;
  /** This line's share of my shipping (transaction currency, −). */
  shippingShare: number;
  /** This line's share of the commission (transaction currency, −). */
  commissionShare: number;
  /** price + handlingShare − shippingShare − commissionShare, transaction currency, 2 dp. */
  netTx: number;
  /** netTx converted to the base currency at the frozen FX rate, 2 dp. */
  netBase: number;
}

/** An item participating in a sale line's proceeds split. */
export interface SaleLineItemInput {
  id: string;
  /**
   * Primary-catalog price for this item's condition × certificate, used as the distribution
   * weight (expressed in a unit consistent across the line's items — base currency
   * recommended). `null` means no matching catalog price, which blocks a multi-item split
   * (ADR-0012 §6). Irrelevant for a single-item line (that item takes the whole net).
   */
  catalogPrice: number | null;
}

/** A per-item net-proceeds share of a line (base currency, 2 dp). */
export interface ItemProceeds {
  itemId: string;
  /** Net proceeds attributed to this copy in the base currency (may be negative). */
  proceeds: number;
}

/** Why a line's per-item proceeds split was rejected. */
export type SaleLineBlockReason =
  /** A multi-item line has one or more items lacking a primary-catalog price. */
  | "missing-price"
  /** A multi-item line's net is non-zero but every item has a zero-price weight. */
  | "zero-weight";

/** Thrown when a line's proceeds cannot be split across its items; carries the item ids. */
export class SaleLineBlockedError extends Error {
  readonly reason: SaleLineBlockReason;
  readonly itemIds: string[];
  constructor(reason: SaleLineBlockReason, itemIds: string[]) {
    super(
      reason === "missing-price"
        ? `Cannot split sale line: ${itemIds.length} item(s) lack a primary-catalog price`
        : `Cannot split sale line: net is non-zero but every item has a zero-price weight`
    );
    this.name = "SaleLineBlockedError";
    this.reason = reason;
    this.itemIds = itemIds;
  }
}

/** Round a money amount to whole cents (2 dp), guarding against binary-float drift. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Split a NON-NEGATIVE `total` across `weights` so the parts sum EXACTLY to `total` at cent
 * granularity (largest-remainder / Hamilton apportionment). Returns 2-dp amounts.
 *
 * - A zero `total` yields all-zero parts regardless of weights.
 * - A positive `total` with a non-positive weight base throws — no meaningful split.
 * - Negative weights are treated as zero.
 */
function apportionNonNeg(total: number, weights: number[]): number[] {
  const totalCents = toCents(total);
  if (totalCents === 0) return weights.map(() => 0);

  const safe = weights.map((w) => (w > 0 ? w : 0));
  const base = safe.reduce((s, w) => s + w, 0);
  if (base <= 0) throw new Error("apportion: positive total with zero weight base");

  const exact = safe.map((w) => (totalCents * w) / base);
  const floors = exact.map((c) => Math.floor(c));
  let remaining = totalCents - floors.reduce((s, c) => s + c, 0);

  // Hand out the leftover cents to the largest fractional remainders; ties break toward the
  // earlier index so the result is deterministic.
  const order = exact
    .map((c, i) => ({ i, frac: c - Math.floor(c) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const cents = floors.slice();
  for (const { i } of order) {
    if (remaining <= 0) break;
    cents[i] += 1;
    remaining -= 1;
  }
  return cents.map((c) => c / 100);
}

/**
 * Split a possibly-negative `total` across non-negative `weights`, summing exactly to `total`.
 * A sale line's net can be negative (fees exceed price), so proceeds distribution needs a
 * signed apportionment: apportion the magnitude, then re-apply the sign.
 */
function apportionSigned(total: number, weights: number[]): number[] {
  if (toCents(total) >= 0) return apportionNonNeg(total, weights);
  return apportionNonNeg(-total, weights).map((v) => -v);
}

/** Convert a transaction-currency amount to the base currency at the frozen rate (2 dp). */
function toBase(amountTx: number, fxRateToBase: number | null): number {
  if (fxRateToBase == null) return toCents(amountTx) / 100;
  return toCents(amountTx * fxRateToBase) / 100;
}

/**
 * Distribute the sale's three shared amounts across every line by sale price (ADR-0012 §6.1),
 * then resolve each line's net in both the transaction and base currency. Each shared amount's
 * shares sum exactly to that amount.
 */
export function distributeSaleShared(
  shared: SaleSharedAmounts,
  lines: SaleLineInput[]
): SaleLineNet[] {
  const weights = lines.map((l) => l.price);
  const handling = apportionNonNeg(shared.buyerHandling, weights);
  const shipping = apportionNonNeg(shared.shippingCost, weights);
  const commission = apportionNonNeg(shared.commission, weights);

  return lines.map((l, i) => {
    const netTx = toCents(l.price + handling[i] - shipping[i] - commission[i]) / 100;
    return {
      id: l.id,
      price: l.price,
      handlingShare: handling[i],
      shippingShare: shipping[i],
      commissionShare: commission[i],
      netTx,
      netBase: toBase(netTx, shared.fxRateToBase),
    };
  });
}

/**
 * Distribute a line's base-currency net proceeds to its items by catalog-price weight
 * (ADR-0012 §6.3). Shares sum exactly to `netBase`.
 *
 * A single-item line short-circuits: that copy takes the whole net regardless of its catalog
 * price (there is nothing to weigh it against). A multi-item line requires every item to carry
 * a positive catalog-price weight.
 *
 * @throws {SaleLineBlockedError} `missing-price` if any item has a null weight; `zero-weight`
 *   if the net is non-zero but every item weighs zero.
 */
export function allocateSaleLine(
  netBase: number,
  items: SaleLineItemInput[]
): ItemProceeds[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ itemId: items[0].id, proceeds: toCents(netBase) / 100 }];
  }

  const missing = items.filter((it) => it.catalogPrice == null).map((it) => it.id);
  if (missing.length > 0) throw new SaleLineBlockedError("missing-price", missing);

  const weights = items.map((it) => it.catalogPrice as number);
  const weightBase = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  if (weightBase <= 0 && toCents(netBase) !== 0) {
    throw new SaleLineBlockedError(
      "zero-weight",
      items.map((it) => it.id)
    );
  }

  const shares = apportionSigned(netBase, weights);
  return items.map((it, i) => ({ itemId: it.id, proceeds: shares[i] }));
}

/** One line of a sale together with the copies that left on it. */
export interface SaleLineWithItems extends SaleLineInput {
  items: SaleLineItemInput[];
}

/** A per-item result across a whole sale: its line, its base-currency net proceeds, and — when
 * a cost-basis is known — its profit/loss. */
export interface SaleItemResult {
  itemId: string;
  lineId: string;
  /** Net proceeds attributed to this copy in the base currency (may be negative). */
  proceeds: number;
}

/**
 * End-to-end allocation of a whole sale: distribute the shared amounts to lines, then split
 * each line's base-currency net across its items. Lines are independent, so a partial
 * quantity-lot sale is just a sale with a line per sold sub-lot.
 *
 * @throws {SaleLineBlockedError} propagated from `allocateSaleLine` for a blocked line.
 */
export function allocateSale(
  shared: SaleSharedAmounts,
  lines: SaleLineWithItems[]
): SaleItemResult[] {
  const nets = distributeSaleShared(shared, lines);
  return lines.flatMap((line, i) =>
    allocateSaleLine(nets[i].netBase, line.items).map((p) => ({
      itemId: p.itemId,
      lineId: line.id,
      proceeds: p.proceeds,
    }))
  );
}

/**
 * Profit/loss for one copy: base-currency net proceeds minus its base-currency cost-basis
 * snapshot (ADR-0012 §6.4). A `null` cost-basis (pending / unknown) yields a `null` P/L —
 * reporting must treat that as "not yet computable", never as pure profit.
 */
export function itemProfitLoss(proceeds: number, costBasis: number | null): number | null {
  if (costBasis == null) return null;
  return toCents(proceeds - costBasis) / 100;
}
