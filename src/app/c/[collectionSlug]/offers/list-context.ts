import { isOfferState, type OfferState } from "@/lib/offer-rules";

/**
 * The filter context an offer was opened from (#429), carried in the detail URL so the screen can
 * offer next/previous through the same list — and hand the same context on to whichever offer it
 * moves to.
 *
 * It travels in the URL rather than off the remembered filters (#325) for two reasons: an offer is
 * opened from other screens too (the "View offers" popup, a search, a bookmark), where a walk
 * through a list nobody is looking at would be an invention; and a link to "the third preparing
 * offer on Colnect" then still means that when it is pasted or reopened.
 *
 * `from=list` is the marker: a context with no filters at all — the whole list — is a legitimate
 * walk, and without it would be indistinguishable from a plain deep link.
 */
export interface OfferListContext {
  platformId?: string;
  /** The state chips that were on, OR-matched — a multi-select since #475. */
  states?: OfferState[];
  /** The derived "needs action" overlay (ADR-0013 §4); mutually exclusive with `states`. */
  needsAction?: boolean;
  /** Only offers in active bidding (#215/#481) — a plain narrowing, so it stands beside the state
   * chips rather than replacing them. */
  bidding?: boolean;
  /** Only auctions that ended with a bid and are waiting to be resolved (#490) — like `bidding`, a
   * plain narrowing that stands beside the state chips. */
  endedAuction?: boolean;
  /** Only listings sold on a connected platform with no sale recorded here (#499) — a plain
   * narrowing, like the two above. */
  platformSale?: boolean;
  /** The list's remembered show-closed toggle (#245) — not a list URL param, but part of what the
   * list was showing, so the walk has to carry it. */
  includeClosed?: boolean;
  /** What was in the search box (#465): the list an offer was found through is the list the walk
   * steps along, and a search narrows it exactly as a filter does. */
  search?: string;
}

const MARKER = "from";
const MARKER_VALUE = "list";

/** The query string (leading `?`, or empty) that carries `context` on a detail link. */
export function offerListContextQuery(context: OfferListContext): string {
  const params = new URLSearchParams({ [MARKER]: MARKER_VALUE });
  if (context.platformId) params.set("platform", context.platformId);
  if (context.bidding) params.set("bidding", "1");
  if (context.endedAuction) params.set("endedAuction", "1");
  if (context.platformSale) params.set("platformSale", "1");
  if (context.needsAction) params.set("needsAction", "1");
  else if (context.states?.length) params.set("state", context.states.join(","));
  if (context.includeClosed) params.set("closed", "1");
  if (context.search) params.set("search", context.search);
  return `?${params.toString()}`;
}

/** The context a detail URL carries, or null when it carries none — nothing to walk through. */
export function parseOfferListContext(
  params: URLSearchParams | Record<string, string | string[] | undefined>
): OfferListContext | null {
  const get = (key: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  if (get(MARKER) !== MARKER_VALUE) return null;
  const needsAction = get("needsAction") === "1";
  return {
    platformId: get("platform") || undefined,
    states: needsAction ? [] : (get("state") || "").split(",").filter(isOfferState),
    needsAction,
    bidding: get("bidding") === "1",
    endedAuction: get("endedAuction") === "1",
    platformSale: get("platformSale") === "1",
    includeClosed: get("closed") === "1",
    search: get("search") || undefined,
  };
}

/** The offer list as `context` had it — the detail screen's own way back (#429). The show-closed
 * toggle is deliberately dropped: it is remembered per collection (#245) and the list reads its own
 * value, so re-stating it here could only ever disagree with it. */
export function offerListHref(collectionSlug: string, context: OfferListContext | null): string {
  const base = `/c/${collectionSlug}/offers`;
  if (!context) return base;
  const params = new URLSearchParams();
  if (context.platformId) params.set("platform", context.platformId);
  if (context.bidding) params.set("bidding", "1");
  if (context.endedAuction) params.set("endedAuction", "1");
  if (context.platformSale) params.set("platformSale", "1");
  if (context.needsAction) params.set("needsAction", "1");
  else if (context.states?.length) params.set("state", context.states.join(","));
  if (context.search) params.set("search", context.search);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
