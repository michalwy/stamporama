"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/toast-provider";
import { useInvalidateOffers } from "@/app/c/[collectionSlug]/offers/use-offers-query";

/**
 * Recording a Facebook group auction's bid on the phone — the offer's screen (#2010) and each lot of
 * the post's screen (#2630) alike, through the desk card's own write (`patchOfferAction(…, "price")`,
 * #1545), so the desk shows it exactly as if typed there: the offer's price, dated by
 * `priceCheckedAt`. One per offer, so a bid typed for one lot is saved on its own and none typed
 * for another is lost while it is.
 */
export function useRecordBid(collectionId: string, offerId: string, recordedMessage: string) {
  const router = useRouter();
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateOffers();
  const [isPending, startTransition] = useTransition();
  const [bid, setBid] = useState("");
  const [error, setError] = useState<string | undefined>();

  function record() {
    if (isPending || !bid.trim()) return;
    setError(undefined);
    startTransition(async () => {
      const { patchOfferAction } = await import("@/app/actions/offers");
      const result = await patchOfferAction(offerId, "price", bid);
      if (result.status === "success") {
        setBid("");
        void invalidateAll(collectionId);
        router.refresh();
        toast({ message: recordedMessage });
      } else setError(result.message);
    });
  }

  return { bid, setBid, error, isPending, record, canRecord: !isPending && bid.trim() !== "" };
}
