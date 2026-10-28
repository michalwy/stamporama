/**
 * The figures beside a sale's **Sold units** heading (#2231): how many sets and copies the sale holds
 * and how far the packing has got — *12 sets · 87 copies · 40 packed* — so the collector does not add
 * the cards up by hand.
 *
 * It counts the **whole sale**: the toolbar's Packed and Set filters narrow the list, not the totals.
 * Every sold set counts, a set on no offer and one whose set is not chosen included, and a copy is a
 * physical piece, as on a set's card — a cover with several stamps on it is one copy.
 */

/**
 * The summary for a sale's `lines` with `unpackedCount` of their copies not yet packed, or null for a
 * sale with no sold sets. Every copy packed reads *all packed*; a sale whose sets hold no copies says
 * nothing about packing.
 */
export function soldUnitsSummary(lines: readonly { copyCount: number }[], unpackedCount: number): string | null {
  if (lines.length === 0) return null;
  const copies = lines.reduce((sum, l) => sum + l.copyCount, 0);
  const parts = [plural(lines.length, "set", "sets"), plural(copies, "copy", "copies")];
  if (copies > 0) parts.push(unpackedCount === 0 ? "all packed" : `${Math.max(0, copies - unpackedCount)} packed`);
  return parts.join(" · ");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
