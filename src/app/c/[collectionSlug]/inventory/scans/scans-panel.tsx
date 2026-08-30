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
  scanSheetCount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const { invalidateScans } = useInvalidateScans();
  const { invalidateList: invalidateInventory } = useInvalidateInventory();
  const tileChain = useTileIdentifyChain({ collectionId, conditions, setError });

  /**
   * The screen's runner — the two things that follow a copy being created here.
   *
   * Fewer than the order screen's: there are no lot pages to re-read, no purchase list to refresh
   * and no cost to have moved. What is left is the header counts, which are server-rendered
   * (`router.refresh()`), and the catalogue side (`invalidateInventory`) — the copies-held badge and
   * want marker on every picker row, and the stamp thumbnail a tile's front may have just become
   * (#149's auto-seed, reached from this path too).
   *
   * **No want review** (#532). It is raised where a copy *arrives* — an order taken in against a
   * list of what was wanted — and material already on the shelf being catalogued is not an arrival:
   * offering to close a want because a stamp that has been in the album for years was finally typed
   * in would be reading the list backwards. `identifyTilesAction` raises none either, so this is the
   * two ends agreeing rather than the screen declining to draw one.
   */
  function run(
    fn: () => Promise<{ status: string; message?: string }>,
    onDone?: (result: { status: string; message?: string }) => void
  ) {
    setError(undefined);
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        router.refresh();
        invalidateInventory(collectionId);
        onDone?.(result);
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
        scanSheetCount={scanSheetCount}
        // Always. There is no lot whose closing could have frozen anything here.
        canIdentify
        onIdentifyTiles={tileChain.onIdentifyTiles}
        onReidentifyTile={tileChain.onReidentifyTile}
        repeatLast={tileChain.repeatLast}
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
    </>
  );
}
