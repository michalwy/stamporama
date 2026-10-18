"use client";

import { useEffect, useState } from "react";
import type { FacebookBuyerLookup } from "@/lib/facebook-sales";

/**
 * Who a buyer named by their Facebook profile is (#1777), re-read a moment after typing stops — the
 * same lookup the save makes, so what the form says and what the save does cannot disagree. Shared by
 * the desk's sale form and the phone's *Sell* (#2009), so both say it in the same words.
 *
 * `enabled` is false off Facebook: nothing is asked then, and nothing is said.
 */
export function useFacebookBuyerLookup(
  collectionId: string,
  enabled: boolean,
  name: string,
  profileUrl: string
): { conflict: string | null; who: string | null } {
  const [fetched, setFetched] = useState<FacebookBuyerLookup | null>(null);
  const typed = enabled && (!!name.trim() || !!profileUrl.trim());
  useEffect(() => {
    if (!typed) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { lookupFacebookBuyerAction } = await import("@/app/actions/facebook");
      const result = await lookupFacebookBuyerAction(collectionId, name, profileUrl);
      if (!cancelled) setFetched(result);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [collectionId, name, profileUrl, typed]);
  // Nothing typed asks nothing: an answer about what was cleared away is not shown.
  const lookup = typed ? fetched : null;
  const who = lookup?.contact
    ? lookup.contact.matchedBy === "profile"
      ? `${lookup.contact.name} — found by their profile link.`
      : `${lookup.contact.name} — an existing contact${
          lookup.contact.facebookProfileUrls.length > 0 || !profileUrl.trim() ? "" : "; the link will be added to it"
        }.`
    : lookup && name.trim()
      ? `A new buyer, ${name.trim()}, will be created.`
      : null;
  return { conflict: lookup?.conflict ?? null, who };
}
