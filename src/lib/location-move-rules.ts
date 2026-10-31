// The rules a copy's location history (#2277, ADR-0074) is read by: what each source is called, which
// way an entry went for a location, and the date range the location's history is narrowed to. Pure
// (no React / Prisma), so the server reads and the screens share them and they are unit-tested.

/** What moved a copy — the `ItemLocationMoveSource` enum, stated here so client code can name it
 *  without importing the generated client. */
export const LOCATION_MOVE_SOURCES = [
  "start",
  "created",
  "copy_form",
  "bulk_edit",
  "purchase",
  "scan",
  "replacement",
  "other",
] as const;
export type LocationMoveSource = (typeof LOCATION_MOVE_SOURCES)[number];

const SOURCE_LABELS: Record<LocationMoveSource, string> = {
  start: "Starting point",
  created: "Added",
  copy_form: "Copy form",
  bulk_edit: "Bulk edit",
  purchase: "Purchase",
  scan: "Scan sheet",
  replacement: "Replacement",
  other: "Other change",
};

/** How an entry's source reads on screen. A purchase is named beside it, as a link, where it can be. */
export function locationMoveSourceLabel(source: LocationMoveSource): string {
  return SOURCE_LABELS[source];
}

/** Which way an entry went, seen from a location and everything under it: into it, out of it, or
 *  from one place in it to another — a copy moved from card 12 to card 13, or between two stockbooks
 *  of one cabinet. An entry touching neither end is not the location's, and reads as `null`. */
export type LocationMoveDirection = "in" | "out" | "within";

export function locationMoveDirection(
  entry: { fromLocationId: string | null; toLocationId: string | null },
  subtree: ReadonlySet<string>
): LocationMoveDirection | null {
  const from = entry.fromLocationId != null && subtree.has(entry.fromLocationId);
  const to = entry.toLocationId != null && subtree.has(entry.toLocationId);
  if (from && to) return "within";
  if (to) return "in";
  if (from) return "out";
  return null;
}

/** A location's own id and every id under it, from one flat read of the collection's locations. */
export function locationSubtreeIds(
  locations: readonly { id: string; parentId: string | null }[],
  locationId: string
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const l of locations) {
    if (!l.parentId) continue;
    const children = childrenByParent.get(l.parentId) ?? [];
    children.push(l.id);
    childrenByParent.set(l.parentId, children);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  const queue = [locationId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return ids;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` day as typed in a date field, or null when it is not one. */
export function parseMoveDay(value: string | null | undefined): string | null {
  const v = value?.trim() ?? "";
  if (!DAY.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** The instants a day range covers, both ends whole days: `from` at its first moment, `to` up to
 *  the first moment of the next day. Either end may be open. Days are UTC days, as the timestamps
 *  are stored. */
export function moveDayRange(
  from: string | null,
  to: string | null
): { gte?: Date; lt?: Date } {
  const range: { gte?: Date; lt?: Date } = {};
  const f = parseMoveDay(from);
  const t = parseMoveDay(to);
  if (f) range.gte = new Date(`${f}T00:00:00.000Z`);
  if (t) {
    const end = new Date(`${t}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    range.lt = end;
  }
  return range;
}
