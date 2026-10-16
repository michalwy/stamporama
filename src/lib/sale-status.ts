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
