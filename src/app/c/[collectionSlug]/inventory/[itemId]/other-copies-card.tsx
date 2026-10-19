"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { otherCopiesFilters } from "@/lib/other-copies-rules";
import { DetailCard } from "@/app/c/[collectionSlug]/shared/detail-page";
import { useRecordHref } from "@/app/c/[collectionSlug]/shared/use-record-href";
import {
  useInventoryItemsInfinite,
  useCollectionLocations,
  type InventoryItemFilters,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { InventoryCopyList } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";

// The copy page's *Other copies of this stamp* card (#2090): which one is the better keeper, whether
// this one is a duplicate for sale — answered without the trip to the stamp's page. Built as that
// page's Copies card is (`RelatedCopiesCard`): the same read-only rows, each opening its copy's page.
//
// The copies are **the ones the stamp page counts** (`otherCopiesFilters`), less this one. The
// variants' copies are held of other stamps, so they are counted under the card and left to the
// stamp's page, where they are listed under each variant. A card with no other copy is not drawn
// (#536), whatever the variants hold.

export function OtherCopiesCard({
  collectionId,
  areas,
  baseCurrency,
  itemId,
  stampId,
  variantCopies,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  /** The copy whose page this is — never one of its own other copies. */
  itemId: string;
  stampId: string;
  /** Held copies of the stamp's variants (#528), counted the way the stamp page counts them. */
  variantCopies: number;
}) {
  const filters: InventoryItemFilters = useMemo(() => otherCopiesFilters(stampId), [stampId]);
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useInventoryItemsInfinite(collectionId, filters);
  const { data: locations = [] } = useCollectionLocations(collectionId);
  const copies = useMemo(
    () => data?.pages.flatMap((p) => p.items).filter((c) => c.id !== itemId) ?? [],
    [data, itemId]
  );
  const stampHref = useRecordHref("stamp", stampId);

  return (
    <DetailCard
      title="Other copies of this stamp"
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
      {variantCopies > 0 && (
        <p style={{ margin: "0.375rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          {variantCopies === 1 ? "1 more copy is" : `${variantCopies} more copies are`} of this
          stamp&rsquo;s variants — on{" "}
          <Link href={stampHref} style={{ color: "var(--color-accent)", textDecoration: "none" }}>
            the stamp&rsquo;s page
          </Link>
          .
        </p>
      )}
    </DetailCard>
  );
}
