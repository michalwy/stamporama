"use client";

import { useCallback, useMemo, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { FacebookPostListItem } from "@/lib/facebook-posts";
import { phonePostPath, phonePostsPath } from "@/lib/phone";
import { parsePhonePostsShow, PHONE_POSTS_SHOW_OPTIONS, phonePostsFilters } from "@/lib/phone-post-view";
import { PHONE_TAP_TARGET, phoneRow } from "@/app/phone-screen";
import { useFacebookPostsInfinite, type FacebookPostFilters } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { auctionsEndWhen } from "@/app/c/[collectionSlug]/offers/posts/post-list-dates";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { PhonePostStageChip } from "./phone-post-stage-chip";

/**
 * The phone list of Facebook posts (#2626): the desk's own pages of posts, newest first, under one
 * narrowing kept in the URL (`show`) — the posts not over by default, one stage, or every post. A
 * select rather than the desk's chips, as on the phone's offers (#2008): a chip is under a thumb's
 * target, and five stages do not fit a phone's width.
 *
 * A row says the post's number and title, its group, its stage, how many lots it has and, while it is
 * up, when its auctions close — a time in the collector's own zone, so drawn once mounted (#490).
 */
export function PhonePostsList({
  collectionId,
  collectionSlug,
}: {
  collectionId: string;
  collectionSlug: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawShow = searchParams.get("show") ?? "";
  const show = parsePhonePostsShow(rawShow);

  const filters = useMemo<FacebookPostFilters>(() => ({ groupIds: [], ...phonePostsFilters(show) }), [show]);

  const listPath = phonePostsPath(collectionSlug);
  const setShow = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set("show", value);
      else params.delete("show");
      const qs = params.toString();
      router.replace(`${listPath}${qs ? `?${qs}` : ""}`);
    },
    [router, listPath, searchParams]
  );

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading, isError } = useFacebookPostsInfinite(
    collectionId,
    filters
  );
  const posts = data?.pages.flatMap((page) => page.items) ?? [];
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  return (
    <>
      <select
        aria-label="Show"
        value={show === "notOver" ? "" : show}
        onChange={(e) => setShow(e.target.value)}
        style={SELECT}
      >
        {PHONE_POSTS_SHOW_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {isLoading ? (
        <p style={NOTE}>Loading…</p>
      ) : isError ? (
        <p style={{ ...NOTE, color: "var(--color-error)" }}>The posts could not be loaded.</p>
      ) : posts.length === 0 ? (
        <p style={NOTE}>No posts here.</p>
      ) : (
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {posts.map((post) => (
            <PhonePostRow key={post.postId} post={post} href={phonePostPath(collectionSlug, post.postNo)} />
          ))}
          <InfiniteScrollSentinel onLoadMore={loadMore} hasMore={!!hasNextPage} isLoading={isFetchingNextPage} />
        </nav>
      )}
    </>
  );
}

function PhonePostRow({ post, href }: { post: FacebookPostListItem; href: string }) {
  const hydrated = useHydrated();
  const { endsFrom, endsTo } = post.dates;
  const title = post.title?.trim();
  return (
    <Link href={href} style={{ ...phoneRow, flexDirection: "column", alignItems: "stretch", gap: "0.375rem" }}>
      <span style={{ display: "flex", gap: "0.5rem", minWidth: 0 }}>
        <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>#{post.postNo}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title || <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>No title</span>}
        </span>
      </span>
      <span style={META}>
        <PhonePostStageChip stage={post.stage} />
        <span style={{ whiteSpace: "nowrap" }}>{lotCountText(post.lotCount)}</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {post.group.name}
        </span>
      </span>
      {hydrated && endsFrom && endsTo && (
        <span style={{ ...META, color: "var(--color-text-primary)" }}>
          Closes {auctionsEndWhen(new Date(endsFrom), new Date(endsTo), new Date())}
        </span>
      )}
    </Link>
  );
}

function lotCountText(count: number): string {
  if (count === 0) return "No lots yet";
  return count === 1 ? "1 lot" : `${count} lots`;
}

/** A thumb's select: the phone's tap target, not the desk's form height (`formControl`). */
const SELECT: CSSProperties = {
  width: "100%",
  height: PHONE_TAP_TARGET,
  padding: "0 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "1rem",
  boxSizing: "border-box",
};

const META: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  minWidth: 0,
  fontSize: "0.875rem",
  fontWeight: 400,
  color: "var(--color-text-secondary)",
};

const NOTE: CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  color: "var(--color-text-muted)",
};
