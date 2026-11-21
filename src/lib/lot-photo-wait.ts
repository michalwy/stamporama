import type { PrepareOffer } from "./offers";
import { isPhotoRunBlocker } from "./offer-photo-readiness";

// A lot on a proposal's or a post's screen that waits on its photos (#1893, #2114): *Mark ready* on a
// lot without them generates them first and the lot turns Ready once they are done, in the background.
// The screen asks after those lots alone, as Prepare rows, while they wait — and a lot whose wait is
// over is read again whole (#2639): its Prepare row alone carries no state the row, its actions, the
// bulk actions and the proposal's or post's own moves are drawn from.

/** Whether a lot's Prepare row waits on its photos: to turn Ready once they are done, or — a Ready lot
 *  whose photos are being made again — for them before it can go up. */
export function awaitsPhotos(row: PrepareOffer): boolean {
  return row.readyAfterPhotos || row.readyBlockers.some(isPhotoRunBlocker);
}

/** The lots whose Prepare row waits on their photos. */
export function lotsAwaitingPhotos(rows: Record<string, PrepareOffer> | null | undefined): string[] {
  return Object.values(rows ?? {})
    .filter(awaitsPhotos)
    .map((row) => row.id);
}

/** Of the lots asked after, those whose wait is over in the fresh rows — no longer waiting, or with no
 *  Prepare row any more (neither Preparing nor Ready). Null rows (the post gone up) end every wait. */
export function lotsDoneWaiting(asked: readonly string[], fresh: Record<string, PrepareOffer> | null): string[] {
  return asked.filter((id) => {
    const row = fresh?.[id];
    return !row || !awaitsPhotos(row);
  });
}
