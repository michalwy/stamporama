// The order of an issue's checklists among themselves, or of the checklists spanning issues (#1617,
// #2679). Pure, so `pnpm test:unit` holds the rule; `reorderChecklists` writes what it answers, and
// the agent API's `order_checklists` reads it beforehand to say whether a call changes anything.

/**
 * **The ids sent take the places they held among themselves, in the order sent; every other id keeps
 * its place.** An editor with specialised checklists switched off sends only the standard ones, and
 * the hidden ones must stay where they stand rather than be pushed to whichever end a renumbering of
 * the visible ones leaves them (#1617). An id not in `current`, and a repeat, is ignored.
 */
export function placeAmongThemselves(current: readonly string[], sent: readonly string[]): string[] {
  const own = new Set(current);
  const placing = sent.filter((id, i) => own.has(id) && sent.indexOf(id) === i);
  const placingSet = new Set(placing);
  let next = 0;
  return current.map((id) => (placingSet.has(id) ? placing[next++] : id));
}
