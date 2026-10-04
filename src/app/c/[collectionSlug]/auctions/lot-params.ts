import type { AuctionClosingWindow } from "@/lib/auctions";
import type { LotSignal } from "@/lib/auction-lot";
import type { AuctionLotOutcome } from "@/lib/auction-rules";
import { DEFAULT_TAG_FILTER_MODE, type TagFilterMode } from "@/lib/tag-filter";

/**
 * What the lot list is narrowed to, as the client holds it (#351/#352). A mirror of the server-side
 * `AuctionLotFilters` in `src/lib/auctions.ts`, minus the paging fields and minus `saleId` — a
 * sale's own lots come from `useAuctionSaleDetail`, not from a narrowed flat list.
 */
export interface AuctionLotFilters {
  /** How the bidding went — the toolbar's chips (`won`, `lost`, `watched`…). */
  outcome?: AuctionLotOutcome;
  /** Show lots that are done — won, lost, observed, cancelled (#504). Off by default. */
  includeClosed?: boolean;
  /** Closing-time window: already ended, or closing inside a day / a week. */
  closing?: AuctionClosingWindow;
  /** A derived state: still biddable, outbid, over ceiling… */
  signal?: LotSignal;
  /** Only lots with nothing described yet (#442). */
  undescribed?: boolean;
  /** Only lots whose condition is still to settle (#1623). */
  conditionToSettle?: boolean;
  /** Only lots holding a stamp another lot being won also holds (#369). */
  duplicate?: boolean;
  /** Only lots carrying the *to review* marker — written through the agent API, not confirmed (#1626). */
  toReview?: boolean;
  /** Free-text search over the lot, its notes and the sale it belongs to (#484). */
  search?: string;
  sellerId?: string;
  platformId?: string;
  /** The collector's own labels (#1625) — `tag-filter.ts`' two fields, under its own param names. */
  tagIds?: string[];
  /** Meaningless without {@link tagIds}, and only sent with them. */
  tagMode?: TagFilterMode;
}

/**
 * One entry per filter, keyed by the search param it travels as — which is also its field name, so
 * the route reads back exactly what the panel set.
 *
 * The map is the point: it is typed over **every** key of `AuctionLotFilters`, so a filter added to
 * the interface fails to compile until it is serialised here. A hand-written chain of `if`s is how
 * `outcome` came to be dropped on the way to the request (#450) — the panel set it, the interface
 * never carried it, and nothing complained.
 */
const LOT_PARAM: {
  [K in keyof Required<AuctionLotFilters>]-?: (value: NonNullable<AuctionLotFilters[K]>) => string;
} = {
  outcome: (value) => value,
  includeClosed: () => "1",
  closing: (value) => value,
  signal: (value) => value,
  undescribed: () => "1",
  conditionToSettle: () => "1",
  duplicate: () => "1",
  toReview: () => "1",
  search: (value) => value,
  sellerId: (value) => value,
  platformId: (value) => value,
  // `tag-filter.ts`' own spelling — `appendTagFilterParams` writes the same two keys the same way —
  // so the route reads it back with `tagFilterFromParams` like every other tag filter's.
  tagIds: (value) => value.join(","),
  tagMode: (value) => value,
};

/** Whether a filter value says nothing — the empty states of every shape this filter set has. */
function isUnset(value: unknown): boolean {
  return (
    value === undefined ||
    value === false ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** The query string the lot list and its facet counts are requested with. */
export function lotParams(filters: AuctionLotFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of Object.keys(LOT_PARAM) as (keyof AuctionLotFilters)[]) {
    const value = filters[key];
    if (isUnset(value)) continue;
    // The mode rides only with the ids, and the default is never sent — `appendTagFilterParams`'
    // rule, so an untouched tag filter's cache key does not depend on the last mode set.
    if (key === "tagMode" && (isUnset(filters.tagIds) || value === DEFAULT_TAG_FILTER_MODE)) continue;
    params.set(key, (LOT_PARAM[key] as (value: unknown) => string)(value));
  }
  return params;
}

/**
 * One filter that is **narrowing** the list, as the band above the rows reports it (#1018): the
 * field it came from, and the value it is set to.
 *
 * The wording is deliberately not here. Every one of these has a control on the toolbar already,
 * and the band has to name it in *that control's own words* or it points at nothing — so the panel
 * maps each key onto the label it draws the chip with, and the band and the chip cannot say
 * different things about one filter. What lives here is the harder half: **which** filters narrow.
 */
export interface LotNarrowing {
  key: keyof AuctionLotFilters;
  /** The raw value, for the panel to look a label up by. `"1"` for the three boolean chips. */
  value: string;
}

/**
 * Which filters narrow the list, keyed the way {@link LOT_PARAM} is and for the same reason: it is
 * typed over **every** key of `AuctionLotFilters`, so a filter added later fails to compile until
 * somebody has decided whether it narrows.
 *
 * That guard is the whole point rather than tidiness. The failure this band exists to prevent is a
 * list narrowed by something nobody can see, and the cheapest way to reintroduce it is to add an
 * eleventh filter and forget to mention it — at which point the band would go on saying "three
 * filters" over a list narrowed by four, which is worse than no band at all.
 *
 * `null` means *this one does not narrow*, and there is exactly one: `includeClosed` **widens** the
 * list (#504), so a band announcing it would tell the collector that lots are being hidden at the
 * moment more of them are being shown. It is still cleared by *Clear filters*, on the Copies list's
 * rule (#733) — a reset puts the screen back to its default, widening switches included — which is
 * a different question from what is narrowing it now.
 */
const LOT_NARROWS: {
  [K in keyof Required<AuctionLotFilters>]-?:
    | null
    | ((value: NonNullable<AuctionLotFilters[K]>) => string | null);
} = {
  outcome: (value) => value,
  includeClosed: null,
  closing: (value) => value,
  signal: (value) => value,
  undescribed: () => "1",
  conditionToSettle: () => "1",
  duplicate: () => "1",
  toReview: () => "1",
  // A blank-but-present search narrows nothing, and the box routinely holds one mid-edit.
  search: (value) => (value.trim() ? value : null),
  sellerId: (value) => value,
  platformId: (value) => value,
  // The ids narrow; the mode only qualifies them, so the band names it inside the tags' own label
  // rather than as a filter of its own.
  tagIds: (value) => (value.length > 0 ? value.join(",") : null),
  tagMode: null,
};

/** Every filter currently narrowing the list, in the order the toolbar reads. */
export function lotNarrowings(filters: AuctionLotFilters): LotNarrowing[] {
  const out: LotNarrowing[] = [];
  for (const key of Object.keys(LOT_NARROWS) as (keyof AuctionLotFilters)[]) {
    const describe = LOT_NARROWS[key];
    if (!describe) continue;
    const value = filters[key];
    if (isUnset(value)) continue;
    const described = (describe as (value: unknown) => string | null)(value);
    if (described !== null) out.push({ key, value: described });
  }
  return out;
}
