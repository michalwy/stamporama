/**
 * Moving down a list of price fields with the keyboard (#2031, #2489): Enter and Tab go to the next
 * row's price, Shift+Tab to the previous one's.
 *
 * The rows are given in the order drawn; `hasField` says which of them carry a price field at the
 * moment, so a row without one is stepped over. `null` means there is no price field that way — the
 * list's edge — and the key does what it does anywhere else.
 */
export function priceListStep(
  orderedIds: readonly string[],
  fromId: string,
  step: 1 | -1,
  hasField: (id: string) => boolean
): string | null {
  const index = orderedIds.indexOf(fromId);
  if (index < 0) return null;
  for (let i = index + step; i >= 0 && i < orderedIds.length; i += step) {
    if (hasField(orderedIds[i])) return orderedIds[i];
  }
  return null;
}
