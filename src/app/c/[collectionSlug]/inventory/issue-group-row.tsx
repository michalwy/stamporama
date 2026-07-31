"use client";

import { useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { IssueGroupRow as IssueGroupRowData } from "@/lib/items";
import { NO_ISSUE } from "@/lib/issue-groups";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { InventoryCopyList, type CopySelection } from "./inventory-copy-list";
import { CopyGroupShell, useGroupMembers } from "./copy-group-shell";
import type { InventoryItemFilters } from "./use-inventory-query";

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
 * One issue group on the Copies list (#424): a series collapsed to a single row over the copies
 * held of it.
 *
 * As plain as a filing row (#421), and for the same reason: an issue is a *subject*, so the row
 * names it and says how many copies are under it. Which stamps those are is precisely the question
 * the member rows answer, and a summary of them here would be a second, shakier answer to it. The
 * year is stated apart from the name rather than folded into the label, since a series is routinely
 * looked up by it.
 */
export function IssueGroupRow({
  collectionId,
  group,
  baseFilters,
  areas,
  locations,
  baseCurrency,
  isLast,
  selection,
}: {
  collectionId: string;
  group: IssueGroupRowData;
  /** The panel's own filters — the members narrow by these *plus* the group's issue, so an expanded
   * group can never show a copy the count did not include. */
  baseFilters: InventoryItemFilters;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  isLast: boolean;
  selection: CopySelection;
}) {
  const [open, setOpen] = useState(false);

  const memberFilters = issueGroupMemberFilters(group, baseFilters);
  const {
    members,
    membersLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    allSelected,
    partiallySelected,
    setAllSelected,
  } = useGroupMembers({
    collectionId,
    memberFilters,
    selection,
    wanted: open,
    onWant: () => setOpen(true),
  });

  const named = group.issueId !== null;

  return (
    <CopyGroupShell
      open={open}
      onToggle={() => setOpen((o) => !o)}
      isLast={isLast}
      selectAll={{
        checked: allSelected,
        partial: partiallySelected,
        onChange: setAllSelected,
        label: "Select every copy of this issue that can be listed — for sale and in hand",
      }}
      header={
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <Tooltip
            content={`${group.count} cop${group.count === 1 ? "y" : "ies"} of this issue, of the ones this list is showing`}
          >
            <span style={COUNT_CHIP}>×{group.count}</span>
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
            <span style={MUTED}>— these copies&rsquo; stamps do not belong to an issue</span>
          )}
        </div>
      }
    >
      {membersLoading ? (
        <p style={{ padding: "1rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Loading copies…
        </p>
      ) : (
        <InventoryCopyList
          collectionId={collectionId}
          copies={members}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={fetchNextPage}
          readOnly
          selection={selection}
        />
      )}
    </CopyGroupShell>
  );
}

/**
 * The filters addressing one issue group's members: the panel's own filters plus the group's issue.
 * `NO_ISSUE` does the work an absent filter cannot — "belongs to no series" is a value on this axis,
 * not the lack of a question — exactly as the filing groups' `NO_LOCATION` does (#421).
 */
export function issueGroupMemberFilters(
  group: IssueGroupRowData,
  baseFilters: InventoryItemFilters
): InventoryItemFilters {
  return { ...baseFilters, issueId: group.issueId ?? NO_ISSUE };
}
