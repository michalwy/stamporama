"use client";

import { useMemo } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { useInventoryItemsInfinite, type InventoryItemFilters } from "./use-inventory-query";
import { InventoryCopyList, type CopyRowActions } from "./inventory-copy-list";

// The copies that **might be** this stamp, or might belong to this issue (#1651, ADR-0065 §8):
// identified as one of several stamps across variant trees, so certainly none of them. They are
// listed under each candidate's stamp and issue as *possibly this copy*, apart from the copies that
// certainly are, under a heading that says so — never mixed into the list a count was taken over.

/** The heading over a *possibly* list — shared, so the issue group and the detail card read alike. */
export const POSSIBLE_HEADING: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderTop: "1px solid var(--color-border)",
  background: "var(--color-bg-page)",
};

export function PossibleCopiesList({
  collectionId,
  filters,
  enabled = true,
  heading,
  areas,
  locations,
  baseCurrency,
  readOnly,
  rowActions,
}: {
  collectionId: string;
  /** The filters naming what the copies might be — `possibleStampId` or `possibleIssueId`. */
  filters: InventoryItemFilters;
  enabled?: boolean;
  heading: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  readOnly?: boolean;
  rowActions?: CopyRowActions;
}) {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useInventoryItemsInfinite(
    collectionId,
    filters,
    enabled
  );
  const copies = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  if (copies.length === 0) return null;
  return (
    <div>
      <div style={POSSIBLE_HEADING}>{heading}</div>
      <InventoryCopyList
        collectionId={collectionId}
        copies={copies}
        areas={areas}
        locations={locations}
        baseCurrency={baseCurrency}
        hasNextPage={!!hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={fetchNextPage}
        readOnly={readOnly}
        {...rowActions}
      />
    </div>
  );
}
