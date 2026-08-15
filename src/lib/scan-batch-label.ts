/**
 * A scan batch's optional name (#587) — the rule, in the one place both halves can read it.
 *
 * Pure and owned by neither side, the rule AGENTS.md states for exactly this shape: the ceiling is
 * enforced by the write (`setBatchLabel`, `uploadSheet`) and stated by the input the collector
 * types into, and a `server-only` module cannot be the source of a constant a client component
 * needs. Two copies of the number is how a field that accepts 60 characters gets refused at 40.
 *
 * **The number stays primary.** A batch is found by its number — assigned rather than chosen — and
 * the name is a gloss on it: *Klaser Polska 1*, *Zestawy 3–5*. Short enough to sit beside the
 * number on one line, including on a collapsed batch's single summary line (#583), because a name
 * that wraps is a note about the card rather than a name for it.
 */

/** The longest a card's name may be. */
export const MAX_BATCH_LABEL_LENGTH = 60;

/** What a typed name comes to: trimmed, or **null** for none. An empty name is one state and not
 * two — the call `ScanTile.note` already makes — so a cleared field genuinely un-names the card
 * rather than leaving an empty string that reads as a name nobody can see. */
export function normalizeBatchLabel(label: string | null | undefined): string | null {
  const trimmed = label?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The name a scan defaults to: the uploaded file's own, without its extension (#603).
 *
 * The collector already named the card once — at the scanner, choosing where to save it — and
 * *Klaser Polska 1.jpg* is the same gloss they would otherwise type again beside the button. So the
 * blank field falls back to it rather than leaving the batch nameless, which is the state #587's
 * whole point is that a strip of thumbnails cannot be read out of a week later.
 *
 * **A derived name is never refused and never mangled.** `isBatchLabelTooLong` refuses what the
 * collector typed, because shortening their wording is worse than saying no; here there is no
 * wording to preserve and no question to put — a scanner's long file name must not be the reason an
 * upload fails — so an over-long one yields **null** and the card is simply unnamed, exactly as it
 * was before this defaulted anything. Naming it afterwards is the rename #587 already carries.
 *
 * Only the extension goes: a name is left otherwise as it was found, underscores and all. Tidying
 * it would be guessing at wording the collector chose, and a name that came back different from the
 * file on disk is no longer the same name.
 */
export function batchLabelFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.[^./\\]+$/, "");
  const label = normalizeBatchLabel(base);
  return isBatchLabelTooLong(label) ? null : label;
}

/** Whether a typed name is short enough to store. Asked by the write; the input's `maxLength`
 * makes it unreachable from the screen, which is why this is a refusal rather than a truncation —
 * silently shortening a name the collector chose is worse than saying it is too long. */
export function isBatchLabelTooLong(label: string | null): boolean {
  return label != null && label.length > MAX_BATCH_LABEL_LENGTH;
}
