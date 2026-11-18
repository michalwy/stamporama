"use client";

import { useEffect } from "react";
import { rememberPhoneCollectionAction } from "@/app/actions/phone";

/**
 * Remembers this collection as the one the phone opens next (#2574), once the phone screen is in
 * front of the collector.
 *
 * In an effect rather than during the server render on purpose: Next renders a layout to prefetch a
 * link to it, and the phone's *Collections* list links to every collection — a write at render would
 * remember whichever link was prefetched last, not the collection opened. Nothing is drawn, and a
 * failed write is let go: the phone then starts where it would have, which the collector can change
 * with one tap.
 */
export function PhoneCollectionMemory({ collectionSlug }: { collectionSlug: string }) {
  useEffect(() => {
    rememberPhoneCollectionAction(collectionSlug).catch(() => {});
  }, [collectionSlug]);
  return null;
}
