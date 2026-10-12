"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { STICKY_TOOLBAR_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { ROW_LINK_ABOVE, RowLink } from "@/app/c/[collectionSlug]/shared/row-link";
import { useRowOpen } from "@/app/c/[collectionSlug]/shared/row-open";
import type { FacebookPostListItem } from "@/lib/facebook-posts";
import {
  FACEBOOK_POST_STAGES,
  FACEBOOK_POST_STAGE_LABEL,
  facebookPostLabel,
  isFacebookPostStage,
} from "@/lib/facebook-post-rules";
import { FACEBOOK_MULTI_LOT_LAYOUT_SHORT_LABEL } from "@/lib/facebook-group-rules";
import { useFacebookPostsInfinite, type FacebookPostFilters } from "../use-offers-query";

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const META_INLINE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

interface FacebookPostsListPanelProps {
  collectionId: string;
  collectionSlug: string;
  /** The groups the collection's posts are in — the group filter's options. */
  groups: { id: string; name: string; archived: boolean }[];
}

/**
 * The list of multi-lot Facebook posts (#1850): each post's number and title (#1862), group, lots and
 * how many are still for sale, where it stands, its layout, the day it went up and its link — the row
 * opening the post's own screen. Newest first, paged on the server like trades; the group, stage and
 * no-title filters live in the URL (`group`, a comma-separated set, `stage`, and `untitled`).
 */
export function FacebookPostsListPanel({ collectionId, collectionSlug, groups }: FacebookPostsListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const groupParam = searchParams.get("group") ?? "";
  const groupIds = useMemo(() => groupParam.split(",").filter(Boolean), [groupParam]);
  const stageParam = searchParams.get("stage") ?? "";
  const stage = isFacebookPostStage(stageParam) ? stageParam : undefined;
  const untitled = searchParams.get("untitled") === "1";

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/offers/posts${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const filters: FacebookPostFilters = useMemo(() => ({ groupIds, stage, untitled }), [groupIds, stage, untitled]);
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = useFacebookPostsInfinite(
    collectionId,
    filters
  );
  const rows = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const hasActiveFilters = groupIds.length > 0 || !!stage || untitled;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      <div
        style={{
          ...STICKY_TOOLBAR_STYLE,
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          padding: "0.5rem 0",
          background: "var(--color-bg-page)",
        }}
      >
        <MultiSelectFilter
          options={groups.map((g) => ({ id: g.id, label: g.archived ? `${g.name} (archived)` : g.name }))}
          selected={groupIds}
          onChange={(ids) => updateParams({ group: ids.join(",") })}
          allLabel="All groups"
          itemNoun="groups"
          ariaLabel="Filter by group"
        />
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
          {FACEBOOK_POST_STAGES.map((value) => (
            <FilterChip
              key={value}
              label={FACEBOOK_POST_STAGE_LABEL[value]}
              active={stage === value}
              onClick={() => updateParams({ stage: stage === value ? "" : value })}
            />
          ))}
        </div>
        {/* Posts made before titles have none until they are given one (#1862). */}
        <FilterChip
          label="No title"
          active={untitled}
          onClick={() => updateParams({ untitled: untitled ? "" : "1" })}
        />
      </div>

      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          flex: 1,
          minHeight: "20rem",
          background: "var(--color-bg-elevated)",
        }}
      >
        {isLoading && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            Loading posts…
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {hasActiveFilters
              ? "No posts match this filter."
              : "No Facebook posts yet. Tick several Facebook offers in Offers and choose Post together."}
          </div>
        )}

        {rows.length > 0 && (
          <>
            {rows.map((post, idx) => (
              <FacebookPostRow
                key={post.postId}
                post={post}
                collectionSlug={collectionSlug}
                isLast={idx === rows.length - 1 && !hasNextPage}
              />
            ))}
            <InfiniteScrollSentinel onLoadMore={fetchNextPage} hasMore={!!hasNextPage} isLoading={isFetchingNextPage} />
          </>
        )}
      </div>
    </div>
  );
}

/** One post as a stacked row; the whole row opens the post's screen, as a real link (#557). */
function FacebookPostRow({
  post,
  collectionSlug,
  isLast,
}: {
  post: FacebookPostListItem;
  collectionSlug: string;
  isLast: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const href = `/c/${collectionSlug}/offers/posts/${post.postNo}`;
  const rowOpen = useRowOpen(href);
  const live = post.stage === "pending" || post.stage === "up";

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        {...rowOpen}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "relative",
          padding: "0.75rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
          cursor: "pointer",
        }}
      >
        <RowLink href={href} label={facebookPostLabel(post)} />

        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", minWidth: 0 }}>
          <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
            Post #{post.postNo}
          </span>
          {post.title ? (
            <span
              style={{
                fontSize: "0.9375rem",
                fontWeight: 600,
                color: "var(--color-text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              · {post.title}
            </span>
          ) : (
            <span style={{ ...META_INLINE, fontStyle: "italic" }}>no title</span>
          )}
          <span
            style={{
              fontSize: "0.875rem",
              color: "var(--color-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {post.group.name}
            {post.group.archived && " (archived)"}
          </span>
        </div>

        <div
          style={{
            ...ROW_LINK_ABOVE,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginTop: "0.3rem",
            flexWrap: "wrap",
          }}
        >
          <Tooltip content="Where the post stands">
            <span
              style={
                live
                  ? {
                      ...CHIP,
                      color: "var(--color-accent)",
                      borderColor: "var(--color-accent-border)",
                    }
                  : CHIP
              }
            >
              {FACEBOOK_POST_STAGE_LABEL[post.stage]}
            </span>
          </Tooltip>
          <Tooltip content="Lots in the post, and how many are neither sold nor withdrawn">
            <span style={CHIP}>
              {post.lotCount} lots · {post.forSaleCount} for sale
            </span>
          </Tooltip>
          <Tooltip content="How the post is laid out">
            <span style={CHIP}>{FACEBOOK_MULTI_LOT_LAYOUT_SHORT_LABEL[post.layout]}</span>
          </Tooltip>
          {post.postedOn && (
            <Tooltip content="The day the post went up">
              <span style={META_INLINE}>posted {post.postedOn}</span>
            </Tooltip>
          )}
          {post.link && (
            <a
              href={post.link}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: "0.75rem", color: "var(--color-accent)", textDecoration: "none" }}
            >
              {post.stage === "pending" ? "pending post" : "post"} ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
