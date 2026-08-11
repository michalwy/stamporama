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
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useInventoryItemsInfinite(collectionId, filters);
  const { data: locations = [] } = useCollectionLocations(collectionId);
  const copies = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  return (
    <DetailCard
      title="Copies"
      count={copies.length + (hasNextPage ? "+" : "")}
      empty={isLoading || copies.length === 0}
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
      </div>
    </DetailCard>
  );
}
