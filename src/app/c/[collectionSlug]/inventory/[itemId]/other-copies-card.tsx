"use client";

import { useMemo } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { CarriedStamp } from "@/lib/items";
import { formatStampCN } from "@/lib/area-vendor";
import { countShown, holdingStateChips, type HoldingState } from "@/lib/copy-card-states";
import { otherCopiesFilters } from "@/lib/other-copies-rules";
import type { LocationData } from "@/lib/locations";
import { DetailCard } from "@/app/c/[collectionSlug]/shared/detail-page";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import {
  useInventoryItemsInfinite,
  useCollectionLocations,
  useCopyHoldingCountsMany,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { InventoryCopyList } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import {
  HiddenCopies,
  HoldingStateChips,
  useShownHoldingStates,
} from "@/app/c/[collectionSlug]/inventory/related-copies-card";

// The copy page's *Other copies* card (#2090, #2282): which one is the better keeper, whether this
// one is a duplicate for sale, what an earlier copy cost and fetched — answered without the trip to
// the stamp's page. Built as that page's Copies card is (`RelatedCopiesCard`): the same read-only
// rows, each opening its copy and naming its stamp, so a variant's row says which variant it is; the
// same state chips (#2281), sharing one remembered choice with it.
//
// The copies are **the stamp's whole family's** — the umbrella's and every variant's
// (`loadStampFamilies`) — less this one, held as the stamp page counts them (`otherCopiesFilters`).
// A cover or fragment gets one group per stamp it carries (#744), each named by its stamp. A card
// with no other copy is not drawn (#536); one whose chips hide them all says how many are hidden.

/** One group of the card: a stamp the copy is of, and the stamps of that stamp's family. */
export interface OtherCopiesGroup {
  /** The stamp the group is named by — on a cover or fragment, one it carries; `null` for an
   *  ordinary copy, whose one group needs no name. */
  stamp: CarriedStamp | null;
  familyStampIds: string[];
}

const GROUP_HEADING: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
};

export function OtherCopiesCard({
  collectionId,
  areas,
  baseCurrency,
  itemId,
  groups,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  /** The copy whose page this is — never one of its own other copies. */
  itemId: string;
  groups: OtherCopiesGroup[];
}) {
  const [shown, toggle] = useShownHoldingStates(collectionId);
  const baseFilters = useMemo(
    () => groups.map((g) => otherCopiesFilters(g.familyStampIds, itemId)),
    [groups, itemId]
  );
  const counts = useCopyHoldingCountsMany(collectionId, baseFilters);
  const chips = holdingStateChips(...counts.map((q) => q.data));
  const inViewByGroup = counts.map((q) => countShown(q.data, shown));
  const inView = inViewByGroup.reduce((sum, n) => sum + n, 0);
  const { data: locations = [] } = useCollectionLocations(collectionId);
  const vendorMaps = useAreaVendorMaps(areas, collectionId);

  return (
    <DetailCard
      title="Other copies"
      count={inView}
      empty={counts.some((q) => q.isLoading) || chips.length === 0}
    >
      <HoldingStateChips chips={chips} shown={shown} onToggle={toggle} />
      {inView === 0 ? (
        <HiddenCopies chips={chips} shown={shown} />
      ) : (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            overflow: "clip",
            background: "var(--color-bg-elevated)",
          }}
        >
          {groups.map((group, idx) =>
            inViewByGroup[idx] > 0 ? (
              <OtherCopiesGroupList
                key={group.stamp?.stampId ?? "copy"}
                collectionId={collectionId}
                areas={areas}
                locations={locations}
                baseCurrency={baseCurrency}
                familyStampIds={group.familyStampIds}
                itemId={itemId}
                shown={shown}
                heading={group.stamp ? stampHeading(group.stamp, vendorMaps) : null}
                first={idx === inViewByGroup.findIndex((n) => n > 0)}
              />
            ) : null
          )}
        </div>
      )}
    </DetailCard>
  );
}

/** One group's rows, its own list so a cover's groups page independently. */
function OtherCopiesGroupList({
  collectionId,
  areas,
  locations,
  baseCurrency,
  familyStampIds,
  itemId,
  shown,
  heading,
  first,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  familyStampIds: string[];
  itemId: string;
  shown: HoldingState[];
  heading: string | null;
  first: boolean;
}) {
  const filters = useMemo(
    () => otherCopiesFilters(familyStampIds, itemId, shown),
    [familyStampIds, itemId, shown]
  );
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useInventoryItemsInfinite(
    collectionId,
    filters
  );
  const copies = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  return (
    <>
      {heading && (
        <div
          style={{
            ...GROUP_HEADING,
            borderTop: first ? undefined : "1px solid var(--color-border)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {heading}
        </div>
      )}
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
    </>
  );
}

/** A carried stamp's name for its group: its primary catalogue number and its name, as the row's own
 *  *Several stamps* line names it. */
function stampHeading(
  stamp: CarriedStamp,
  { primaryVendorByArea, vendorMapFor }: ReturnType<typeof useAreaVendorMaps>
): string {
  const primaryVendorId = stamp.areaId ? primaryVendorByArea.get(stamp.areaId) : undefined;
  const number =
    stamp.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ??
    stamp.catalogNumbers[0] ??
    null;
  const label = number
    ? formatStampCN(number.number, vendorMapFor(stamp.areaId, stamp.issueId).get(number.catalogVendorId))
    : null;
  return [label, stamp.stampName].filter(Boolean).join(" — ") || "(stamp)";
}
