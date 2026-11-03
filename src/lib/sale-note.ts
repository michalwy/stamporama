/**
 * A sale's note (#2379) — the pure half: what is stored, what a merge keeps, and how an agent API
 * write of it is put into words for the *to review* marker.
 *
 * The note is the collector's own remark about a sale — what was agreed with the buyer, a promised
 * extra, why the parcel waits. Plain multi-line text with nothing formatted, one per sale, and
 * **private**: nothing that leaves the app reads it.
 */

/** What is stored for a note as written: its ends trimmed (the rule every write follows, ADR-0055),
 *  and nothing — null — for a note that is blank, so *no note* has one form. Line breaks inside it
 *  are kept. */
export function normalizeSaleNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** The remaining sale's note after a merge (#2041): its own, with the other's below it after a blank
 *  line — the collector chose on 2026-11-03 that nothing written is lost. Either alone is kept as it
 *  is; neither is none. */
export function mergedSaleNote(remaining: string | null, other: string | null): string | null {
  const kept = normalizeSaleNote(remaining);
  const joined = normalizeSaleNote(other);
  if (kept === null) return joined;
  if (joined === null) return kept;
  return `${kept}\n\n${joined}`;
}

/** What an agent API write of the note says on the marker (#1948): the note is long and private, so
 *  the marker names the act and not the text. */
export function saleNoteAction(stored: string | null): string {
  return stored === null ? "cleared the note" : "set the note";
}
