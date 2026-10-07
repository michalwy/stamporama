"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FacebookGroupChoice } from "@/lib/facebook-auctions";
import { facebookDefaultEndsAt, NO_FACEBOOK_CHOICE, type FacebookCreateChoice } from "@/lib/facebook-post-rules";

/**
 * The Facebook group a shortcut creates its offer in (#1663): every create step that is not the offer
 * form — the Lot builder, quick offer mode and the generator on the Copies list, *Series from singles*
 * — asks it beside its create button, because an offer on Facebook is in one group (#1544) and the
 * server refuses one without it.
 *
 * Starts on the group last used **on that platform**, remembered per collection in localStorage the
 * way the last platform is (`useLastUsedPlatform`): a collector working through a pile of lots posts
 * them to the same group, and asking again each time would be the dialog the shortcut exists to skip.
 * A remembered group that has been archived or deleted since is simply not offered.
 *
 * The server reads the group's increment, currency and starting price as the offer is made, exactly as
 * for one from the form. Only the closing time is worked out here (`choice()`), from the group's length
 * and time of day, because it is a local time and the browser is the only place the zone is known
 * (#490) — at the moment of the click, as the form does when the group is picked.
 */
export interface FacebookGroupChoiceState {
  /** The platform is Facebook. False while it is still being asked, and on every other platform. */
  isFacebook: boolean;
  /** Still asking whether the platform is Facebook — a create button waits for the answer. */
  loading: boolean;
  /** The groups a new offer may be in, by name; archived ones are not offered. */
  groups: FacebookGroupChoice[];
  groupId: string;
  group: FacebookGroupChoice | null;
  choose: (groupId: string) => void;
  /** Why the create step cannot go ahead yet, in the collector's words — or null when it can. */
  missing: string | null;
  /** What the create sends: the group and its closing time, or nothing off Facebook. */
  choice: () => FacebookCreateChoice;
  /** Remember the chosen group as this platform's last used, after a create that went through. */
  remember: () => void;
}

export const FACEBOOK_GROUP_MISSING = "Choose the Facebook group this offer is in.";
export const FACEBOOK_NO_GROUPS =
  "This platform has no Facebook groups yet — add one in Settings → Facebook first.";

export function useFacebookGroupChoice(collectionId: string, platformId: string): FacebookGroupChoiceState {
  const { data, isLoading } = useQuery({
    // The offer form's own key (with no group of an existing offer to keep), so the two share a read.
    queryKey: ["facebook-group-choices", collectionId, platformId, null],
    queryFn: async () => {
      const { facebookGroupChoicesAction } = await import("@/app/actions/facebook");
      return facebookGroupChoicesAction(collectionId, platformId, null);
    },
    enabled: !!platformId,
    staleTime: 30_000,
  });
  const isFacebook = !!platformId && data?.isFacebook === true;
  const groups = isFacebook ? data!.groups.filter((g) => !g.archived) : [];

  const [lastUsed, rememberGroup] = useLastFacebookGroup(collectionId, platformId);
  // The collector's own pick, held with the platform it was made on so a platform change drops it.
  const [picked, setPicked] = useState<{ platformId: string; groupId: string } | null>(null);
  const ownPick = picked?.platformId === platformId ? picked.groupId : null;
  const groupId = ownPick ?? (lastUsed && groups.some((g) => g.id === lastUsed) ? lastUsed : "");
  const group = groups.find((g) => g.id === groupId) ?? null;

  const choose = (id: string) => setPicked({ platformId, groupId: id });
  const choice = (): FacebookCreateChoice => {
    if (!group) return NO_FACEBOOK_CHOICE;
    const endsAt = facebookDefaultEndsAt(new Date(), group.auctionDays, group.closingTime);
    return { facebookGroupId: group.id, endsAt: endsAt?.toISOString() ?? null };
  };
  const remember = () => {
    if (group) rememberGroup(group.id);
  };

  return {
    isFacebook,
    loading: !!platformId && isLoading,
    groups,
    groupId,
    group,
    choose,
    missing: !isFacebook || group ? null : groups.length === 0 ? FACEBOOK_NO_GROUPS : FACEBOOK_GROUP_MISSING,
    choice,
    remember,
  };
}

// ── The last group used, per platform ─────────────────────────────────────────────────────────────

const listenersByKey = new Map<string, Set<() => void>>();

function keyFor(collectionId: string, platformId: string): string {
  return `stamporama:offers:last-facebook-group:${collectionId}:${platformId}`;
}

function listenersFor(key: string): Set<() => void> {
  let set = listenersByKey.get(key);
  if (!set) {
    set = new Set();
    listenersByKey.set(key, set);
  }
  return set;
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Record `groupId` as the last group a Facebook offer on `platformId` was created in — also what the
 *  offer form calls once it has created one, so either way of making an auction moves the default. */
export function rememberFacebookGroup(collectionId: string, platformId: string, groupId: string): void {
  const key = keyFor(collectionId, platformId);
  if (!platformId || !groupId || readRaw(key) === groupId) return;
  try {
    localStorage.setItem(key, groupId);
  } catch {
    // ignore (private mode / disabled storage)
  }
  for (const listener of listenersFor(key)) listener();
}

function useLastFacebookGroup(
  collectionId: string,
  platformId: string
): [string | null, (groupId: string) => void] {
  const key = keyFor(collectionId, platformId);
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
  const getSnapshot = useCallback(() => (platformId ? readRaw(key) : null), [key, platformId]);
  const getServerSnapshot = useCallback(() => null, []);
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const remember = useCallback(
    (groupId: string) => rememberFacebookGroup(collectionId, platformId, groupId),
    [collectionId, platformId]
  );
  return [value, remember];
}
