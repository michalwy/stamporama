import type { DashboardGroup, DashboardItem } from "./dashboard-rules";
import { intakeDocumentName, isOpeningBalance } from "./purchase-kind";

/**
 * The dashboard's **Incoming purchases** section (#1810), its pure half: what the three groups are
 * and how a row of each reads. `dashboard.ts` does the reads, through the functions the Intake
 * documents list and the purchase's scans card read through.
 *
 * - **In transit** — purchase orders on their way.
 * - **Arrived, to sort** — documents in hand with a lot still open: an arrived purchase, and an
 *   opening balance in progress, which has no delivery status and is listed here only while its
 *   lots are open.
 * - **Scans to cut** — uploaded card scans nothing has been cut from yet: the cards offering
 *   *Review the cut*. Not the bell's: #1675 took them out of the notification centre, so this group
 *   reads the cards' own rule.
 *
 * A purchase row is its supplier (an opening balance's title), then its number, date and value, and
 * its age is how long it has been in its state (`Purchase.statusChangedAt`), oldest first. A scan row
 * is its batch, then the document it belongs to, and its age is how long it has waited.
 */

export const INCOMING_GROUPS = {
  inTransit: { id: "incoming-in-transit", title: "In transit", href: "purchases?status=in_transit" },
  /**
   * The *Arrived* filter is the nearest the list has to this set — chosen by the collector on
   * 2026-10-11 over a new *open lots* filter: it also holds arrived orders whose lots are all
   * closed, and leaves out opening balances, which have no delivery status to filter on.
   */
  arrivedToSort: { id: "incoming-arrived-to-sort", title: "Arrived, to sort", href: "purchases?status=arrived" },
  /** Scans live on each document's own screen; the list of documents is where they are reached. */
  scansToCut: { id: "incoming-scans-to-cut", title: "Scans to cut", href: "purchases" },
} as const;

/** The fields of a `PurchaseListItem` a purchase row reads. */
export interface IncomingPurchaseRow {
  id: string;
  kind: string;
  title: string | null;
  purchaseNo: number;
  contactName: string | null;
  platformName: string | null;
  purchasedAt: string;
  currency: string;
  total: string | null;
  statusChangedAt: string;
}

/** How a document is numbered on a line that names it — the notification centre's wording. */
export function intakeDocumentNo(p: { kind: string; purchaseNo: number }): string {
  return isOpeningBalance(p) ? `Opening balance #${p.purchaseNo}` : `Order #${p.purchaseNo}`;
}

/** The document's name, with the Intake documents list's own fallbacks. */
function documentLabel(p: Pick<IncomingPurchaseRow, "kind" | "title" | "contactName" | "platformName">): string {
  return intakeDocumentName(p) ?? (isOpeningBalance(p) ? "Untitled" : "No supplier");
}

export function incomingPurchaseItem(p: IncomingPurchaseRow): DashboardItem {
  // No value at all is said in words, never `0.00` (#1184) — only ever the case on an opening balance.
  const value = p.total == null ? "No opening value" : `${p.total} ${p.currency}`;
  return {
    key: p.id,
    label: documentLabel(p),
    detail: [intakeDocumentNo(p), p.purchasedAt, value].join(" · "),
    at: p.statusChangedAt,
    href: `purchases/${p.id}`,
  };
}

/** The fields of a sheet waiting to be cut that its row reads. */
export interface IncomingSheetRow {
  id: string;
  batchNo: number;
  side: "front" | "back";
  label: string | null;
  createdAt: string;
  purchase: {
    id: string;
    kind: string;
    purchaseNo: number;
    title: string | null;
    contactName: string | null;
    platformName: string | null;
  };
}

export function incomingSheetItem(s: IncomingSheetRow): DashboardItem {
  // `Batch 3 · Klaser Polska 1`, the scans card's own heading — the batch is the subject here.
  const batch = s.label ? `Batch ${s.batchNo} · ${s.label}` : `Batch ${s.batchNo}`;
  return {
    key: s.id,
    label: s.side === "back" ? `${batch} — back` : batch,
    detail: `${intakeDocumentNo(s.purchase)} · ${documentLabel(s.purchase)}`,
    at: s.createdAt,
    href: `purchases/${s.purchase.id}`,
  };
}

/** One group out of a count and its head, in the order the read returned them. */
export function incomingGroup(
  spec: { id: string; title: string; href: string },
  count: number,
  items: DashboardItem[]
): DashboardGroup {
  return { id: spec.id, title: spec.title, href: spec.href, count, items };
}
