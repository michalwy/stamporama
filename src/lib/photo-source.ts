// Where a photo came from (#1001, ADR-0049 §3): one free-text field, deliberately not a URL type. A
// reference is usually a screenshot from an auction, Colnect or a forum, but a book citation typed in
// as text is just as legitimate, so nothing checks the shape — only the length.
//
// Pure, so the editor's input and the server that writes the value read the same cap.

/** Long enough for an auction URL with its tracking query left on, short enough to stay a field. */
export const PHOTO_SOURCE_MAX_LENGTH = 2000;

/** The stored form of a typed source: trimmed, blank meaning none. Anything that is not a string is
 * none as well — a change-set arrives as JSON from the form. Does not enforce the cap; see
 * {@link photoSourceTooLong}. */
export function normalizePhotoSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** Whether a normalized source is over the cap. */
export function photoSourceTooLong(source: string | null): boolean {
  return source !== null && source.length > PHOTO_SOURCE_MAX_LENGTH;
}
