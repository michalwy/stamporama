import { parsePriceCellInput } from "./catalog-price-mark";
import { PIECE_PRICE_LABELS, type PiecePrice } from "./piece-valuation";

// A piece's stamp prices typed in place (#2368) — in identification and in the piece's Valuation
// window, the way a checklist run asks for its prices. Pure: which row carries which field, and what
// a save sends. The read and the write are `piece-prices.ts`.
//
// A field is a **stamp × price** — the used price (the single's, as every quick price is) or one of
// the four prices on cover and on piece, at the piece's condition, no certificate, the latest edition
// of the stamp's main catalogue: exactly the price the value reads.

/** A field's key: one stamp's one price. */
export function piecePriceKey(stampId: string, price: PiecePrice): string {
  return `${stampId}|${price}`;
}

/** The stamp and the price a field's key names — the inverse of {@link piecePriceKey}. */
export function piecePriceOfKey(key: string): { key: string; stampId: string; price: PiecePrice } {
  const at = key.lastIndexOf("|");
  return { key, stampId: key.slice(0, at), price: key.slice(at + 1) as PiecePrice };
}

/** A price typed for a stamp, raw from its field — what the preview and the save carry. */
export interface TypedPiecePrice {
  stampId: string;
  price: PiecePrice;
  amount: string;
}

/** Where a row's price is typed: on this row, or on the earlier row `entryIndex` names. */
export interface PiecePriceSlot {
  key: string;
  stampId: string;
  price: PiecePrice;
  /** The row (0-based) whose field it is — the first in the list to read this stamp's price. */
  entryIndex: number;
}

/** One variant of an umbrella on the piece, with a slot for each price its umbrella's row reads. */
export interface PieceVariantSlots {
  stampId: string;
  slots: PiecePriceSlot[];
}

export interface PieceRowSlots {
  /** The row's own fields, in column order — empty for an umbrella, priced through its variants. */
  slots: PiecePriceSlot[];
  /** The umbrella's variants, each with its fields; null for a stamp without variants. */
  variants: PieceVariantSlots[] | null;
}

/**
 * Which field each row of the piece's stamps carries (#2368). Each row asks for the prices the value
 * reads for it (`read`, from `piecePricesRead`), in `columns` order; a stamp × price asked by an
 * earlier row is not asked again — the later row shows it *as #n*, as a checklist run's row does, so
 * Tab never visits one figure twice. An umbrella's row asks the same prices of each of its variants
 * (`variantsOf`, in tree order) instead of its own, as a run's row on an umbrella does.
 */
export function piecePriceSlots(
  rows: readonly { id: string; stampId: string }[],
  read: ReadonlyMap<string, readonly PiecePrice[]>,
  columns: readonly PiecePrice[],
  variantsOf: (stampId: string) => readonly string[] | null
): PieceRowSlots[] {
  const owner = new Map<string, number>();
  const slot = (stampId: string, price: PiecePrice, index: number): PiecePriceSlot => {
    const key = piecePriceKey(stampId, price);
    if (!owner.has(key)) owner.set(key, index);
    return { key, stampId, price, entryIndex: owner.get(key)! };
  };
  return rows.map((row, index) => {
    const prices = columns.filter((p) => read.get(row.id)?.includes(p));
    const variants = variantsOf(row.stampId);
    if (variants) {
      return {
        slots: [],
        variants: variants.map((stampId) => ({
          stampId,
          slots: prices.map((p) => slot(stampId, p, index)),
        })),
      };
    }
    return { slots: prices.map((p) => slot(row.stampId, p, index)), variants: null };
  });
}

/**
 * What a save writes, and what the value previews with (#2368): every field whose typed figure says
 * something other than what is on file. A blank field records nothing and deletes nothing, as on
 * every quick price; `1,50` and `1.50` are the same figure, `-` and `?` the catalogue's marks. A field
 * holding something that is not a price is left out and reported as `invalid`, which the save refuses
 * and the preview simply does not read yet.
 */
export function changedPiecePrices(
  typed: Readonly<Record<string, string>>,
  recorded: (key: string) => string | null,
  fields: readonly Pick<PiecePriceSlot, "key" | "stampId" | "price">[]
): { changes: TypedPiecePrice[]; invalid: boolean } {
  const changes: TypedPiecePrice[] = [];
  let invalid = false;
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    const raw = typed[f.key];
    if (raw === undefined) continue;
    const cell = parsePriceCellInput(raw);
    if (cell.kind === "empty") continue;
    if (cell.kind === "invalid") {
      invalid = true;
      continue;
    }
    const before = parsePriceCellInput(recorded(f.key) ?? "");
    const same =
      cell.kind === "mark"
        ? before.kind === "mark" && before.mark === cell.mark
        : before.kind === "amount" && Math.round(before.amount * 100) === Math.round(cell.amount * 100);
    if (!same) changes.push({ stampId: f.stampId, price: f.price, amount: raw.trim() });
  }
  return { changes, invalid };
}

/** The typed prices a client sent, kept only where each is the shape one is — a server action's
 *  input is not to be trusted to be. */
export function parseTypedPiecePrices(value: unknown): TypedPiecePrice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v: unknown) => {
    if (typeof v !== "object" || v === null) return [];
    const { stampId, price, amount } = v as Record<string, unknown>;
    if (typeof stampId !== "string" || typeof amount !== "string") return [];
    if (typeof price !== "string" || !Object.hasOwn(PIECE_PRICE_LABELS, price)) return [];
    return [{ stampId, price: price as PiecePrice, amount }];
  });
}
