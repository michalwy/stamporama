"use client";

import { useMemo } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { DetailCard } from "@/app/c/[collectionSlug]/shared/detail-page";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import type { TagColorTokens } from "@/lib/tag-colors";
import {
  countShown,
  hiddenCopiesText,
  holdingStateChips,
  HOLDING_STATE_LABEL,
  parseShownHoldingStates,
  toggleShownHoldingState,
  writeShownHoldingStates,
  type HoldingState,
} from "@/lib/copy-card-states";
import {
  useInventoryItemsInfinite,
  useCollectionLocations,
  useCopyHoldingCounts,
  type InventoryItemFilters,
} from "./use-inventory-query";
import { InventoryCopyList } from "./inventory-copy-list";
import { POSSIBLE_HEADING } from "./possible-copies-list";

// The Copies card of a detail screen (#518/#519): the same rows the read-only copies popup (#110)
// shows, inline, filtered by holding-state chips (#2281) so the copies that have left — sold, traded
// away, written off — can be brought back to say where they went. Read-only for the popup's reason — the copy is managed on the Copies list, and a
// second place to edit one is a second place to keep honest.

export type RelatedCopiesTarget =
  | { kind: "stamp"; stampId: string }
  | { kind: "issue"; issueId: string };

/** Where the state chips' choice is remembered — one key for the card on the stamp's and the
 * issue's page (#2281). */
const COPY_CARD_STATES_KEY = "copy-card-states";

/** The chips' tints: held is the card's ordinary state, gone the row's *Sold* colour, written off
 * its *No longer held* one. */
const STATE_TINT: Record<HoldingState, TagColorTokens | undefined> = {
  held: undefined,
  gone: {
    color: "var(--color-success)",
    border: "var(--color-success-border)",
    background: "var(--color-success-soft)",
  },
  disposed: {
    color: "var(--color-error)",
    border: "var(--color-error-border)",
    background: "var(--color-error-soft)",
  },
};

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
  // The state chips (#2281): held, sold & traded, written off — only Held on until switched.
  const [stored, setStored] = usePersistedCollectionValue(COPY_CARD_STATES_KEY, collectionId);
  const shown = useMemo(() => parseShownHoldingStates(stored), [stored]);

  const baseFilters: InventoryItemFilters = useMemo(
    () => (target.kind === "stamp" ? { stampId: target.stampId } : { issueId: target.issueId }),
    [target]
  );
  const basePossibleFilters: InventoryItemFilters = useMemo(
    () =>
      target.kind === "stamp"
        ? { possibleStampId: target.stampId }
        : { possibleIssueId: target.issueId },
    [target]
  );
  const counts = useCopyHoldingCounts(collectionId, baseFilters);
  const possibleCounts = useCopyHoldingCounts(collectionId, basePossibleFilters);
  const chips = useMemo(
    () => holdingStateChips(counts.data, possibleCounts.data),
    [counts.data, possibleCounts.data]
  );
  const inView = countShown(counts.data, shown);
  const possibleInView = countShown(possibleCounts.data, shown);

  const filters = useMemo(() => ({ ...baseFilters, holdingStates: shown }), [baseFilters, shown]);
  const possibleFilters = useMemo(
    () => ({ ...basePossibleFilters, holdingStates: shown }),
    [basePossibleFilters, shown]
  );
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useInventoryItemsInfinite(
    collectionId,
    filters,
    inView > 0
  );
  const { data: locations = [] } = useCollectionLocations(collectionId);
  const copies = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const possible = useInventoryItemsInfinite(collectionId, possibleFilters, possibleInView > 0);
  const possibleCopies = useMemo(
    () => possible.data?.pages.flatMap((p) => p.items) ?? [],
    [possible.data]
  );

  return (
    <DetailCard
      title="Copies"
      // The copies in view (#2281) — the possible ones are apart, never counted (#1651).
      count={inView}
      empty={counts.isLoading || possibleCounts.isLoading || chips.length === 0}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginBottom: "0.75rem" }}>
        {chips.map(({ state, count }) => (
          <FilterChip
            key={state}
            label={HOLDING_STATE_LABEL[state]}
            count={count}
            active={shown.includes(state)}
            toggle
            tint={STATE_TINT[state]}
            onClick={() =>
              setStored(writeShownHoldingStates(toggleShownHoldingState(shown, state)))
            }
          />
        ))}
      </div>
      {inView === 0 && possibleInView === 0 ? (
        <div style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
          {hiddenCopiesText(chips, shown)}
        </div>
      ) : (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            overflow: "clip",
            background: "var(--color-bg-elevated)",
          }}
        >
          {inView > 0 && (
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
          )}
          {/* The copies that might be this stamp, or of this issue (#1651) — apart, never counted
              above: one of several stamps across variant trees is certainly none of them. The
              chips apply to them too (#2281). */}
          {possibleInView > 0 && (
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
      )}
    </DetailCard>
  );
}
