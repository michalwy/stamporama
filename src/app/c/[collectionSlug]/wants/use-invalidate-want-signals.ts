"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { auctionKeys } from "@/app/c/[collectionSlug]/auctions/use-auctions-query";
import { inventoryKeys } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { tradeKeys } from "@/app/c/[collectionSlug]/trades/use-trades-query";
import { useInvalidateStampsAndIssues } from "@/app/c/[collectionSlug]/shared/use-invalidate-stamps-and-issues";
import { wantKeys } from "./use-wants-query";

/**
 * **Closing or deleting a want refreshes every cache the want chip is copied onto** (#1236).
 *
 * The want itself lives in the wants queries, but the marker a collector reads rides on the read
 * models of the rows it is drawn on — `StampListItem.wants` and the issue tree's nodes (the rule
 * `useAddWantAction` states), and beyond the catalogue `ItemListItem.wants` on copy rows, the auction
 * lot lines (`src/lib/auction-lines.ts`) and the trade lines (`src/lib/trade-lines.ts`). A settled want
 * that refreshed only the want list left the chip lit on all of those until their own staleness
 * ran out, which on a row read a moment ago is a chip that says the opposite of what was just done.
 *
 * Invalidating a cache nothing has mounted is free — `invalidateQueries` marks it stale and
 * refetches only the active ones — so one unconditional call is cheaper than a judgement per screen
 * about which of these it happens to hold.
 *
 * The Overview's open-want count is **not** here on purpose: that screen states it is never
 * invalidated and recomputes on its next visit (`use-overview-query.ts`).
 */
export function useInvalidateWantSignals() {
  const queryClient = useQueryClient();
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();
  const invalidateWantSignals = useCallback(
    (collectionId: string) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: wantKeys.all(collectionId) }),
        invalidateStampsAndIssues(collectionId),
        queryClient.invalidateQueries({ queryKey: inventoryKeys.all(collectionId) }),
        queryClient.invalidateQueries({ queryKey: auctionKeys.all(collectionId) }),
        queryClient.invalidateQueries({ queryKey: tradeKeys.all(collectionId) }),
      ]),
    [queryClient, invalidateStampsAndIssues]
  );
  return { invalidateWantSignals };
}
