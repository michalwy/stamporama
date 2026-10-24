import { catalogKeyMatches } from "./catalog-number";
import { parseItemNoOnlySearch, parseItemNoSearch } from "./item-number";

// How a copy picker's search box decides that a copy matches (#2136) — the pickers that hold their
// eligible copies on the client and filter them on every keystroke: **Attach existing copies…** on a
// purchase lot, **Add set** on an offer, **Add copies** on a sale and on a trade. The Copies list
// asks the same question on the server (`buildItemWhere`); this is that rule for a list in hand, so
// `#123` means one copy in a picker exactly as it does on the list.
//
// Pure (no React / Prisma). The catalogue keys are the caller's, because building them needs the
// area's vendor map, and they are asked for last so a match on the cheaper fields never builds them.

/** The part of a copy row the search reads. Structural, so any picker's row type fits. */
export interface CopySearchable {
  itemNo: number;
  stampName?: string | null;
  issueName?: string | null;
  locationRef?: string | null;
}

/**
 * Does this copy match what was typed?
 *
 * - `#123` (leading zeros ignored) is **only** copy 123 — nothing else is asked.
 * - Otherwise the copy matches on its stamp's name, its issue's name, its location ref (#303), a
 *   catalogue number (`catalogKeys`, normalized match keys as `catalogKeyMatches` reads them), or —
 *   for a bare number — its own number (#268), beside the catalogue numbers rather than instead.
 *
 * An empty query matches every copy.
 */
export function copyMatchesSearch(
  copy: CopySearchable,
  query: string,
  catalogKeys: () => readonly string[]
): boolean {
  const raw = query.trim();
  if (!raw) return true;
  const onlyItemNo = parseItemNoOnlySearch(raw);
  if (onlyItemNo !== null) return copy.itemNo === onlyItemNo;
  if (parseItemNoSearch(raw) === copy.itemNo) return true;
  const q = raw.toLowerCase();
  if ((copy.stampName ?? "").toLowerCase().includes(q)) return true;
  if ((copy.issueName ?? "").toLowerCase().includes(q)) return true;
  if ((copy.locationRef ?? "").toLowerCase().includes(q)) return true;
  return catalogKeyMatches(raw, catalogKeys());
}
