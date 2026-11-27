// The pure half of the administrator's panel (#2719): figures and the checks a deletion is asked
// through. No Prisma, no `server-only` — `pnpm test:unit` holds it.

/** What one backend, or several added up, holds. */
export interface StorageFigure {
  bytes: number;
  objects: number;
}

/** Add storage figures: a collection across its backends, an account across its collections. */
export function sumStorage(figures: readonly StorageFigure[]): StorageFigure {
  return figures.reduce<StorageFigure>(
    (total, figure) => ({ bytes: total.bytes + figure.bytes, objects: total.objects + figure.objects }),
    { bytes: 0, objects: 0 }
  );
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Bytes for a person: binary steps, one decimal below ten of a unit and none above, so a column of
 * them reads at a glance — `0 B`, `812 B`, `4.2 MB`, `37 MB`, `1.3 GB`.
 */
export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  // 1023.6 KB rounds to 1024 KB; say 1 MB instead.
  if (rounded >= 1024 && unit < UNITS.length - 1) return `1 ${UNITS[unit + 1]}`;
  return `${rounded} ${UNITS[unit]}`;
}

/**
 * Whether what was typed confirms a deletion: the name of the thing, exactly, apart from the
 * whitespace around it. Deleting a collection or an account cannot be undone, so the panel asks for
 * the name rather than a second click.
 */
export function deletionConfirmed(typed: string, expected: string): boolean {
  const wanted = expected.trim();
  return wanted.length > 0 && typed.trim() === wanted;
}

/** One table that hangs off `collection` by a cascading foreign key, as the database reports it. */
export interface CollectionTable {
  table: string;
  column: string;
}

/**
 * Which tables to try next when emptying a collection table by table (`admin.ts`): the ones not yet
 * emptied, and whether a whole pass got nowhere — every remaining table refused, so another pass
 * would refuse the same way.
 */
export function nextDeletionPass(
  remaining: readonly CollectionTable[],
  refused: readonly CollectionTable[]
): { retry: readonly CollectionTable[]; stuck: boolean } {
  return { retry: refused, stuck: refused.length > 0 && refused.length === remaining.length };
}
