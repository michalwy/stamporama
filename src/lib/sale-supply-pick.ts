// What a sale's supply-line dialog offers and how many units it lets a line take (#2229). Pure, so
// the window and its tests read one rule; the server holds the same one (`sale-supplies.ts`), so a
// stale window cannot get past it.
//
// The parcel was packed from what is on the shelf, so a line added by hand names only a supply with
// units on hand, and takes no more than there are. A line being changed keeps its own supply listed
// even when none is left, and counts what it already took as available: its quantity can be kept or
// lowered, and raised only by what is on hand.

/** A supply as the picker reads it. */
export interface SupplyOnHand {
  id: string;
  name: string;
  onHand: number;
}

/** The line being changed: its supply and the units it used. */
export interface PickedSupplyLine {
  supplyId: string;
  quantity: number;
}

/** The supplies a line can name, in the order given: those with units on hand and, when a line is
 * being changed, its own. */
export function saleSupplyOptions<T extends SupplyOnHand>(
  supplies: readonly T[],
  line?: PickedSupplyLine
): T[] {
  return supplies.filter((s) => s.onHand > 0 || s.id === line?.supplyId);
}

/** How many units a line of `supplyId` can have: what is on hand, plus what the line being changed
 * already used when it names that supply. A line still short of units is one with nothing left on
 * hand, so its own quantity is its limit — kept or lowered, never raised. */
export function saleSupplyLimit(
  supplies: readonly SupplyOnHand[],
  supplyId: string,
  line?: PickedSupplyLine
): number {
  const onHand = supplies.find((s) => s.id === supplyId)?.onHand ?? 0;
  return line?.supplyId === supplyId ? onHand + line.quantity : onHand;
}

/** The option's label: the supply and what is on hand, so the limit is seen before typing. */
export function saleSupplyOptionLabel(supply: SupplyOnHand): string {
  return `${supply.name} — ${supply.onHand} on hand`;
}

/** The quantity field's error, or null. Only a whole number above the limit is the window's to
 * refuse; anything else that is not a quantity is the server's message, as before. */
export function saleSupplyQuantityError(raw: string, limit: number): string | null {
  const quantity = Number(raw.trim());
  if (!raw.trim() || !Number.isInteger(quantity) || quantity <= limit) return null;
  return `Max ${limit}`;
}
