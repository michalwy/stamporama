"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ItemListItem } from "@/lib/items";
import type { TradeData } from "@/lib/trades";
import type { TradeReservationRead } from "@/lib/trade-reservations";
import type { TradeFeedbackRead } from "@/lib/trade-feedback";
import type { TradeBalanceRead } from "@/lib/trade-valuation";
import type { TradeLineFilters, TradeLinePage } from "@/lib/trade-lines";
import type { TradeGroupLevel } from "@/lib/trade-grouping";
import type { TradeSide } from "@/lib/trade-rules";

// The trade screen's reads (#637). Everything lives under the `trades` key, so the one invalidation
// the list panel already exposes refreshes this screen too — a status changed from the row menu and
// a status changed from the screen must not leave the other stale.

export interface TradeDetailData {
  trade: TradeData;
  /** The reservation (#639): promised copies live on a marketplace, and promised copies that have
   *  since left. Rides with the header rather than with the figures because it costs two light
   *  queries over the give side's ids, and because it is what the screen states so that the refusal
   *  on **Agree** is met before the button rather than by it. */
  reservation: TradeReservationRead;
  /** What the partner said back through the shared link (#641), open items first. The badge on this
   *  screen and on the list row is `open > 0` — derived, never a status (ADR-0039 §6). */
  feedback: TradeFeedbackRead;
}

/** What one column is showing: its own arrangement, search and filters. Two columns hold two of
 *  these, which is the whole point — the questions asked of the two sides differ. */
export interface TradeLineQuery {
  sectionId: string;
  side: TradeSide;
  levels: readonly TradeGroupLevel[];
  filters: TradeLineFilters;
}

export const tradeDetailKeys = {
  detail: (collectionId: string, tradeId: string) =>
    ["trades", collectionId, "detail", tradeId] as const,
  lines: (collectionId: string, tradeId: string, query: TradeLineQuery) =>
    ["trades", collectionId, "lines", tradeId, query] as const,
  offerable: (collectionId: string, tradeId: string, areaIds: string[] | null, forTrade: boolean) =>
    ["trades", collectionId, "offerable", tradeId, areaIds, forTrade] as const,
  balance: (collectionId: string, tradeId: string) =>
    ["trades", collectionId, "balance", tradeId] as const,
};

/** The trade and its sections. The lines are **not** here — each side pages on its own. */
export function useTradeDetail(collectionId: string, tradeId: string) {
  return useQuery<TradeDetailData>({
    queryKey: tradeDetailKeys.detail(collectionId, tradeId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/trades/${tradeId}`);
      if (!res.ok) throw new Error("Failed to load trade");
      return res.json();
    },
  });
}

/**
 * What both sides are worth and whether the trade balances (#638).
 *
 * Its **own** query, not part of the header's, because it costs more: valuing every line of both
 * sides against two catalogs is a heavier question than "what are the terms and how many lines",
 * and the terms card should not wait on it. One query for the whole trade, though — the sections'
 * verdicts and the trade's are read off one set of figures at one moment, and assembling them from
 * a call per section would let a screen show every section balanced and the trade not.
 *
 * Under the same `trades` key as everything else, so adding a line refreshes the figures too. A
 * balance that still described the list as it was two edits ago is worse than no balance at all.
 */
export function useTradeBalance(collectionId: string, tradeId: string) {
  return useQuery<{ balance: TradeBalanceRead }>({
    queryKey: tradeDetailKeys.balance(collectionId, tradeId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/trades/${tradeId}/balance`);
      if (!res.ok) throw new Error("Failed to load balance");
      return res.json();
    },
  });
}

/**
 * One column: its lines, paged.
 *
 * The arrangement travels **to the server** with the query rather than being applied to what comes
 * back, because a group computed over one page is a group that lies about the pages not fetched
 * yet. It is part of the query key for the same reason: changing the levels makes it a different
 * list, not the same list drawn differently.
 */
export function useTradeLines(collectionId: string, tradeId: string, query: TradeLineQuery) {
  return useInfiniteQuery<TradeLinePage>({
    queryKey: tradeDetailKeys.lines(collectionId, tradeId, query),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ sectionId: query.sectionId, side: query.side });
      if (pageParam) params.set("offset", pageParam as string);
      if (query.levels.length > 0) params.set("group", query.levels.join(","));
      if (query.filters.search) params.set("search", query.filters.search);
      for (const id of query.filters.conditionIds ?? []) params.append("conditionId", id);
      if (query.filters.noPhotos) params.set("noPhotos", "true");
      if (query.filters.missingCatalogValue) params.set("noCatalogValue", "true");
      const res = await fetch(
        `/api/collections/${collectionId}/trades/${tradeId}/lines?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load lines");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/**
 * The copies the give side could still promise, area-scoped on the server.
 *
 * Year and text are filtered client-side for instant facets, exactly as the offer composition and
 * lot pickers do — and `forTrade` is a *parameter* rather than a client-side toggle because it
 * changes which rows the server sends: a collection with thousands of copies would otherwise ship
 * all of them to filter three away.
 */
export function useOfferableCopies(
  collectionId: string,
  tradeId: string,
  areaIds: string[] | null,
  forTradeOnly: boolean
) {
  return useQuery<ItemListItem[]>({
    queryKey: tradeDetailKeys.offerable(collectionId, tradeId, areaIds, forTradeOnly),
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const id of areaIds ?? []) params.append("areaId", id);
      if (!forTradeOnly) params.set("forTrade", "false");
      const res = await fetch(
        `/api/collections/${collectionId}/trades/${tradeId}/offerable-copies?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load copies");
      return (await res.json()).items;
    },
  });
}

export function useInvalidateTradeDetail() {
  const queryClient = useQueryClient();
  return {
    /** Everything under the trades key: the header, both columns of every section, the picker's
     *  eligibility and the list behind it. A line added to one column changes the section's counts
     *  in the header and the row's counts on the list. */
    invalidateTrade: (collectionId: string) =>
      queryClient.invalidateQueries({ queryKey: ["trades", collectionId] }),
  };
}
