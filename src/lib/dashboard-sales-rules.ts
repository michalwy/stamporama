import type { DashboardGroup, DashboardItem } from "./dashboard-rules";
import { formatEntityNo } from "./quick-jump";
import type { SaleStatus } from "./sale-status";

/**
 * The Dashboard's **Sales** section (#1809): the sales the collector still has to move along.
 *
 * Pure, so the grouping and the rows are unit-tested without Prisma; the read is
 * `listSalesAwaitingFulfilment` in `sales.ts`, through the same filter the Sales list's status chips
 * apply, so a group and the list it links to are one set.
 *
 * - **A group is a fulfilment status** (#191), confirmed with the collector on 2026-10-11:
 *   *Awaiting payment* is `ordered`, *To pack* is `paid`, *To send* is `packed`. A sent or received
 *   sale is done as far as the collector is concerned and is not here.
 * - **A row is a sale, oldest in its status first**, aged by how long it has been in that status —
 *   the moment it entered it, read off the status timeline — and it opens the sale.
 * - The row's amount is **what the buyer pays**, in the sale's own currency (the collector,
 *   2026-10-11): on an unpaid sale that is the money being waited for.
 */

export interface SaleAwaitingFulfilment {
  id: string;
  saleNo: number;
  status: SaleStatus;
  buyerName: string | null;
  platformName: string;
  /** What the buyer pays, 2 dp, in {@link currency}. */
  buyerTotal: string;
  currency: string;
  /** When the sale entered its current status. */
  since: Date;
}

/** The section's status groups, in lifecycle order. */
export const SALES_DASHBOARD_GROUPS: readonly { status: SaleStatus; id: string; title: string }[] = [
  { status: "ordered", id: "sales-awaiting-payment", title: "Awaiting payment" },
  { status: "paid", id: "sales-to-pack", title: "To pack" },
  { status: "packed", id: "sales-to-send", title: "To send" },
];

/** The statuses a sale is still waiting on the collector in. */
export const SALES_WAITING_STATUSES: readonly SaleStatus[] = SALES_DASHBOARD_GROUPS.map(
  (g) => g.status
);

export function saleDashboardItem(sale: SaleAwaitingFulfilment): DashboardItem {
  const no = formatEntityNo(sale.saleNo);
  return {
    key: sale.id,
    label: sale.buyerName ? `${no} · ${sale.buyerName}` : no,
    detail: `${sale.platformName} · ${sale.buyerTotal} ${sale.currency}`,
    at: sale.since.toISOString(),
    href: `sales/${sale.id}`,
  };
}

/**
 * The sales split into their status groups, each oldest-in-status first (the lower sale number
 * breaking a tie), every group returned even when empty — the screen shows the zero.
 */
export function salesDashboardGroups(sales: readonly SaleAwaitingFulfilment[]): DashboardGroup[] {
  return SALES_DASHBOARD_GROUPS.map(({ status, id, title }) => {
    const inStatus = sales
      .filter((s) => s.status === status)
      .sort((a, b) => a.since.getTime() - b.since.getTime() || a.saleNo - b.saleNo);
    return {
      id,
      title,
      count: inStatus.length,
      items: inStatus.map(saleDashboardItem),
      // The Sales list's own status chip, so the group's link lands on exactly this set.
      href: `sales?status=${status}`,
    };
  });
}
