"use client";

import { useEffect, useState } from "react";
import { cancelledSalesWarning } from "@/lib/sale-cancel-rules";

/**
 * How many of a buyer's sales were cancelled (#2500), read when the buyer is chosen — 0 while no
 * buyer is, and while the answer is on its way. A failed read is 0 too: the warning is a heads-up,
 * never a reason a sale cannot be recorded.
 */
export function useBuyerCancelledSales(collectionId: string, buyerId: string | null): number {
  const [fetched, setFetched] = useState<{ buyerId: string; count: number } | null>(null);
  useEffect(() => {
    if (!buyerId) return;
    let stale = false;
    (async () => {
      const { countBuyerCancelledSalesAction } = await import("@/app/actions/sales");
      const count = await countBuyerCancelledSalesAction(collectionId, buyerId);
      if (!stale) setFetched({ buyerId, count });
    })();
    return () => {
      stale = true;
    };
  }, [collectionId, buyerId]);
  // An answer about a buyer no longer chosen is not shown.
  return buyerId && fetched?.buyerId === buyerId ? fetched.count : 0;
}

/**
 * The warning a new sale to a buyer with cancelled sales shows (#2500): *This buyer has 2 cancelled
 * sales.* Nothing while they have none. It stops nothing — whether to sell to them again is the
 * collector's call.
 */
export function BuyerCancelledWarning({ collectionId, buyerId }: { collectionId: string; buyerId: string | null }) {
  const message = cancelledSalesWarning(useBuyerCancelledSales(collectionId, buyerId));
  if (!message) return null;
  return (
    <p role="status" style={{ margin: "0.375rem 0 0", fontSize: "0.75rem", color: "var(--color-warning)" }}>
      {message}
    </p>
  );
}
