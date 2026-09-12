// The stamps a copy carries, **as a form sends them** (ADR-0044) — one hidden JSON field of
// `{ stampId, quantity, formatId }` rows, in the collector's order.
//
// Pure, and apart from `item-stamps.ts` (which is server-only and owns the write), because two
// server actions read the same field: the copy edit dialog's (#746) and the scan-tile
// identification's (#750). A second reader written beside the first would be a second opinion on
// what a malformed row means. The domain validates everything that matters — the stamps belong to
// the collection, no pair repeats, quantities are whole — so this only turns text into rows and
// drops what is not one.

/** One row as the form sends it — structurally `ItemStampEntryInput`, restated rather than imported
 * so this module stays clear of the server-only one that writes the rows. */
export interface ItemStampEntryRow {
  stampId: string;
  quantity: number;
  formatId: string | null;
}

/** The rows in a raw field value, or `undefined` when there is no list to read — absent, blank, not
 * JSON, or not an array — which every caller reads as *leave the stamps alone*. */
export function parseItemStampEntries(raw: unknown): ItemStampEntryRow[] | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const entries: ItemStampEntryRow[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const { stampId, quantity, formatId } = row as Record<string, unknown>;
    if (typeof stampId !== "string" || !stampId) continue;
    entries.push({
      stampId,
      quantity: typeof quantity === "number" ? quantity : 1,
      formatId: typeof formatId === "string" && formatId ? formatId : null,
    });
  }
  return entries;
}

/**
 * Whether a list of stamps says anything **beyond the stamp itself** — a second entry, a quantity
 * above one, or a component format.
 *
 * One entry of quantity 1 with no format is exactly what every ordinary copy carries (#744's
 * backfill and every create path write it), so it is not a *list* in any sense a screen should draw
 * or a repeated identification should carry: it is the stamp. Anything else is the collector having
 * described the piece, and a shortcut that dropped it would repeat a cover as a loose stamp.
 */
export function describesMoreThanTheStamp(
  entries: readonly { quantity?: number; formatId?: string | null }[]
): boolean {
  return (
    entries.length > 1 ||
    entries.some((entry) => (entry.quantity ?? 1) > 1 || Boolean(entry.formatId))
  );
}
