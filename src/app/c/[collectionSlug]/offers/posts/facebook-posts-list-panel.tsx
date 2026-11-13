"use client";

import { ListPresetsControl } from "@/app/c/[collectionSlug]/shared/list-presets-control";
import { POSTS_VIEW } from "@/app/c/[collectionSlug]/shared/list-view-specs";
import { useMemo, useState } from "react";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { LIST_BANNER_STYLE, STICKY_TOOLBAR_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { FILTER_CONTROL_STYLE, FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { ROW_LINK_ABOVE, RowLink } from "@/app/c/[collectionSlug]/shared/row-link";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useRowOpen } from "@/app/c/[collectionSlug]/shared/row-open";
import { useToast } from "@/app/toast-provider";
import type { FacebookPostListItem } from "@/lib/facebook-posts";
import {
  FACEBOOK_POST_STAGES,
  FACEBOOK_POST_STAGE_LABEL,
  facebookPostLabel,
} from "@/lib/facebook-post-rules";
import { FACEBOOK_MULTI_LOT_LAYOUT_SHORT_LABEL } from "@/lib/facebook-group-rules";
import {
  useFacebookPostsInfinite,
  useInvalidateOffers,
  type FacebookPostFilters,
} from "../use-offers-query";
import { DeleteFacebookPostDialog, deletedPostMessage } from "./delete-post-dialog";
import { NewFacebookPostDialog } from "./new-post-dialog";
import { postsViewNarrowings, type PostsNarrowing } from "./posts-view-params";
import { usePostsView } from "./use-posts-view";
import { calendarDay, relativeDay, shortDay, shortDayTime } from "./post-list-dates";

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
  /** The Facebook platform, while it is switched on — what *New post…* makes a post in (#2291). */
  facebookPlatformId: string | null;
}

/**
 * The list of Facebook posts (#1850): each post's number and title (#1862), group, lots and how many
 * are still for sale, where it stands with the dates that matter at that stage, its layout and its
 * link, and under them its figures (#2502) — the row opening the post's own screen. Newest first, paged on the server like trades; the group, stage and no-title
 * filters live in the URL (`group`, a comma-separated set, `stage`, and `untitled`) and are remembered
 * per collection (#2108, `use-posts-view.ts`), so the list comes back as it was left however it is
 * reached; while one narrows the list, the band under the toolbar says so with *Clear filters*.
 *
 * Every Facebook offer is in a post from the moment it is made (#2116) — one meant to go up alone in a
 * post of one lot — so the list is the whole of Facebook, published or not. *Not in a post yet*, the
 * offers in no post that sat above the rows (#1989, #1991), went with that: there are none.
 */
export function FacebookPostsListPanel({
  collectionId,
  collectionSlug,
  groups,
  facebookPlatformId,
}: FacebookPostsListPanelProps) {
  const [creating, setCreating] = useState(false);
  const knownGroups = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const { view, setView, clearFilters } = usePostsView(collectionId, `/c/${collectionSlug}/offers/posts`, knownGroups);
  const { groups: groupIds, stage, untitled } = view;

  const filters: FacebookPostFilters = useMemo(() => ({ groupIds, stage, untitled }), [groupIds, stage, untitled]);
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = useFacebookPostsInfinite(
    collectionId,
    filters
  );
  const rows = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const narrowings = postsViewNarrowings(view);
  const hasActiveFilters = narrowings.length > 0;

  /** One narrowing as the band names it — in the words of the control that set it, so it can be found
   *  on the toolbar and switched off there as well as by *Clear filters*. */
  function narrowingLabel(n: PostsNarrowing): string {
    switch (n.key) {
      case "groups":
        return `Group: ${n.value.map((id) => groups.find((g) => g.id === id)?.name ?? "Unknown group").join(" or ")}`;
      case "stage":
        return FACEBOOK_POST_STAGE_LABEL[n.value];
      case "untitled":
        return "No title";
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* The narrowed-list band sits inside the sticky block, as on the Intake documents list (#848). */}
      <div
        style={{
          ...STICKY_TOOLBAR_STYLE,
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          padding: "0.5rem 0",
          background: "var(--color-bg-page)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <ListPresetsControl collectionId={collectionId} spec={POSTS_VIEW} />
          <MultiSelectFilter
            options={groups.map((g) => ({ id: g.id, label: g.archived ? `${g.name} (archived)` : g.name }))}
            selected={groupIds}
            onChange={(ids) => setView({ groups: ids })}
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
                onClick={() => setView({ stage: stage === value ? undefined : value })}
              />
            ))}
          </div>
          {/* Posts made before titles have none until they are given one (#1862). */}
          <FilterChip
            label="No title"
            active={untitled}
            onClick={() => setView({ untitled: !untitled })}
          />
          {/* A post made by hand, empty, its lots then made on its screen (#2291). */}
          {facebookPlatformId && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              style={{
                ...FILTER_CONTROL_STYLE,
                marginLeft: "auto",
                cursor: "pointer",
                fontWeight: 600,
                color: "#fff",
                background: "var(--color-action-primary)",
                border: "none",
                padding: "0.375rem 0.875rem",
              }}
            >
              New post…
            </button>
          )}
        </div>
        {hasActiveFilters && (
          <div style={LIST_BANNER_STYLE}>
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-primary)" }}>
              This list is narrowed — {narrowings.map(narrowingLabel).join(" · ")}
            </span>
            <button
              type="button"
              onClick={clearFilters}
              style={{
                ...FILTER_CONTROL_STYLE,
                marginLeft: "auto",
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "var(--color-accent)",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              Clear filters
            </button>
          </div>
        )}
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
              : "No Facebook posts yet. Every Facebook offer is in a post from the moment it is made; several go into one with Post together in Offers, or make a post with New post… and its lots on its screen."}
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
      {creating && facebookPlatformId && (
        <NewFacebookPostDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          platformId={facebookPlatformId}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
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
          {post.lotCount === 0 ? (
            <Tooltip content="A post made by hand, its lots still to be made or added">
              <span style={CHIP}>No lots yet</span>
            </Tooltip>
          ) : post.lotCount > 1 ? (
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
          <PostDates post={post} />
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
        {post.figures.lotCount > 0 && <PostFigures post={post} />}
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

/** The dates beside a post's stage chip (#2502), by its stage: when it was made — and submitted, while
 *  it waits for approval — since when it has been up and when its auctions end, or when it went up and
 *  when it ended. A date that was never recorded is left out. */
function PostDates({ post }: { post: FacebookPostListItem }) {
  const now = new Date();
  const { dates } = post;
  const parts: { key: string; text: string; hint: string }[] = [];
  if (post.stage === "preparing" || post.stage === "ready" || post.stage === "pending") {
    parts.push({ key: "created", text: `created ${shortDay(new Date(dates.createdAt), now)}`, hint: "When the post was made" });
  }
  if (dates.submittedAt) {
    const at = new Date(dates.submittedAt);
    parts.push({
      key: "submitted",
      text: `submitted ${shortDay(at, now)} (${relativeDay(at, now)})`,
      hint: "When the post was submitted to the group for approval",
    });
  }
  if (dates.upSince) {
    const day = calendarDay(dates.upSince);
    parts.push(
      post.stage === "up"
        ? { key: "up", text: `up since ${shortDay(day, now)} (${relativeDay(day, now)})`, hint: "The day the post went up" }
        : { key: "up", text: `up ${shortDay(day, now)}`, hint: "The day the post went up" }
    );
  }
  if (dates.endsFrom && dates.endsTo) {
    const from = new Date(dates.endsFrom);
    const to = new Date(dates.endsTo);
    parts.push(
      dates.endsFrom === dates.endsTo
        ? { key: "ends", text: `auctions end ${shortDayTime(from, now)} (${relativeDay(from, now)})`, hint: "When the post's auctions end" }
        : {
            key: "ends",
            text: `auctions end ${shortDayTime(from, now)} – ${shortDayTime(to, now)}`,
            hint: "The post's auctions end at different times — the earliest and the latest",
          }
    );
  }
  if (dates.endedAt) {
    parts.push({ key: "ended", text: `ended ${shortDay(new Date(dates.endedAt), now)}`, hint: "When the post's last lot ended" });
  }
  return (
    <>
      {parts.map((p) => (
        <Tooltip key={p.key} content={p.hint}>
          <span style={META_INLINE}>{p.text}</span>
        </Tooltip>
      ))}
    </>
  );
}

const FIGURE_LABEL: React.CSSProperties = { color: "var(--color-text-muted)" };
const FIGURE_VALUE: React.CSSProperties = {
  color: "var(--color-text-secondary)",
  fontWeight: 500,
  fontVariantNumeric: "tabular-nums",
};

/** "over 2 of 3 lots" — said where a figure leaves some lots out. */
function overLots(counted: number, of: number): string | null {
  return counted < of ? `over ${counted} of ${of} lots` : null;
}

/** The row of figures under a post's chips (#2502): lots and copies, what it asks, its catalogue value
 *  and cost, and what has sold — money in the base currency. Nothing missing reads as 0. */
function PostFigures({ post }: { post: FacebookPostListItem }) {
  const { figures: f, baseCurrency } = post;
  const money = (amount: string | null) => (amount === null ? "—" : `${amount} ${baseCurrency}`);
  const askingNotes = [
    f.asking.unpriced > 0 ? `${f.asking.unpriced} unpriced` : null,
    f.asking.unconvertible > 0 ? `${f.asking.unconvertible} with no rate` : null,
  ].filter((n): n is string => n !== null);
  const costMarks = [f.cost.estimated ? "estimate" : null, f.cost.opening ? "incl. opening value" : null].filter(
    (n): n is string => n !== null
  );
  const items: { key: string; label: string; value: string; note?: string; hint: string }[] = [
    {
      key: "lots",
      label: "Lots",
      value: `${f.lotCount} · ${f.copyCount} ${f.copyCount === 1 ? "copy" : "copies"}`,
      hint: "Lots in the post, and how many copies they hold in all",
    },
    {
      key: "asking",
      label: "Asking",
      value: money(f.asking.amount),
      note: askingNotes.length ? askingNotes.join(", ") : undefined,
      hint: "The lots' prices summed — a quick buy's asking price, an auction's starting price — in the base currency. Lots with no price yet are left out and counted.",
    },
    {
      key: "catalogue",
      label: "Catalogue",
      value: money(f.catalogue.amount),
      note: f.catalogue.amount !== null ? (overLots(f.catalogue.lots, f.lotCount) ?? undefined) : undefined,
      hint: "The catalogue value of the lots' copies, as each offer's price table reads it",
    },
    {
      key: "cost",
      label: "Cost",
      value: money(f.cost.amount),
      note:
        f.cost.amount !== null
          ? [...costMarks, overLots(f.cost.lots, f.lotCount)].filter((n): n is string => n !== null).join(", ") || undefined
          : undefined,
      hint: "What the lots' copies cost, as each offer's price table reads it",
    },
    {
      key: "sold",
      label: "Sold",
      value:
        f.sold.lots === 0
          ? "—"
          : `${f.sold.lots} ${f.sold.lots === 1 ? "lot" : "lots"} · ${money(f.sold.amount)}`,
      note: f.sold.unconvertible > 0 ? `${f.sold.unconvertible} with no rate` : undefined,
      hint: "Lots in a recorded sale and what they brought — a cancelled sale does not count",
    },
  ];
  return (
    <div
      style={{
        ...ROW_LINK_ABOVE,
        display: "flex",
        alignItems: "baseline",
        gap: "1.25rem",
        marginTop: "0.35rem",
        flexWrap: "wrap",
        fontSize: "0.75rem",
      }}
    >
      {items.map((it) => (
        <Tooltip key={it.key} content={it.hint}>
          <span style={{ whiteSpace: "nowrap" }}>
            <span style={FIGURE_LABEL}>{it.label} </span>
            <span style={FIGURE_VALUE}>{it.value}</span>
            {it.note && <span style={FIGURE_LABEL}> ({it.note})</span>}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}
