import "server-only";
import { countAuctionLots, listAuctionLots, type AuctionLotListItem } from "./auctions";
import { offersNeedingAction, offersWithObservedBidding } from "./offers";

/**
 * The **action items** the notification centre reports (#367) — the states already tracked
 * elsewhere in the app that are waiting on a decision, gathered into one list so they do not have
 * to be gone looking for on four screens.
 *
 * Nothing here is a new fact. Every group is an existing derivation read through the same functions
 * its own screen reads it through, which is what keeps the panel and the screen it links to from
 * ever disagreeing:
 *
 * - lots closing inside a day, and lots whose moment has passed with no outcome recorded, are the
 *   lot list's own `closing` windows (#351) against the server's clock;
 * - lots about to be bought twice are the lot list's `duplicate` chip (#369), which is the same
 *   collision rule the composition dialog warns with (`auction-duplicates.ts`);
 * - the two needs-action groups are the single derivation (ADR-0013 §4) split by *reason*
 *   (#167 / #215), because the two ask for different things: a sold copy has to come out of the
 *   listing, a copy under the hammer has to wait for the auction to end;
 * - the two bidding groups are what the Allegro sync did on its own (#481) — the notice that it
 *   flagged an auction, which lasts until it is read, and the flag left standing over a bid that has
 *   since been withdrawn, which lasts until the collector settles it.
 *
 * **Providers, not sources**, is the extension point: a provider returns one *or more* groups, so
 * two groups that come out of one read (the offers pair) stay one read. Adding a source is one
 * entry in {@link PROVIDERS} and nothing else — the route handler, the badge and the panel are all
 * written against the shape, never against the list.
 */

/** One thing waiting on the collector. */
export interface ActionItem {
  /** Unique within the panel — the entity's id, which is unique within its group and never repeats
   * across groups (a lot and an offer cannot share one). */
  key: string;
  label: string;
  /** Muted second line: whatever names the item's context — its seller, its platform, its size. */
  detail: string | null;
  /**
   * The instant this item is about (a closing time), ISO, or null where it is not about one.
   *
   * Formatted **client-side** (`auctions/auction-format.ts`): "in 3 hours" needs the browser's own
   * clock and locale, neither of which the server has, and a string rendered here would go stale
   * while the panel sat open.
   */
  at: string | null;
  /** Collection-relative, e.g. `offers/abc`. The client prefixes `/c/<slug>/` — the slug is a
   * routing concern and the domain layer only ever holds the collection's id. */
  href: string;
}

export type ActionItemGroupId =
  | "auction-closing"
  | "auction-outcome"
  | "auction-duplicate"
  | "offer-sold-elsewhere"
  | "offer-bidding-conflict"
  | "offer-bidding-started"
  | "offer-bid-withdrawn";

/**
 * How much is at stake, which is what decides both the tint and the reading order.
 *
 * Graded by **consequence, not by subject**: a lot closing tonight and a copy that has already sold
 * out from under a live listing are not the same kind of problem, and giving both the same alarm
 * makes the alarm mean nothing.
 *
 * - `critical` — a **double sale** is possible right now: the same piece of stock is committed in
 *   two places (#167's sold copy, #215's live bid). It costs money and a rating, and only the
 *   collector can undo it. Red.
 * - `warning` — a **deadline set by someone else** that can still be met: a lot closing within the
 *   day. Nothing is broken; something will be missed if it is left. Amber.
 * - `info` — **bookkeeping that never fixes itself**: an ended lot whose outcome was never
 *   recorded. Nothing is at risk, but nothing will remind you again either. Blue. Also where the
 *   app reports **something it did on its own** — an auction it marked in active bidding (#481):
 *   the conflict that flag creates is already reported as `critical` beside it, and saying the same
 *   thing twice in red would be the alarm meaning less. A flag left standing over a *withdrawn* bid
 *   is not this: it is stock held back for nothing, and grades `warning` like any other deadline
 *   that can still be met.
 *
 * This is the same rule the lot list already follows — colour means *act now*, and an ended lot is
 * muted rather than reddened — applied across sources.
 */
export type ActionItemSeverity = "critical" | "warning" | "info";

/** Most severe first. Also the panel's reading order: the thing that costs the most is at the top,
 * whatever it is about. */
export const SEVERITY_ORDER: readonly ActionItemSeverity[] = ["critical", "warning", "info"];

export interface ActionItemGroup {
  id: ActionItemGroupId;
  title: string;
  severity: ActionItemSeverity;
  /** Everything matching — {@link items} is the head of it, capped so a panel stays a panel. */
  count: number;
  items: ActionItem[];
  /** Collection-relative link to the screen filtered to *exactly* this group's set, so "see all"
   * lands on the same rows the panel was showing the top of. */
  href: string;
}

export interface ActionItemsResult {
  /**
   * What the badge shows: the groups' counts added up.
   *
   * Rows, not entities. An offer flagged for both reasons is listed twice because it carries two
   * problems needing two different answers, and a badge that disagreed with the number of rows
   * under it would be the harder thing to explain.
   */
  total: number;
  /** Non-empty groups only, **most severe first** (stable within a severity, so a provider's own
   * order still holds between two groups that weigh the same). */
  groups: ActionItemGroup[];
  /** The worst thing waiting, or null when nothing is — what the badge is tinted by. Derived here
   * rather than in the client so the bell and the panel cannot grade the same list differently. */
  severity: ActionItemSeverity | null;
}

/** How many rows a group shows before it defers to its "see all" link. */
const DEFAULT_LIMIT = 5;

interface ProviderContext {
  ownerId: string;
  collectionId: string;
  limit: number;
}

interface ActionItemProvider {
  /** Groups this provider can emit, in the order it emits them. Empty ones are dropped by
   * {@link getActionItems}, so a provider always returns its full set. */
  load(ctx: ProviderContext): Promise<ActionItemGroup[]>;
}

/** What a lot is called when the collector never titled it — the same fallback chain the lot list
 * makes, derived name included (#353). */
function lotLabel(lot: AuctionLotListItem): string {
  return lot.title ?? lot.derivedTitle ?? (lot.lotNo ? `Lot ${lot.lotNo}` : lot.saleName);
}

/** A lot row: named, attributed to its seller, and pointing at the parcel it settles in with the
 * lot itself marked (#374) — which is where a bid is refreshed and an outcome recorded. */
function lotItem(lot: AuctionLotListItem): ActionItem {
  return {
    key: lot.id,
    label: lotLabel(lot),
    detail: lot.sellerName,
    at: lot.endsAt.toISOString(),
    href: `auctions/sales/${lot.saleId}?lot=${lot.id}`,
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Lots that hold a stamp another lot **being won** also holds (#369).
 *
 * The dialog's warning only speaks while a composition is being edited, which is the one moment a
 * duplicate is *created*; this is the standing version of the same question, for the duplicate that
 * came about some other way — the second lot entered last week, a bid that pulled ahead overnight.
 *
 * `warning` rather than `critical`: money is at stake, but nothing has gone wrong yet and the bid
 * can still be pulled. Same reading as a lot closing tonight — a deadline that can still be met.
 */
const duplicateProvider: ActionItemProvider = {
  async load({ ownerId, collectionId, limit }) {
    const filters = { duplicate: true as const };
    const [page, count] = await Promise.all([
      listAuctionLots(ownerId, collectionId, { ...filters, pageSize: limit }),
      countAuctionLots(ownerId, collectionId, filters),
    ]);
    return [
      {
        id: "auction-duplicate" as const,
        title: "Winning the same stamp twice",
        severity: "warning" as const,
        count,
        items: page.items.map(lotItem),
        // The lot list's own chip, so "see all" is the same set counted here rather than an
        // approximation of it.
        href: "auctions?duplicate=1",
      },
    ];
  },
};

const auctionProvider: ActionItemProvider = {
  async load({ ownerId, collectionId, limit }) {
    // Two windows over the lots still in play, each one already a filter the lots screen offers, so
    // the "see all" links are the same query rather than an approximation of it.
    const windows = [
      {
        id: "auction-closing" as const,
        title: "Closing soon",
        // A deadline, not a loss: the bid can still be placed.
        severity: "warning" as const,
        closing: "today" as const,
      },
      {
        id: "auction-outcome" as const,
        title: "Waiting to be closed",
        // The bidding happened without you — nothing is at risk, but nothing will ask again.
        severity: "info" as const,
        closing: "ended" as const,
      },
    ];

    return Promise.all(
      windows.map(async ({ id, title, severity, closing }) => {
        const filters = { outcome: "pending" as const, closing };
        const [page, count] = await Promise.all([
          listAuctionLots(ownerId, collectionId, { ...filters, pageSize: limit }),
          countAuctionLots(ownerId, collectionId, filters),
        ]);
        return {
          id,
          title,
          severity,
          count,
          items: page.items.map(lotItem),
          href: `auctions?outcome=pending&closing=${closing}`,
        };
      })
    );
  },
};

const offerProvider: ActionItemProvider = {
  async load({ ownerId, collectionId, limit }) {
    // One read for both groups: they are one derivation counted two ways, and the derived labels
    // they need would otherwise each pay for the collection's area tree (#379).
    const flagged = await offersNeedingAction(ownerId, collectionId, limit);

    // Both land on the needs-action filter: it is one flag on the offers list (the split is this
    // panel's, so it can say which of the two things happened), and a link to a filter the screen
    // does not have would be a link to the wrong rows.
    const href = "offers?needsAction=1";

    // Both are `critical`: each one is a piece of stock committed in two places at once, which is a
    // double sale waiting to happen. One has already lost the copy, the other is about to.
    const groups = [
      { id: "offer-sold-elsewhere", title: "Listing a copy sold elsewhere", reason: "sold-elsewhere" },
      { id: "offer-bidding-conflict", title: "Conflicting with a live auction", reason: "bidding-conflict" },
    ] as const;

    return groups.map(({ id, title, reason }) => ({
      id,
      title,
      severity: "critical" as const,
      count: flagged[reason].total,
      items: flagged[reason].offers.map((o) => ({
        key: o.offerId,
        label: o.label,
        detail: `${o.platformName} · ${plural(o.count, "copy", "copies")}`,
        at: null,
        href: `offers/${o.offerId}`,
      })),
      href,
    }));
  },
};

/**
 * The two things worth saying about an auction the **sync itself** marked in active bidding (#481).
 *
 * Automating that flag was only ever acceptable while the collector can see the app did it — the
 * flag pulls copies out of every other listing (ADR-0013 §4), and a cascade discovered through a
 * filter behaving oddly is the failure mode the whole thing is against.
 *
 * But visibility is an **event**, not a standing state. A hundred auctions being bid on is a hundred
 * things already known and nothing waiting on a decision; listing them until they closed would make
 * the badge a number nobody reads. So:
 *
 * - **Bidding started** is the notice, and it lasts until it has been read — opening the offer is
 *   the acknowledgement (`Offer.biddingNoticeAt`). `info`, because nothing is wrong: somebody
 *   bidding on your auction is the listing working. What *is* critical, the same copies sitting in
 *   another live listing, is already `offer-bidding-conflict`, computed off this very flag.
 * - **Bid withdrawn** never expires, because it is the one case where the flag is genuinely waiting
 *   on somebody: stock is being held out of every other listing for a bid that no longer exists, and
 *   only the collector can clear that (#215 — nothing here ever clears it in the background).
 *   `warning`: money is at stake and the situation can still be put right, which is exactly how a
 *   lot closing tonight is graded.
 */
const biddingProviders: ActionItemProvider = {
  async load({ ownerId, collectionId, limit }) {
    const [started, withdrawn] = await Promise.all([
      offersWithObservedBidding(ownerId, collectionId, "notice", limit),
      offersWithObservedBidding(ownerId, collectionId, "withdrawn", limit),
    ]);

    return [
      {
        id: "offer-bidding-started" as const,
        title: "Bidding started on Allegro",
        severity: "info" as const,
        count: started.total,
        items: started.offers.map((offer) => ({
          key: offer.offerId,
          label: offer.label,
          detail: `${offer.platformName} · ${plural(offer.bidderCount, "bidder", "bidders")} · ${offer.price} ${offer.currency}`,
          // When the app flagged it, formatted client-side like every other date here.
          at: offer.checkedAt?.toISOString() ?? null,
          href: `offers/${offer.offerId}`,
        })),
        // The offers list' own in-bidding filter. Wider than the group — it holds every offer under
        // the hammer, read or unread — which is the honest place for "and what else is running".
        href: "offers?bidding=1",
      },
      {
        id: "offer-bid-withdrawn" as const,
        title: "Bid withdrawn, still marked in bidding",
        severity: "warning" as const,
        count: withdrawn.total,
        items: withdrawn.offers.map((offer) => ({
          key: offer.offerId,
          label: offer.label,
          detail: `${offer.platformName} · no bidders · marked in bidding`,
          at: offer.checkedAt?.toISOString() ?? null,
          href: `offers/${offer.offerId}`,
        })),
        href: "offers?bidding=1",
      },
    ];
  },
};

/** Provider order is only the tie-break — {@link SEVERITY_ORDER} decides what the panel leads with,
 * so a source's place in this list never quietly outranks a worse problem from another one. */
const PROVIDERS: ActionItemProvider[] = [
  auctionProvider,
  duplicateProvider,
  offerProvider,
  biddingProviders,
];

/**
 * Everything waiting on the collector in one collection.
 *
 * Providers run concurrently and each one authorizes its own read — every function they call takes
 * the owner and asserts it, so there is no unchecked path in here.
 */
export async function getActionItems(
  ownerId: string,
  collectionId: string,
  limit: number = DEFAULT_LIMIT
): Promise<ActionItemsResult> {
  const groups = (
    await Promise.all(PROVIDERS.map((p) => p.load({ ownerId, collectionId, limit })))
  )
    .flat()
    .filter((g) => g.count > 0)
    // Stable, so provider order still separates two groups of equal weight.
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  return {
    total: groups.reduce((sum, g) => sum + g.count, 0),
    groups,
    // Sorted, so the first group *is* the worst thing waiting.
    severity: groups[0]?.severity ?? null,
  };
}
