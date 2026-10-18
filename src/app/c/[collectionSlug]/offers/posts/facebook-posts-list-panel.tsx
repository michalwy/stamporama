"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { STICKY_TOOLBAR_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { ROW_LINK_ABOVE, RowLink } from "@/app/c/[collectionSlug]/shared/row-link";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useRowOpen } from "@/app/c/[collectionSlug]/shared/row-open";
import { usePersistedFlag } from "@/app/c/[collectionSlug]/shared/use-persisted-flag";
import { Icon } from "@/app/icons";
import { useToast } from "@/app/toast-provider";
import type { FacebookOfferNotInPost, FacebookPostListItem } from "@/lib/facebook-posts";
import { OFFER_LISTING_TYPE_LABEL } from "@/lib/offer-rules";
import { OfferStateChip } from "../offer-badges";
import {
  FACEBOOK_POST_STAGES,
  FACEBOOK_POST_STAGE_LABEL,
  facebookPostLabel,
  isFacebookPostStage,
} from "@/lib/facebook-post-rules";
import { FACEBOOK_MULTI_LOT_LAYOUT_SHORT_LABEL } from "@/lib/facebook-group-rules";
import {
  useFacebookOffersNotInPost,
  useFacebookPostsInfinite,
  useInvalidateOffers,
  type FacebookPostFilters,
} from "../use-offers-query";
import { DeleteFacebookPostDialog, deletedPostMessage } from "./delete-post-dialog";

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
 * The list of Facebook posts (#1850): each post's number and title (#1862), group, lots and how many
 * are still for sale, where it stands, its layout, the day it went up and its link — the row opening
 * the post's own screen. Newest first, paged on the server like trades; the group, stage and no-title
 * filters live in the URL (`group`, a comma-separated set, `stage`, and `untitled`).
 *
 * Every Facebook offer that has gone up is in a post (#1989) — one posted alone in a post of one lot —
 * so the list is everything up on Facebook. Above it, *Not in a post yet* names the Facebook offers
 * still being prepared or Ready in no post, so the screen is the whole of Facebook, published or not;
 * the group filter narrows it, the *Being prepared* and *Ready to post* chips narrow it to that state,
 * and a chip only posts can be in (or *No title*) hides it. It folds to one line with its count
 * (#1991), folded the first time and left as the collector last left it after that.
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
  // An offer in no post is still being prepared or Ready, and has no title to lack.
  const notInPostStates = stage === "preparing" ? ["preparing"] : stage === "ready" ? ["ready"] : null;
  const showNotInPost = !untitled && (!stage || notInPostStates !== null);
  const { data: notInPost } = useFacebookOffersNotInPost(collectionId, groupIds, notInPostStates, showNotInPost);

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

      {showNotInPost && notInPost && notInPost.length > 0 && (
        <NotInPost offers={notInPost} collectionId={collectionId} collectionSlug={collectionSlug} />
      )}

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
              : "No Facebook posts yet. A Facebook offer gets its post when it is published; several go into one with Post together in Offers."}
          </div>
        )}

        {rows.length > 0 && (
          <>
            {rows.map((post, idx) => (
              <FacebookPostRow
                key={post.postId}
                post={post}
                collectionId={collectionId}
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

/** The Facebook offers in no post yet (#1989), each linking to its offer: published alone it gets a
 *  post of its own, or it joins a post with others first. Folded it is one line, its heading and
 *  count (#1991); whether it is open is a client preference remembered per collection, closed until
 *  the collector first opens it — useful when wanted, and pushing the posts down the rest of the time. */
function NotInPost({
  offers,
  collectionId,
  collectionSlug,
}: {
  offers: FacebookOfferNotInPost[];
  collectionId: string;
  collectionSlug: string;
}) {
  const [expanded, setExpanded] = usePersistedFlag(`stamporama:facebook-posts:notInPostExpanded:${collectionId}`);

  return (
    <section
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        background: "var(--color-bg-elevated)",
        padding: expanded ? "0.75rem 1.25rem" : "0.5rem 1.25rem",
      }}
    >
      <h3 style={{ margin: expanded ? "0 0 0.5rem" : 0, fontSize: "0.9375rem", fontWeight: 600 }}>
        <Tooltip content="Facebook offers being prepared or Ready that are in no post. Published alone, one becomes a post of its own; Post together or Add to post in Offers puts several into one.">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              padding: 0,
              border: "none",
              background: "none",
              cursor: "pointer",
              font: "inherit",
              color: "var(--color-text-primary)",
            }}
          >
            <span aria-hidden style={{ display: "inline-flex", color: "var(--color-text-muted)" }}>
              <Icon name={expanded ? "collapse" : "expand"} size="sm" />
            </span>
            Not in a post yet · {offers.length}
          </button>
        </Tooltip>
      </h3>
      {expanded && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {offers.map((offer) => (
            <li key={offer.offerId} style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
              <Link
                href={`/c/${collectionSlug}/offers/${offer.offerId}`}
                style={{
                  fontSize: "0.875rem",
                  color: "var(--color-accent)",
                  textDecoration: "none",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                #{offer.offerNo} · {offer.title}
              </Link>
              <span style={{ ...META_INLINE, overflow: "hidden", textOverflow: "ellipsis" }}>
                {offer.group.name}
                {offer.group.archived && " (archived)"} · {OFFER_LISTING_TYPE_LABEL[offer.listingType].toLowerCase()}
              </span>
              <OfferStateChip state={offer.state} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One post as a stacked row; the whole row opens the post's screen, as a real link (#557), and its
 *  `⋮` deletes it (#2060). */
function FacebookPostRow({
  post,
  collectionId,
  collectionSlug,
  isLast,
}: {
  post: FacebookPostListItem;
  collectionId: string;
  collectionSlug: string;
  isLast: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { invalidateAll } = useInvalidateOffers();
  const { toast } = useToast();
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
          <span style={{ flex: 1 }} />
          <span style={ROW_LINK_ABOVE}>
            <RowActionsMenu
              ariaLabel={`Post #${post.postNo} actions`}
              actions={[
                { key: "delete", label: "Delete post…", icon: "delete", danger: true, onSelect: () => setDeleting(true) },
              ]}
            />
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
          {post.lotCount > 1 ? (
            <>
              <Tooltip content="Lots in the post, and how many are neither sold nor withdrawn">
                <span style={CHIP}>
                  {post.lotCount} lots · {post.forSaleCount} for sale
                </span>
              </Tooltip>
              <Tooltip content="How the post is laid out">
                <span style={CHIP}>{FACEBOOK_MULTI_LOT_LAYOUT_SHORT_LABEL[post.layout]}</span>
              </Tooltip>
            </>
          ) : (
            <Tooltip content="One offer posted alone — a post of one lot, written as a single post">
              <span style={CHIP}>Posted alone{post.forSaleCount === 0 ? " · closed" : ""}</span>
            </Tooltip>
          )}
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
      {deleting && (
        <DeleteFacebookPostDialog
          postId={post.postId}
          onClose={() => setDeleting(false)}
          onDeleted={(deleted) => {
            setDeleting(false);
            toast({ message: deletedPostMessage(deleted) });
            void invalidateAll(collectionId);
          }}
        />
      )}
    </div>
  );
}
