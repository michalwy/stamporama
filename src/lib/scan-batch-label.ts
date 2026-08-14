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

/** Whether a typed name is short enough to store. Asked by the write; the input's `maxLength`
 * makes it unreachable from the screen, which is why this is a refusal rather than a truncation —
 * silently shortening a name the collector chose is worse than saying it is too long. */
export function isBatchLabelTooLong(label: string | null): boolean {
  return label != null && label.length > MAX_BATCH_LABEL_LENGTH;
}
