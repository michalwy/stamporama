import "server-only";
import { assertCollectionOwner } from "./platform-category";
import { auctionLotWindows } from "./action-items";
import { countAuctionLots, listAuctionLots, type AuctionLotListItem } from "./auctions";
import { auctionLotName, NOT_PURCHASED_LABEL } from "./auction-rules";
import {
  auctionLotRowDetail,
  capGroup,
  dashboardGroupFromBell,
  dashboardSectionSpec,
  DASHBOARD_ROW_LIMIT,
  type DashboardGroup,
  type DashboardItem,
  type DashboardSection,
  type DashboardSectionId,
} from "./dashboard-rules";

/**
 * The operational Dashboard's reads (#1808; ADR-0067). The shape and its rules are in the pure
 * `dashboard-rules.ts`; this file only says which reads fill which section.
 *
 * **Providers, per section**, the bell's extension point (`action-items.ts`) applied here: a provider
 * returns one or more groups, so two groups out of one read stay one read, and filling a section is
 * entries in {@link SECTION_PROVIDERS} and nothing else — the route, the query and the screen are
 * written against the shape. The sections' contents are their own issues (#1809 Sales, #1810
 * Incoming purchases, #1811 Offers to handle, #1812 Auctions I bid in, #1813 Trades); until each
 * lands, its section has no groups and says so.
 *
 * **A provider reads through the function the group's own screen reads through**, and where a group
 * means what a bell group means it reads the bell's source and hands it over with
 * `dashboardGroupFromBell` — a second derivation of the same set is the drift #397 was worried
 * about. A provider returns a group **even when it is empty**: the screen shows the zero.
 */

interface DashboardContext {
  ownerId: string;
  collectionId: string;
}

type DashboardProvider = (ctx: DashboardContext) => Promise<DashboardGroup[]>;

/**
 * A lot as a row of the *Auctions I bid in* section (#1812): the lot, its sale and its seller, the
 * instant it closes or closed — formatted client-side as time left or time since — and the lot in
 * its sale as the place it is dealt with, which is where a bid is refreshed, an outcome recorded and
 * a win settled into its purchase. Named as the bell names a lot (`action-items.ts`), its title or
 * its derived name and else its sale's.
 */
function auctionLotRow(lot: AuctionLotListItem): DashboardItem {
  const label = auctionLotName(lot) ?? lot.saleName;
  return {
    key: lot.id,
    label,
    detail: auctionLotRowDetail({ label, saleName: lot.saleName, sellerName: lot.sellerName }),
    at: lot.endsAt.toISOString(),
    href: `auctions/sales/${lot.saleId}?lot=${lot.id}`,
  };
}

/**
 * *Closing soon* and *Waiting to be closed* — the bell's two groups of those names, read through the
 * bell's own derivation (ADR-0067 §3), so the sets and counts cannot differ; only the rows are drawn
 * with the sale beside the seller.
 */
const auctionWindowsProvider: DashboardProvider = async ({ ownerId, collectionId }) =>
  (await auctionLotWindows(ownerId, collectionId, DASHBOARD_ROW_LIMIT)).map(({ lots, ...group }) =>
    dashboardGroupFromBell({ ...group, items: lots.map(auctionLotRow) })
  );

/**
 * Lots the collector **won and has not yet bought** (#1812): closed with them winning, and neither
 * transcribed into a purchase nor settled as an expense — still to be paid for, and their stamps
 * nowhere in the collection yet. Read through the lots list's own *Won, not yet purchased* filter, so
 * *N more →* lands on exactly this set, oldest first.
 */
const wonNotPurchasedProvider: DashboardProvider = async ({ ownerId, collectionId }) => {
  const filters = { outcome: "won" as const, notPurchased: true };
  const [page, count] = await Promise.all([
    listAuctionLots(ownerId, collectionId, { ...filters, pageSize: DASHBOARD_ROW_LIMIT }),
    countAuctionLots(ownerId, collectionId, filters),
  ]);
  return [
    {
      id: "auction-won-not-purchased",
      title: NOT_PURCHASED_LABEL,
      count,
      items: page.items.map(auctionLotRow),
      href: "auctions?outcome=won&notPurchased=1",
    },
  ];
};

const SECTION_PROVIDERS: Record<DashboardSectionId, DashboardProvider[]> = {
  sales: [],
  "incoming-purchases": [],
  offers: [],
  auctions: [auctionWindowsProvider, wonNotPurchasedProvider],
  trades: [],
};

/**
 * One section of the dashboard. Its own call — and its own route and query — so each section loads
 * and fails on its own, the Overview's pattern (#649).
 *
 * The collection is asserted here as well as by every provider's own reads, so a section with no
 * providers yet still refuses a collection that is not the caller's.
 */
export async function getDashboardSection(
  ownerId: string,
  collectionId: string,
  sectionId: DashboardSectionId
): Promise<DashboardSection> {
  await assertCollectionOwner(ownerId, collectionId);
  const groups = (
    await Promise.all(SECTION_PROVIDERS[sectionId].map((load) => load({ ownerId, collectionId })))
  )
    .flat()
    .map((group) => capGroup(group));
  return { ...dashboardSectionSpec(sectionId), groups };
}
