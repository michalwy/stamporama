"use client";

import { useMemo } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { DetailCard } from "@/app/c/[collectionSlug]/shared/detail-page";
import {
  useInventoryItemsInfinite,
  useCollectionLocations,
  type InventoryItemFilters,
} from "./use-inventory-query";
import { InventoryCopyList } from "./inventory-copy-list";
import { POSSIBLE_HEADING } from "./possible-copies-list";

// The Copies card of a detail screen (#518/#519): the same rows the read-only copies popup (#110)
// shows, inline. Read-only for the popup's reason — the copy is managed on the Copies list, and a
// second place to edit one is a second place to keep honest.

export type RelatedCopiesTarget =
  | { kind: "stamp"; stampId: string }
  | { kind: "issue"; issueId: string };

export function RelatedCopiesCard({
  collectionId,
  areas,
  baseCurrency,
  target,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  target: RelatedCopiesTarget;
}) {
  const filters: InventoryItemFilters = useMemo(
    () => (target.kind === "stamp" ? { stampId: target.stampId } : { issueId: target.issueId }),
    [target]
  );
  const possibleFilters: InventoryItemFilters = useMemo(
    () =>
      target.kind === "stamp"
        ? { possibleStampId: target.stampId }
        : { possibleIssueId: target.issueId },
    [target]
  );
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useInventoryItemsInfinite(collectionId, filters);
  const { data: locations = [] } = useCollectionLocations(collectionId);
  const copies = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const possible = useInventoryItemsInfinite(collectionId, possibleFilters);
  const possibleCopies = useMemo(
    () => possible.data?.pages.flatMap((p) => p.items) ?? [],
    [possible.data]
  );

  return (
    <DetailCard
      title="Copies"
      count={copies.length + (hasNextPage ? "+" : "")}
      empty={isLoading || (copies.length === 0 && possibleCopies.length === 0)}
    >
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.5rem",
          overflow: "clip",
          background: "var(--color-bg-elevated)",
        }}
      >
        <InventoryCopyList
          collectionId={collectionId}
          copies={copies}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          hasNextPage={!!hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={fetchNextPage}
          readOnly
        />
        {/* The copies that might be this stamp, or of this issue (#1651) — apart, never counted
            above: one of several stamps across variant trees is certainly none of them. */}
        {possibleCopies.length > 0 && (
          <>
            <div style={POSSIBLE_HEADING}>
              {target.kind === "stamp" ? "Possibly this stamp" : "Possibly of this issue"}
            </div>
            <InventoryCopyList
              collectionId={collectionId}
              copies={possibleCopies}
              areas={areas}
              locations={locations}
              baseCurrency={baseCurrency}
              hasNextPage={!!possible.hasNextPage}
              isFetchingNextPage={possible.isFetchingNextPage}
              onLoadMore={possible.fetchNextPage}
              readOnly
            />
          </>
        )}
      </div>
    </DetailCard>
  );
}
