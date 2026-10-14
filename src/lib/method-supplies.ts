// A shipping method's usual packing supplies, applied to a sale (#1899, ADR-0068 §8). Pure — the
// writes are `sales.ts`'s, which call this whenever a sale's method is chosen or changed.
//
// The rule, as the issue states it: **choosing a method fills in its supply lines**, which stay
// editable on the sale; **changing the method replaces the lines that still match the old method's
// list** and leaves the lines the collector changed by hand. A method with no list fills in none.
//
// "Still matches" is read off the line itself — the same supply at the same quantity as an entry of
// the old method's list — rather than off a flag, so a line edited back to its default counts as
// untouched again, and nothing has to be stored to tell the two apart.

/** One entry of a method's list, or a line to add to a sale. */
export interface SupplyQuantity {
  supplyId: string;
  quantity: number;
}

/** One of a sale's supply lines as it stands. */
export interface SaleSupplyLineState extends SupplyQuantity {
  id: string;
}

export interface MethodSuppliesChange {
  /** The sale's lines that were the old method's defaults and are not the new one's. */
  remove: string[];
  /** The new method's entries the sale does not already carry. */
  add: SupplyQuantity[];
}

/**
 * What changing a sale's method from one whose list is `before` to one whose list is `after` does to
 * the sale's supply lines. A sale being recorded has no lines and `before` empty, so it simply gets
 * `after`.
 *
 * - A line matching an entry of `before` (supply and quantity) is **untouched**; each entry matches
 *   one line at most. Every other line was the collector's and stays.
 * - An untouched line that is also exactly an entry of `after` stays as it is, rather than being
 *   given back to stock and taken again.
 * - Every other untouched line goes.
 * - An entry of `after` is added unless the sale keeps a line of that supply already — a hand-edited
 *   line says how much of it this parcel used, and a second line beside it would double it.
 */
export function changeMethodSupplies(
  lines: readonly SaleSupplyLineState[],
  before: readonly SupplyQuantity[],
  after: readonly SupplyQuantity[]
): MethodSuppliesChange {
  const untouched = new Set<string>();
  for (const entry of before) {
    const match = lines.find(
      (l) => !untouched.has(l.id) && l.supplyId === entry.supplyId && l.quantity === entry.quantity
    );
    if (match) untouched.add(match.id);
  }

  const staying = new Set(lines.filter((l) => !untouched.has(l.id)).map((l) => l.id));
  const add: SupplyQuantity[] = [];
  for (const entry of after) {
    const same = lines.find(
      (l) =>
        untouched.has(l.id) &&
        !staying.has(l.id) &&
        l.supplyId === entry.supplyId &&
        l.quantity === entry.quantity
    );
    if (same) {
      staying.add(same.id);
      continue;
    }
    const kept = lines.some((l) => staying.has(l.id) && l.supplyId === entry.supplyId);
    if (!kept) add.push({ supplyId: entry.supplyId, quantity: entry.quantity });
  }

  return { remove: lines.filter((l) => !staying.has(l.id)).map((l) => l.id), add };
}
