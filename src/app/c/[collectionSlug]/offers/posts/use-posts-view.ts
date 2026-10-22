"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePersistedFilterParams } from "@/app/c/[collectionSlug]/shared/use-persisted-filter-params";
import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import {
  POSTS_GROUP_PARAM,
  POSTS_VIEW_PARAMS,
  postsViewClearUpdates,
  postsViewUpdatesFor,
  postsViewUrlUpdates,
  pruneStoredGroups,
  resolvePostsView,
  type PostsView,
} from "./posts-view-params";

/**
 * The toolbar over the list of Facebook posts, kept in the address and remembered per collection
 * (#2108) — `useIntakeView`'s arrangement, for the reasons given there and in `posts-view-params.ts`:
 * the address wins wherever it names a setting, the remembered set fills in the rest, every press
 * writes both, and a restored setting is written back into the address so a reload, the Back button
 * and a copied link agree with what is on screen (#325, #693, #844).
 */
export function usePostsView(
  collectionId: string,
  basePath: string,
  /** The groups holding posts — the group filter's options, and what a remembered id is checked against. */
  knownGroups: ReadonlySet<string>
): {
  view: PostsView;
  /** Change one or more settings. Everything not named keeps the value in force. */
  setView: (patch: Partial<PostsView>) => void;
  /** Back to every post. */
  clearFilters: () => void;
} {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();

  const { readParam, remember } = usePersistedFilterParams(
    "facebook-posts-view",
    collectionId,
    POSTS_VIEW_PARAMS,
    searchParams
  );

  // A **stored** group that no longer holds a post is dropped rather than applied; one the address
  // names is taken as written.
  const readView = useCallback(
    (key: string) => {
      const value = readParam(key);
      if (key !== POSTS_GROUP_PARAM || searchParams.has(key)) return value;
      return pruneStoredGroups(value, knownGroups);
    },
    [readParam, searchParams, knownGroups]
  );
  const view = useMemo(() => resolvePostsView(readView), [readView]);

  /** The one funnel every control writes through, and the reason {@link remember} is called here: a
   *  setting cleared to nothing leaves the URL, so a stored copy not written in the same breath would
   *  be read straight back (#693's trap). */
  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      remember(updates);
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(qs ? `${basePath}?${qs}` : basePath);
    },
    [remember, searchParams, router, basePath]
  );

  const setView = useCallback((patch: Partial<PostsView>) => updateParams(postsViewUpdatesFor(patch)), [updateParams]);
  const clearFilters = useCallback(() => updateParams(postsViewClearUpdates()), [updateParams]);

  /** The restore's other half (#844), with `replace` — a restore is not a navigation the Back button
   *  should have to walk through. */
  const writeToUrl = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  };
  const writeToUrlRef = useRef(writeToUrl);
  useEffect(() => {
    writeToUrlRef.current = writeToUrl;
  });

  useEffect(() => {
    // The memory arrives with hydration; mirroring before it would write the defaults over it.
    if (!hydrated) return;
    const updates = postsViewUrlUpdates(view, (key) => searchParams.get(key));
    if (!updates) return;
    writeToUrlRef.current(updates);
  }, [hydrated, view, searchParams]);

  return { view, setView, clearFilters };
}
