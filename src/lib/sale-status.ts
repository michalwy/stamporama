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
