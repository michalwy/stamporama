"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ProfitAndLoss, ProfitAndLossSalesPage } from "@/lib/profit-and-loss";
import type { DateRange, PeriodGranularity } from "@/lib/profit-and-loss-rules";

function rangeParams(range: DateRange): URLSearchParams {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  return params;
}

/**
 * The profit and loss screen's two reads (#1305). Keyed under `["sales", collectionId, …]`, so
 * anything that changes a sale — which is what moves these figures — invalidates them with the
 * Sales list (`saleKeys.all`).
 */
export function useProfitAndLoss(
  collectionId: string,
  range: DateRange,
  granularity: PeriodGranularity
) {
  return useQuery<ProfitAndLoss>({
    queryKey: ["sales", collectionId, "profit-and-loss", "summary", range, granularity] as const,
    queryFn: async () => {
      const params = rangeParams(range);
      params.set("period", granularity);
      const res = await fetch(
        `/api/collections/${collectionId}/sales/profit-and-loss?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load profit and loss");
      return res.json();
    },
  });
}

export function useProfitAndLossSales(collectionId: string, range: DateRange) {
  return useInfiniteQuery<ProfitAndLossSalesPage>({
    queryKey: ["sales", collectionId, "profit-and-loss", "sales", range] as const,
    queryFn: async ({ pageParam }) => {
      const params = rangeParams(range);
      if (pageParam) params.set("offset", pageParam as string);
      const res = await fetch(
        `/api/collections/${collectionId}/sales/profit-and-loss/sales?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load sales");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
