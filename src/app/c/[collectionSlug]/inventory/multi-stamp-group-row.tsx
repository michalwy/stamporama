"use client";

import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { MultiStampGroupRow as MultiStampGroupRowData } from "@/lib/multi-stamp";
import { GROUP_COUNT_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  InventoryCopyList,
  type CopyRowActions,
  type CopySelection,
} from "./inventory-copy-list";
import { CopyGroupShell, useGroupMembers } from "./copy-group-shell";
import type { InventoryItemFilters } from "./use-inventory-query";

const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/**
 * The multi-stamp bucket of a grouped Copies list (#748; ADR-0044 §7).
 *
 * Duplicate groups are keyed on a stamp and issue groups on a stamp's series, so either would file a
 * carrier **under its leading stamp** — the one claim ADR-0044 §3 removes. The carriers are collected
 * here instead, as the last row, the way `No issue` closes the issue grouping: a bucket is the absence
 * of the subject the other rows are about, not a thin edge of it.
 *
 * As plain as the issue-less row, and for its reason: the bucket is no stamp, no series and no
 * place, so all it can honestly say is how many. Its members are ordinary copy rows, each naming
 * every stamp it carries, with the ordinary checkboxes and `⋮` menu — a carrier stays a copy for
 * everything the list does.
 */
export function MultiStampGroupRow({
  collectionId,
  group,
  baseFilters,
  areas,
  locations,
  baseCurrency,
  isLast,
  open,
  onToggle,
  selection,
  rowActions,
}: {
  collectionId: string;
  group: MultiStampGroupRowData;
  /** The panel's own filters — the members narrow by these *plus* `only`, so an expanded bucket can
   *  never show a copy the count did not include. */
  baseFilters: InventoryItemFilters;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  isLast: boolean;
  /** Owned by the panel (#538), so Expand all / Collapse all speaks for this row too. */
  open: boolean;
  onToggle: () => void;
  selection: CopySelection;
  /** The member rows' own `⋮` menu (#125/#516) — the very actions the ungrouped list offers. */
  rowActions?: CopyRowActions;
}) {
  const memberFilters = multiStampGroupMemberFilters(baseFilters);
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
    onWant: () => {
      if (!open) onToggle();
    },
  });

  return (
    <CopyGroupShell
      open={open}
      onToggle={onToggle}
      isLast={isLast}
      selectAll={{
        checked: allSelected,
        partial: partiallySelected,
        onChange: setAllSelected,
        label: "Select every piece carrying several stamps that you still hold",
      }}
      header={
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <Tooltip
            content={`${group.count} piece${group.count === 1 ? "" : "s"} carrying several stamps, of the ones this list is showing`}
          >
            <span style={GROUP_COUNT_CHIP}>×{group.count}</span>
          </Tooltip>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-muted)",
              fontStyle: "italic",
              whiteSpace: "nowrap",
            }}
          >
            Several stamps
          </span>
          <span style={MUTED}>
            — covers and pieces carrying more than one stamp, filed under none of them
          </span>
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
          {...rowActions}
          selection={selection}
        />
      )}
    </CopyGroupShell>
  );
}

/** The filters addressing the bucket's members: the panel's own plus `only`. Replacing the panel's
 *  own multi-stamp choice rather than intersecting with it is safe, because the bucket exists only
 *  when that choice lets carriers through at all. */
export function multiStampGroupMemberFilters(
  baseFilters: InventoryItemFilters
): InventoryItemFilters {
  return { ...baseFilters, multiStamp: "only" };
}
