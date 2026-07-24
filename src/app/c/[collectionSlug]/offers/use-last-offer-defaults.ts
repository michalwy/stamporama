"use client";

import { useCallback, useSyncExternalStore } from "react";
import { isCreatableOfferState, type OfferState } from "@/lib/offer-rules";

/**
 * The status + listing date last used when creating an offer, remembered per collection in
 * localStorage and reactive across every component that reads the same collection (mirrors
 * {@link useLastUsedPlatform}). The create dialog pre-fills its status and listing-date fields from
 * this so repeated listings are fast (#257); the listing **URL** is never remembered — it is always
 * specific to the individual offer. A client preference, not shareable URL state.
 */
export interface OfferDefaults {
  state: OfferState;
  /** `YYYY-MM-DD`, or "" when none has been recorded yet. */
  listingDate: string;
}

/** Extract the status + listing date a create form submitted, validated, so a successful create can
 * remember them for next time (#257). */
export function offerDefaultsFromForm(formData: FormData): OfferDefaults {
  const rawState = formData.get("state");
  const rawDate = formData.get("listingDate");
  return {
    state: isCreatableOfferState(rawState) ? rawState : "preparing",
    listingDate: typeof rawDate === "string" && ISO_DATE.test(rawDate) ? rawDate : "",
  };
}

const listenersByKey = new Map<string, Set<() => void>>();

function keyFor(collectionId: string): string {
  return `stamporama:offers:last-offer-defaults:${collectionId}`;
}

function listenersFor(key: string): Set<() => void> {
  let set = listenersByKey.get(key);
  if (!set) {
    set = new Set();
    listenersByKey.set(key, set);
  }
  return set;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse the stored JSON into a validated {@link OfferDefaults}, or null when absent / malformed. */
function readDefaults(key: string): OfferDefaults | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: unknown; listingDate?: unknown };
    const state: OfferState = isCreatableOfferState(parsed.state) ? parsed.state : "preparing";
    const listingDate =
      typeof parsed.listingDate === "string" && ISO_DATE.test(parsed.listingDate) ? parsed.listingDate : "";
    return { state, listingDate };
  } catch {
    return null;
  }
}

export function useLastOfferDefaults(
  collectionId: string
): [OfferDefaults | null, (defaults: OfferDefaults) => void] {
  const key = keyFor(collectionId);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const set = listenersFor(key);
      set.add(onChange);
      return () => {
        set.delete(onChange);
      };
    },
    [key]
  );
  // useSyncExternalStore requires a stable snapshot reference; the JSON string is the stable value,
  // parsed by the caller-facing getter below.
  const getRawSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);
  const getServerSnapshot = useCallback(() => null, []);
  const raw = useSyncExternalStore(subscribe, getRawSnapshot, getServerSnapshot);
  const value = raw == null ? null : readDefaults(key);

  const remember = useCallback(
    (defaults: OfferDefaults) => {
      try {
        localStorage.setItem(key, JSON.stringify(defaults));
      } catch {
        // ignore (private mode / disabled storage)
      }
      for (const listener of listenersFor(key)) listener();
    },
    [key]
  );

  return [value, remember];
}
