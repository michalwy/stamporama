"use client";

import { useState } from "react";
import type { AreaCatalogEntry } from "@/lib/areas";
import { NO_ISSUE } from "@/lib/issue-groups";
import type { WantIssueGroupRow as WantIssueGroupRowData, WantListItem } from "@/lib/wants";
import { CopyGroupShell } from "@/app/c/[collectionSlug]/inventory/copy-group-shell";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { WantRow, type WantDictionaries } from "./want-row";
import { useWantsInfinite, type WantListFilters } from "./use-wants-query";

const COUNT_CHIP: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-accent)",
  background: "var(--color-accent-soft)",
  border: "1px solid var(--color-accent)",
  borderRadius: "0.375rem",
  padding: "0.125rem 0.5rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/**
 * The filters addressing one group's members: the screen's own, plus the group's issue. `NO_ISSUE`
 * does the work an absent filter cannot — "belongs to no series" is a value on this axis, not the
 * lack of a question — exactly as inventory's issue groups have it (#424).
 */
export function wantIssueGroupMemberFilters(
  group: WantIssueGroupRowData,
  baseFilters: WantListFilters
): WantListFilters {
  return { ...baseFilters, issueId: group.issueId ?? NO_ISSUE };
}

/**
 * One series on the want list (#532) — its wants collapsed to a single row.
 *
 * The row's figure is **`open / total`**: how much of this set is still being looked for, over how
 * much was ever wanted of it. That is *want* completeness and is deliberately not the issue's own
 * completeness grid (ADR-0031), which counts copies **held**. Two different questions, and this row
 * answers only the one the want list is for.
 *
 * As plain as inventory's issue row otherwise, and for its reason: an issue is a *subject*, so the
 * row names it and counts what sits under it. What those wants actually accept is precisely the
 * question the member rows answer, and a summary of it here would be a second, shakier answer —
 * worse than on copies, because a want's terms genuinely differ from stamp to stamp within one set.
 */
export function WantIssueGroupRow({
  collectionId,
  group,
  baseFilters,
  dictionaries,
  vendorMapFor,
  primaryVendorByArea,
  isLast,
  onEdit,
  onClose,
  onReopen,
  onDelete,
}: {
  collectionId: string;
  group: WantIssueGroupRowData;
  /** The screen's own filters — the members narrow by these *plus* the group's issue, so an
   *  expanded group can never show a want the count did not include. */
  baseFilters: WantListFilters;
  dictionaries: WantDictionaries;
  vendorMapFor: (areaId: string | null, issueId: string | null) => Map<string, AreaCatalogEntry>;
  primaryVendorByArea: Map<string, string | null>;
  isLast: boolean;
  onEdit: (want: WantListItem) => void;
  onClose: (want: WantListItem) => void;
  onReopen: (want: WantListItem) => void;
  onDelete: (want: WantListItem) => void;
}) {
  const [open, setOpen] = useState(false);

  // Fetched only once the row is opened, and kept afterwards: a collector opens a handful of series
  // out of a long list, and loading every group's members up front is the whole cost this view
  // exists to avoid.
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useWantsInfinite(
    collectionId,
    wantIssueGroupMemberFilters(group, baseFilters),
    open
  );
  const members = (data?.pages ?? []).flatMap((p) => p.items);
  const named = group.issueId !== null;

  return (
    <CopyGroupShell
      open={open}
      onToggle={() => setOpen((o) => !o)}
      isLast={isLast}
      header={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
            paddingLeft: "1rem",
          }}
        >
          <Tooltip
            content={`${group.openCount} of ${group.totalCount} want${group.totalCount === 1 ? "" : "s"} recorded for this issue ${group.openCount === 1 ? "is" : "are"} still open. Closed wants stay in the total, which is what makes the fraction mean the same thing whichever side of the Open / Closed toggle you read it from.`}
          >
            <span style={COUNT_CHIP}>
              {group.openCount}/{group.totalCount}
            </span>
          </Tooltip>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: named ? "var(--color-text-primary)" : "var(--color-text-muted)",
              fontStyle: named ? undefined : "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {named ? (group.issueName?.trim() || "Untitled issue") : "No issue"}
          </span>
          {named && group.issueYear != null && <span style={MUTED}>{group.issueYear}</span>}
          {!named && (
            <span style={MUTED}>— these wants&rsquo; stamps do not belong to an issue</span>
          )}
        </div>
      }
    >
      {isLoading ? (
        <p style={{ padding: "1rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Loading wants…
        </p>
      ) : (
        <>
          {members.map((w, idx) => (
            <WantRow
              key={w.id}
              want={w}
              collectionId={collectionId}
              dictionaries={dictionaries}
              vendorMap={vendorMapFor(w.areaId, w.issueId)}
              primaryVendorId={w.areaId ? (primaryVendorByArea.get(w.areaId) ?? null) : null}
              isLast={idx === members.length - 1 && !hasNextPage}
              onEdit={onEdit}
              onClose={onClose}
              onReopen={onReopen}
              onDelete={onDelete}
            />
          ))}
          <InfiniteScrollSentinel
            onLoadMore={fetchNextPage}
            hasMore={!!hasNextPage}
            isLoading={isFetchingNextPage}
          />
        </>
      )}
    </CopyGroupShell>
  );
}
