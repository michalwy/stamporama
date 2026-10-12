import "server-only";
import { assertCollectionOwner } from "./platform-category";
import { auctionLotWindows, platformSaleGroup } from "./action-items";
import { countAuctionLots, listAuctionLots, type AuctionLotListItem } from "./auctions";
import { auctionLotName, NOT_PURCHASED_LABEL } from "./auction-rules";
import { salesDashboardGroups } from "./dashboard-sales-rules";
import { listSalesAwaitingFulfilment } from "./sales";
import { countTrades, listTradesPaginated } from "./trades";
import { readTradeBalance } from "./trade-valuation";
import { describeTradeBalanceShort } from "./trade-balance";
import { TRADE_SHIPPING_STAGES } from "./trade-rules";
import { sortByStageAge, tradeShippingGroup, tradeShippingItem } from "./dashboard-trades-rules";
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
import {
  INCOMING_GROUPS,
  incomingGroup,
  incomingPurchaseItem,
  incomingSheetItem,
} from "./dashboard-incoming-rules";
import { countPurchases, listPurchasesPaginated, type PurchaseListFilters } from "./purchases";
import { listSheetsToCut } from "./scan-sheets";
import {
  offersNeedingActionForDashboard,
  offersWaiting,
  offersWithEndedAuction,
  type OfferNeedsActionReason,
  type WaitingOffer,
} from "./offers";
import { formatEntityNo } from "./quick-jump";

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

/**
 * A listing sold on Allegro with no sale recorded here yet (#499) — the bell's own group (#1809).
 * It comes first in Sales because it is the step before one: the sale has yet to be recorded.
 */
const platformSales: DashboardProvider = async ({ ownerId, collectionId }) => [
  dashboardGroupFromBell(await platformSaleGroup(ownerId, collectionId, DASHBOARD_ROW_LIMIT)),
];

/** Awaiting payment, to pack, to send (#1809) — the Sales list's status chips, one group each. */
const salesInFlight: DashboardProvider = async ({ ownerId, collectionId }) =>
  salesDashboardGroups(await listSalesAwaitingFulfilment(ownerId, collectionId));

/**
 * Incoming purchases (#1810): orders in transit and documents arrived with lots still open, read
 * through the Intake documents list's own reader — oldest in its state first — and the scans nothing
 * has been cut from yet, read by the scans card's own rule. Three groups, one provider each, so the
 * section is the order the parcel goes through: on its way, on the desk, on the scanner.
 */
async function purchaseGroup(
  ctx: DashboardContext,
  spec: { id: string; title: string; href: string },
  filters: PurchaseListFilters
): Promise<DashboardGroup[]> {
  const [page, count] = await Promise.all([
    listPurchasesPaginated(ctx.ownerId, ctx.collectionId, {
      ...filters,
      sortBy: "statusChangedAt",
      sortDir: "asc",
      pageSize: DASHBOARD_ROW_LIMIT,
    }),
    countPurchases(ctx.ownerId, ctx.collectionId, filters),
  ]);
  return [incomingGroup(spec, count, page.items.map(incomingPurchaseItem))];
}

const inTransitProvider: DashboardProvider = (ctx) =>
  purchaseGroup(ctx, INCOMING_GROUPS.inTransit, { status: "in_transit" });

const arrivedToSortProvider: DashboardProvider = (ctx) =>
  purchaseGroup(ctx, INCOMING_GROUPS.arrivedToSort, { inProgress: true, withOpenLots: true });

const scansToCutProvider: DashboardProvider = async ({ ownerId, collectionId }) => {
  const { total, sheets } = await listSheetsToCut(ownerId, collectionId, DASHBOARD_ROW_LIMIT);
  return [
    incomingGroup(
      INCOMING_GROUPS.scansToCut,
      total,
      sheets.map((sheet) => incomingSheetItem({ ...sheet, createdAt: sheet.createdAt.toISOString() }))
    ),
  ];
};

// ── Offers to handle (#1811) ────────────────────────────────────────────────

/**
 * An offer row: its number beside its title, its platform under it, aged from the instant its group
 * says (#1811) — and it opens the offer, which is where every one of these is dealt with.
 */
function offerRow(offer: WaitingOffer, detail: string = offer.platformName): DashboardItem {
  return {
    key: offer.offerId,
    label: `${formatEntityNo(offer.offerNo)} ${offer.label}`,
    detail,
    at: offer.since?.toISOString() ?? null,
    href: `offers/${offer.offerId}`,
  };
}

/** What a *Needs action* row says beside its platform: which of the bell's groups it is in. */
const NEEDS_ACTION_REASON: Record<OfferNeedsActionReason, string> = {
  "sold-elsewhere": "copy sold elsewhere",
  "prepared-sold-elsewhere": "not posted yet, copy sold elsewhere",
  "bidding-conflict": "conflicts with a live auction",
  "platform-sale-conflict": "conflicts with a sale on Allegro",
  "listing-changed": "changed since listed",
};

/** The waiting groups that are filters of the offers list and no bell group: read through that
 *  list's own `where` and linked to it, so the count is the rows *see all* opens. */
async function waitingGroup(
  { ownerId, collectionId }: DashboardContext,
  group: {
    id: string;
    title: string;
    filters: Parameters<typeof offersWaiting>[2];
    age: Parameters<typeof offersWaiting>[3];
    href: string;
  }
): Promise<DashboardGroup> {
  const waiting = await offersWaiting(
    ownerId,
    collectionId,
    group.filters,
    group.age,
    DASHBOARD_ROW_LIMIT
  );
  return {
    id: group.id,
    title: group.title,
    count: waiting.total,
    items: waiting.offers.map((o) => offerRow(o)),
    href: group.href,
  };
}

/**
 * The five groups, in the order the section shows them (#1811).
 *
 * - *Ready to publish* and *Pending approval* — the list's state filters, aged from the moment the
 *   offer entered the state (`stateChangedAt`).
 * - *Needs action* — the bell's three collisions and *Changed since listed*, as the one group the
 *   offers list has them as (#542), read from the bell's own derivations; the red collisions first.
 * - *Quick buys to refresh* — the list's *Needs refresh* (#1718), aged from the last posting.
 * - *Auctions ended, no result* — the bell's *Auction ended with a bid* (#490), read through the
 *   bell's own function, so the two hold the same offers.
 */
const offersToHandleProvider: DashboardProvider = async (ctx) => {
  const { ownerId, collectionId } = ctx;
  const [ready, pending, flagged, refresh, ended] = await Promise.all([
    waitingGroup(ctx, {
      id: "offers-ready",
      title: "Ready to publish",
      filters: { states: ["ready"] },
      age: "state",
      href: "offers?state=ready",
    }),
    waitingGroup(ctx, {
      id: "offers-pending",
      title: "Pending approval",
      filters: { states: ["pending"] },
      age: "state",
      href: "offers?state=pending",
    }),
    offersNeedingActionForDashboard(ownerId, collectionId, DASHBOARD_ROW_LIMIT),
    waitingGroup(ctx, {
      id: "offers-refresh",
      title: "Quick buys to refresh",
      filters: { needsRefresh: true },
      age: "posted",
      href: "offers?needsRefresh=1",
    }),
    offersWithEndedAuction(ownerId, collectionId, DASHBOARD_ROW_LIMIT),
  ]);
  return [
    ready,
    pending,
    {
      id: "offers-needs-action",
      title: "Needs action",
      count: flagged.total,
      items: flagged.offers.map((o) =>
        offerRow(o, `${o.platformName} · ${NEEDS_ACTION_REASON[o.reason]}`)
      ),
      href: "offers?needsAction=1",
    },
    refresh,
    {
      id: "offers-ended-auction",
      title: "Auctions ended, no result",
      count: ended.total,
      items: ended.offers.map((o) =>
        offerRow({ ...o, since: o.endsAt }, `${o.platformName} · ${o.price} ${o.currency}`)
      ),
      href: "offers?endedAuction=1",
    },
  ];
};

/**
 * **Trades** (#1813): agreed trades waiting on a parcel — *To send* and *Waiting for the partner*.
 *
 * Read through the trades list's own read and its `shipping` filter, so a group is exactly the set
 * its *N more →* opens. The whole set is read to order it by how long each has waited, which the
 * list cannot sort on — agreed trades waiting on the post are a handful, not a page. Each listed
 * row's balance is the trade screen's own `readTradeBalance`, so the figure is the one the trade
 * shows; past the row limit it is never read.
 */
const tradeShippingGroups: DashboardProvider = ({ ownerId, collectionId }) =>
  Promise.all(
    TRADE_SHIPPING_STAGES.map(async (stage) => {
      const count = await countTrades(ownerId, collectionId, { shipping: stage });
      const { items: trades } = count
        ? await listTradesPaginated(ownerId, collectionId, { shipping: stage, pageSize: count })
        : { items: [] };
      const listed = sortByStageAge(stage, trades).slice(0, DASHBOARD_ROW_LIMIT);
      const items = await Promise.all(
        listed.map(async (trade) => {
          const balance = await readTradeBalance(ownerId, trade.id);
          return tradeShippingItem(
            stage,
            trade,
            balance ? describeTradeBalanceShort(balance.trade, balance.tradeCurrency) : null
          );
        })
      );
      return tradeShippingGroup(stage, count, items);
    })
  );

const SECTION_PROVIDERS: Record<DashboardSectionId, DashboardProvider[]> = {
  sales: [platformSales, salesInFlight],
  "incoming-purchases": [inTransitProvider, arrivedToSortProvider, scansToCutProvider],
  offers: [offersToHandleProvider],
  auctions: [auctionWindowsProvider, wonNotPurchasedProvider],
  trades: [tradeShippingGroups],
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
