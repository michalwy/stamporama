// The name a duplicated template is given (#1474). Pure, so the unit suite holds it.
//
// A template is picked by name — an album seeds from one by it, and the collage and ref card
// templates are chosen the same way — so each collection's names are unique and a copy cannot simply
// repeat its source's. *(copy)* says where it came from; a second copy of the same template counts
// on, *(copy 2)*, rather than stacking *(copy) (copy)*. Copying a copy starts from the name the
// collector sees, since the one they are reading is the one they will rename.

/** The first of `Name (copy)`, `Name (copy 2)`, `Name (copy 3)`, … not in `taken`, ignoring case —
 *  the way two names that differ only in case read to a collector picking one from a list. */
export function copyName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.toLocaleLowerCase()));
  const first = `${name} (copy)`;
  if (!used.has(first.toLocaleLowerCase())) return first;
  for (let n = 2; ; n++) {
    const next = `${name} (copy ${n})`;
    if (!used.has(next.toLocaleLowerCase())) return next;
  }
}
