import type { AuctionClosingWindow } from "@/lib/auctions";
import type { LotSignal } from "@/lib/auction-lot";
import type { AuctionLotOutcome } from "@/lib/auction-rules";

/**
 * What the lot list is narrowed to, as the client holds it (#351/#352). A mirror of the server-side
 * `AuctionLotFilters` in `src/lib/auctions.ts`, minus the paging fields and minus `saleId` — a
 * sale's own lots come from `useAuctionSaleDetail`, not from a narrowed flat list.
 */
export interface AuctionLotFilters {
  /** How the bidding went — the toolbar's chips (`won`, `lost`, `watched`…). */
  outcome?: AuctionLotOutcome;
  /** Closing-time window: already ended, or closing inside a day / a week. */
  closing?: AuctionClosingWindow;
  /** A derived state: still biddable, outbid, over ceiling… */
  signal?: LotSignal;
  /** Only lots with nothing described yet (#442). */
  undescribed?: boolean;
  /** Only lots holding a stamp another lot being won also holds (#369). */
  duplicate?: boolean;
  sellerId?: string;
  platformId?: string;
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
  closing: (value) => value,
  signal: (value) => value,
  undescribed: () => "1",
  duplicate: () => "1",
  sellerId: (value) => value,
  platformId: (value) => value,
};

/** The query string the lot list and its facet counts are requested with. */
export function lotParams(filters: AuctionLotFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of Object.keys(LOT_PARAM) as (keyof AuctionLotFilters)[]) {
    const value = filters[key];
    if (value === undefined || value === false || value === "") continue;
    params.set(key, (LOT_PARAM[key] as (value: unknown) => string)(value));
  }
  return params;
}
