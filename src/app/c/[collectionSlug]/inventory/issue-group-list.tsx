"use client";

import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type {
  IssueGroupCompleteness,
  IssueGroupRow as IssueGroupRowData,
} from "@/lib/items";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { IssueGroupRow } from "./issue-group-row";
import type { CopyRowActions, CopySelection } from "./inventory-copy-list";
import type { InventoryItemFilters } from "./use-inventory-query";
import type { GroupExpansion } from "@/app/c/[collectionSlug]/shared/use-group-expansion";

/**
 * The Copies list grouped by issue (#424) — one row per series — plus the infinite-scroll sentinel.
 * The caller owns the container and the loading / empty states, exactly as with
 * `DuplicateGroupList` and `LocationGroupList`.
 */
export function IssueGroupList({
  collectionId,
  groups,
  baseFilters,
  areas,
  locations,
  baseCurrency,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  expansion,
  selection,
  rowActions,
  completeness,
}: {
  collectionId: string;
  groups: IssueGroupRowData[];
  baseFilters: InventoryItemFilters;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  /** Which group rows are open (#538) — panel state, so one control operates the whole list. */
  expansion: GroupExpansion;
  selection: CopySelection;
  /** The member rows' own `⋮` menu (#125/#516), threaded down to every group's copies: a
   * grouping decides what a row is listed *under*, never what may be done to it. */
  rowActions?: CopyRowActions;
  /** Per-checklist, per-condition completeness keyed by issue id (#594) — read for the whole page
   * of groups at once, absent while it is still loading. */
  completeness?: IssueGroupCompleteness;
}) {
  return (
    <>
      {groups.map((group, idx) => (
        <IssueGroupRow
          key={group.key}
          collectionId={collectionId}
          group={group}
          baseFilters={baseFilters}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          isLast={idx === groups.length - 1 && !hasNextPage}
          open={expansion.isExpanded(group.key)}
          onToggle={() => expansion.toggle(group.key)}
          selection={selection}
          rowActions={rowActions}
          completeness={group.issueId ? completeness?.[group.issueId] : undefined}
        />
      ))}
      <InfiniteScrollSentinel
        onLoadMore={onLoadMore}
        hasMore={hasNextPage}
        isLoading={isFetchingNextPage}
      />
    </>
  );
}
