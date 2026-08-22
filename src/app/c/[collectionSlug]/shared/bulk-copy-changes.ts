/**
 * The bulk change a set of copies is written with, client-side (#121/#565/#682).
 *
 * The mirror of the domain's `LotBulkChanges` and the shape `bulkUpdateLotItemsAction` reads back
 * off a form. It lives here rather than in either screen because **two** screens now send one:
 * purchase intake, where filing a batch is part of sorting it, and the Copies list, where the same
 * write re-organises storage long after the purchase is closed. One serializer, so a field cannot
 * be spelled one way on one screen and another way on the other.
 *
 * Every field is optional and **absent means "leave it alone"** — that is what lets a dialog offer
 * a change per axis without forcing an answer on the others.
 */
export interface BulkCopyChanges {
  /** Present (even `null`) files the copies; `null` clears the location **and** the ref with it. */
  locationId?: string | null;
  /** The ref card's identifier, written with the location in one act (#565). Blank clears it. Only
   * meaningful alongside a `locationId` — the domain refuses one without. */
  locationRef?: string | null;
  deliveryState?: string;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  markSorted?: boolean;
  /** Mark-sorted only (#274): leave each copy's disposition untouched instead of writing one. */
  keepDisposition?: boolean;
}

/** Serialize {@link BulkCopyChanges} onto a form, for both the id-list and scoped bulk actions.
 * A field is set only where the caller has an opinion, since the action reads presence as intent. */
export function appendBulkChanges(fd: FormData, changes: BulkCopyChanges): void {
  if (changes.locationId !== undefined) fd.set("locationId", changes.locationId ?? "");
  if (changes.locationRef !== undefined) fd.set("locationRef", changes.locationRef ?? "");
  if (changes.deliveryState) fd.set("deliveryState", changes.deliveryState);
  if (changes.inCollection !== undefined) fd.set("inCollection", String(changes.inCollection));
  if (changes.forSale !== undefined) fd.set("forSale", String(changes.forSale));
  if (changes.forTrade !== undefined) fd.set("forTrade", String(changes.forTrade));
  if (changes.markSorted) fd.set("markSorted", "true");
  if (changes.keepDisposition) fd.set("keepDisposition", "true");
}
