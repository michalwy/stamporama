// An intake document's note (#2378) — pure, so the screen, the server action and the agent API hold
// one rule for what is stored.

/**
 * The note as stored: the whitespace around it gone (ADR-0055 trims every write again), Windows line
 * endings made plain ones, and **null when nothing is left** — an emptied note is no note, never an
 * empty string. Line breaks inside are kept: they are the only formatting a note has.
 */
export function normalizePurchaseNote(note: string | null | undefined): string | null {
  const text = (note ?? "").replace(/\r\n?/g, "\n").trim();
  return text === "" ? null : text;
}
