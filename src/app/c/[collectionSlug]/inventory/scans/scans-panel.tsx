"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CollectionAreaData } from "@/lib/areas";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampConditionData } from "@/lib/conditions";
import type { LocationData } from "@/lib/locations";
import { ScansCard } from "@/app/c/[collectionSlug]/shared/scans-card";
import {
  TileIdentifyChainDialogs,
  useTileIdentifyChain,
} from "@/app/c/[collectionSlug]/shared/tile-identify-chain";
import { useInvalidateScans } from "@/app/c/[collectionSlug]/shared/use-scans-query";
import { useInvalidateInventory } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { WantReviewDialog } from "@/app/c/[collectionSlug]/wants/want-review-dialog";
import type { ArrivingCopy } from "@/lib/want-rules";
import type { WantMatchForCopy } from "@/lib/wants";

/**
 * Card scans that belong to **no order** (#725) — a stockbook already owned, a gift, an
 * inheritance: material to be catalogued rather than bought.
 *
 * It is the purchase screen's Card scans section, on its own page and with the order taken out.
 * Everything is the same component and the same server verbs; what differs is exactly two things,
 * and both are absences.
 *
 * **No lot, so no lot question.** A copy identified here takes a null `lotId` and therefore a null
 * cost basis, which is what `Item.lotId` being nullable has always meant and what *Add copy* has
 * always written. The condition step's `lotChoice` is left off, which is the shape it already had
 * for the stockbook purchase with one lot.
 *
 * **No lots to be open, so nothing to close identification off.** `canIdentify` is what an order
 * uses to say *every lot here is closed and takes no new copy*; there is no pool to have been split
 * and no money to have been frozen, so it is always true.
 *
 * The assign path stays, widened to the collection (`ScanOwner`): while digitising a shelf most
 * pieces are already recorded and want photographs rather than identification, which is the same
 * case a settled auction's card is, one level up.
 */
export function ScansPanel({
  collectionId,
  areas,
  scanDpi,
  conditions,
  certificateStatuses,
  locations,
  unidentifiedTileCount,
  parkedTileCount,
  discardedTileCount,
  scanSheetCount,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  scanDpi: number;
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  locations: LocationData[];
  unidentifiedTileCount: number;
  parkedTileCount: number;
  discardedTileCount: number;
  scanSheetCount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const { invalidateScans } = useInvalidateScans();
  const { invalidateList: invalidateInventory } = useInvalidateInventory();
  const tileChain = useTileIdentifyChain({ setError });
  // The open wants the copies just identified could satisfy (#1262) — see `run`.
  const [wantReview, setWantReview] = useState<{
    copies: ArrivingCopy[];
    matches: WantMatchForCopy[];
  } | null>(null);

  /**
   * The screen's runner — the two things that follow a copy being created here.
   *
   * Fewer than the order screen's: there are no lot pages to re-read, no purchase list to refresh
   * and no cost to have moved. What is left is the header counts, which are server-rendered
   * (`router.refresh()`), and the catalogue side (`invalidateInventory`) — the copies-held badge and
   * want marker on every picker row, and the stamp thumbnail a tile's front may have just become
   * (#149's auto-seed, reached from this path too).
   *
   * **And the want review** (#532, #1262), after every pass that created copies — one tile, several
   * as one stamp (#596), a run (#1220). The review belongs to the moment a copy reaches the
   * collector's hands (ADR-0032 §6b), and a copy identified here is created `delivered`: the piece is
   * on the desk under the scanner, exactly as a copy added by hand is. It was once left out on the
   * reading that cataloguing a shelf is not an arrival, and the want then stayed open beside the copy
   * that answered it, with nothing saying so — the collector found wants for stamps already held.
   *
   * Raised from `outcomes`, the field the order screen's runner deliberately does not read (its tile
   * copies are `ordered` or `to_sort` and reviewed when stored), after the chain has closed, and only
   * when something matches — a review with nothing in it is not worth a click.
   */
  function run(
    fn: () => Promise<{ status: string; message?: string; outcomes?: ArrivingCopy[] }>,
    onDone?: (result: { status: string; message?: string }) => void
  ) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        router.refresh();
        invalidateInventory(collectionId);
        onDone?.(result);
        if (result.outcomes?.length) {
          const copies = result.outcomes;
          const { findWantsSatisfiedByAction } = await import("@/app/actions/wants");
          const matches = await findWantsSatisfiedByAction(collectionId, copies);
          if (matches.length > 0) setWantReview({ copies, matches });
        }
      } else if (result.status === "error") {
        setError(result.message);
      }
    });
  }

  return (
    <>
      {error && (
        <p
          role="alert"
          style={{
            margin: "0 0 1rem",
            fontSize: "0.8125rem",
            color: "var(--color-error)",
          }}
        >
          {error}
        </p>
      )}

      <ScansCard
        collectionId={collectionId}
        areas={areas}
        scanDpi={scanDpi}
        owner={{ kind: "collection" }}
        // The page is the section, so there is nothing for it to be collapsed beside.
        alwaysOpen
        unidentifiedTileCount={unidentifiedTileCount}
        parkedTileCount={parkedTileCount}
        discardedTileCount={discardedTileCount}
        scanSheetCount={scanSheetCount}
        // Always. There is no lot whose closing could have frozen anything here.
        canIdentify
        onIdentifyTiles={tileChain.onIdentifyTiles}
        onReidentifyTile={tileChain.onReidentifyTile}
        onIdentifyIssueRun={tileChain.onIdentifyIssueRun}
        onRepeatIdentification={tileChain.onRepeatIdentification}
        onChanged={() => router.refresh()}
      />

      <TileIdentifyChainDialogs
        chain={tileChain}
        collectionId={collectionId}
        areas={areas}
        scanDpi={scanDpi}
        conditions={conditions}
        certificateStatuses={certificateStatuses}
        locations={locations}
        isPending={isPending}
        error={error}
        setError={setError}
        // No `lotChoice`: there is no lot, and absent is what the step already means by *the lot is
        // not in question*.
        run={run}
        onIdentified={() => void invalidateScans(collectionId)}
      />

      {/* Closes nothing on its own (#532): close, narrow or leave open, per want. */}
      {wantReview && (
        <WantReviewDialog
          collectionId={collectionId}
          copies={wantReview.copies}
          matches={wantReview.matches}
          onClose={() => setWantReview(null)}
        />
      )}
    </>
  );
}
