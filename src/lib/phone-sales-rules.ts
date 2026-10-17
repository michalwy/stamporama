import {
  SALES_DASHBOARD_GROUPS,
  salesInStatus,
  type SaleAwaitingFulfilment,
} from "./dashboard-sales-rules";
import type { SaleStatus } from "./sale-status";

/**
 * The phone's **sales to do** (#2007, ADR-0072 §5): the sales that move during the day — awaiting
 * payment, to pack, to send — each moved one step on from the phone.
 *
 * Pure, so the grouping and the step are unit-tested without Prisma. The set is the Dashboard's
 * Sales section's own (`listSalesAwaitingFulfilment`, #1809) and so are the groups, their order and
 * the order inside them: the phone and the desk never disagree about what is waiting.
 *
 * - **A sale moves one step forward**: *Awaiting payment* to *Paid*, *To pack* to *Packed*, *To send*
 *   to *Sent*. Anything else — another status, a step back, every other field — stays at the desk.
 * - **The move is the desk's**: the same server actions, and the same questions on the way that the
 *   desk's sale screen asks (`asksAboutUnpackedCopies`, `asksForShipment` in `sale-status.ts`), so
 *   the sale's status history reads as if it had been moved at the desk. *Paid* asks nothing — the
 *   desk's total-paid prompt (#443) is skippable, and on the phone it is skipped: the amounts stay
 *   at the desk (#2000).
 */

/** A sale on the phone's list: the Dashboard's row, plus what its next step may ask about. */
export interface SaleToDo extends SaleAwaitingFulfilment {
  /** The parcel's tracking number, or null — *Sent* asks for one only while there is none. */
  trackingCode: string | null;
  /** The carrier in force: the sale's own, else the carrier of the service it is sent as. */
  carrierId: string | null;
  /** What the parcel is going by, as the shipment step names it (`shipmentGoingBy`). */
  goingBy: string | null;
  /** How many of the sale's copies are not marked packed (#973). */
  unpackedItemCount: number;
}

/** The step the phone offers a sale in each waiting status, and the button that takes it. */
export const PHONE_SALE_STEPS: Readonly<Record<string, { next: SaleStatus; label: string }>> = {
  ordered: { next: "paid", label: "Mark paid" },
  paid: { next: "packed", label: "Mark packed" },
  packed: { next: "sent", label: "Mark sent" },
};

/** The step the phone offers a sale, or null when the sale is in no waiting status. */
export function phoneSaleStep(status: string): { next: SaleStatus; label: string } | null {
  return PHONE_SALE_STEPS[status] ?? null;
}

export interface PhoneSaleGroup<T> {
  status: SaleStatus;
  title: string;
  sales: T[];
}

/** The sales in the Dashboard's groups and order, every group kept even when empty. */
export function phoneSaleGroups<T extends SaleAwaitingFulfilment>(
  sales: readonly T[]
): PhoneSaleGroup<T>[] {
  return SALES_DASHBOARD_GROUPS.map(({ status, title }) => ({
    status,
    title,
    sales: salesInStatus(sales, status),
  }));
}
