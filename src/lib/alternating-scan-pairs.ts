/**
 * Fronts and backs scanned alternately, paired into cards (#2163) — the pure half of *Add card
 * scans* in its *Fronts and backs, alternating* form.
 *
 * The collector scans a stack front, back, front, back, and the scanner names the files in that
 * order. **Paired by file name order** (settled with the collector on 2026-10-25): sorted by name,
 * the first file is a front, the second its back, the third the next front, and so on. Sorted the way
 * a person reads the names — `scan 2` before `scan 10` — since a scanner numbering its files without
 * leading zeros is the ordinary case, and a plain string sort would pair the tenth scan with the
 * second.
 *
 * **The pairing is derived, never stored**: an order of files and the fronts said to have no back.
 * Marking a front as having none moves every file after it up by one — a skipped back scan is
 * exactly one missing file, and everything after it is one place off — and swapping a pair exchanges
 * the two files in the order. An odd count leaves the last front without a back, which falls out of
 * the walk rather than being a rule of its own.
 */

export interface ScanPair<T> {
  front: T;
  back: T | null;
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The files in the order they were scanned, as their names say. */
export function sortByFileName<T extends { name: string }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => byName.compare(a.name, b.name));
}

/**
 * Walk the order two files at a time: a front and the file after it as its back — unless the front
 * is said to have none, or it is the last file, when it is a card of its own and the next file is the
 * next front. A file said to have no back but standing where a back goes is a back: the mark is a
 * front's.
 */
export function pairAlternating<T>(
  order: readonly T[],
  noBack: ReadonlySet<T> = new Set()
): ScanPair<T>[] {
  const pairs: ScanPair<T>[] = [];
  let i = 0;
  while (i < order.length) {
    const front = order[i];
    if (noBack.has(front) || i + 1 >= order.length) {
      pairs.push({ front, back: null });
      i += 1;
    } else {
      pairs.push({ front, back: order[i + 1] });
      i += 2;
    }
  }
  return pairs;
}

/**
 * Exchange a pair's front and back in the order. Neither file keeps a *no back* mark: the front that
 * had one has a back by definition, and a mark left on the file now standing as the back would come
 * back to life the moment a shift made it a front again.
 */
export function swapPair<T>(
  order: readonly T[],
  noBack: ReadonlySet<T>,
  pair: ScanPair<T>
): { order: T[]; noBack: Set<T> } {
  const next = [...order];
  const nextNoBack = new Set(noBack);
  if (pair.back == null) return { order: next, noBack: nextNoBack };
  const f = next.indexOf(pair.front);
  const b = next.indexOf(pair.back);
  if (f < 0 || b < 0) return { order: next, noBack: nextNoBack };
  next[f] = pair.back;
  next[b] = pair.front;
  nextNoBack.delete(pair.front);
  nextNoBack.delete(pair.back);
  return { order: next, noBack: nextNoBack };
}

/** Say a front has no back, or take that back — every pair after it shifts by one either way. */
export function toggleNoBack<T>(noBack: ReadonlySet<T>, front: T): Set<T> {
  const next = new Set(noBack);
  if (next.has(front)) next.delete(front);
  else next.add(front);
  return next;
}
