// Pure fulfillment-status constants for a sale (#191), safe to import from both server and client
// code (no `server-only`, no Prisma). The server domain module (`sales.ts`) and the client UI both
// build on these so the token set + order stay in one place.

/** A sale's fulfillment status in lifecycle order: ordered → paid → packed → sent → received. */
export type SaleStatus = "ordered" | "paid" | "packed" | "sent" | "received";

/** The fixed lifecycle order, for the inline status select + one-click advance (#191). */
export const SALE_STATUS_ORDER: SaleStatus[] = [
  "ordered",
  "paid",
  "packed",
  "sent",
  "received",
];

const VALID_SALE_STATUS = new Set<SaleStatus>(SALE_STATUS_ORDER);

export function isSaleStatus(value: string): value is SaleStatus {
  return VALID_SALE_STATUS.has(value as SaleStatus);
}

/** A sale not yet sent: everything before *Sent* — the sales still open to more sold sets (#1950).
 * Read by the contact page's *Not yet sent* figure and by the *Sell* dialog's list of sales. */
export const UNSENT_SALE_STATUSES: readonly SaleStatus[] = ["ordered", "paid", "packed"];

/** Whether the sale's parcel has gone — *Sent* or *Delivered*. An unknown token is not sent. */
export function isSaleSent(status: string): boolean {
  return isSaleStatus(status) && !UNSENT_SALE_STATUSES.includes(status);
}

/**
 * Whether moving a sale from `from` to `to` first asks what to do about the copies not marked
 * packed (#973): a move **forward** to *Packed* or past it while any copy is unmarked. Decided by the
 * collector on 2026-09-08 against asking only on *Packed* — a jump to *Sent* is the same situation
 * and the worse one. Putting a sale back is a correction and asks nothing; a sale with no unmarked
 * copy asks nothing either. The desk's sale screen and the phone's sales to do (#2007) both ask
 * through this.
 */
export function asksAboutUnpackedCopies(
  from: string,
  to: SaleStatus,
  unpackedItemCount: number
): boolean {
  const fromIdx = SALE_STATUS_ORDER.indexOf(from as SaleStatus);
  const toIdx = SALE_STATUS_ORDER.indexOf(to);
  return unpackedItemCount > 0 && toIdx >= SALE_STATUS_ORDER.indexOf("packed") && toIdx > fromIdx;
}

/**
 * Whether moving a sale to `to` asks for the parcel's carrier and tracking number (#491): on the
 * way to *Sent*, the moment the number is in hand, and only while the sale carries none — one
 * already recorded has answered, and asking again would invite overwriting it. Skipping is a
 * first-class answer. Shared by the desk's sale screen and the phone (#2007).
 */
export function asksForShipment(to: string, trackingCode: string | null): boolean {
  return to === "sent" && trackingCode == null;
}
