import "server-only";
import { prisma } from "./db";
import { getItemStamps, type ItemStampSummary } from "./items";
import {
  COPY_VALUATION_SELECT,
  copyValuationOf,
  valuateItemRows,
  type ValuationRow,
} from "./item-valuation";
import { getCollectionBaseCurrency } from "./pricing";
import { pieceCopyOf, type DraftPieceEntry } from "./carrier-value";
import { assertCollectionOwner } from "./platform-category";
import { DEFAULT_FRANKING, type Franking, type ValuationMethod } from "./piece-valuation";
import type { CopyValuation } from "./valuation";
import type { TypedPiecePrice } from "./piece-price-entry";

// The value of a **piece** (#2359; ADR-0076) for the Valuation dialog and the identification step —
// the database half. The rule a piece is valued by is `piece-valuation.ts`, applied inside
// `valuateItemRows` for every reader at once; this module reads that value — its terms and each
// stamp's prices carried on it (#2353) — beside each stamp on the piece, which the dialog lists.

export interface CarrierValuationRead {
  itemId: string;
  collectionId: string;
  baseCurrency: string;
  /** False when the copy is not a piece — it is then valued from the catalogue, and nothing here
   *  applies. Reported rather than refused, so a dialog opened on a row a moment before it was edited
   *  down to one stamp can say so instead of failing. */
  multiStamp: boolean;
  /** The copy's own condition. Its stamps' prices are read and typed in the conditions the method
   *  maps (#2375), never in this one. */
  conditionId: string;
  conditionName: string;
  /** The piece's value as every list and total reads it — the method's result, modified and lowered
   *  for faults — with each stamp's prices and the arithmetic on `piece` (#2353). Null for a copy
   *  that is not a piece. */
  value: CopyValuation | null;
  /** The stamps on the piece, named; `id` is the `PieceComponent` id their prices are under. */
  components: ItemStampSummary[];
}

/**
 * A piece's value beside its stamps (#2359, #2353). Ownership asserted through `getItemStamps`, which is also where
 * the components' labels come from — the same read model the copy dialog and the copy's own screen
 * draw the stamp list from.
 */
export async function getCarrierValuation(
  ownerId: string,
  itemId: string,
  /** Stamp prices typed in the window and not yet saved (#2368), valued as if they were. */
  typed: readonly TypedPiecePrice[] = []
): Promise<CarrierValuationRead> {
  const stamps = await getItemStamps(ownerId, itemId);
  const item = await prisma.item.findUniqueOrThrow({
    where: { id: itemId },
    select: {
      id: true,
      collectionId: true,
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      condition: { select: { name: true } },
      ...COPY_VALUATION_SELECT,
    },
  });

  // The variant flag is never read for a piece — its stamps are valued entry by entry — so it is
  // stated rather than looked up.
  const ownRow: ValuationRow = {
    id: item.id,
    stampId: item.stampId,
    conditionId: item.conditionId,
    certificateStatusId: item.certificateStatusId,
    formatId: item.formatId,
    unknownVariant: false,
    ...copyValuationOf(item),
  };
  const [valuations, baseCurrency] = await Promise.all([
    valuateItemRows(item.collectionId, [ownRow], undefined, typed),
    getCollectionBaseCurrency(item.collectionId),
  ]);

  const value = valuations.get(item.id)!;

  return {
    itemId: item.id,
    collectionId: item.collectionId,
    baseCurrency,
    multiStamp: value.piece !== null,
    conditionId: item.conditionId,
    conditionName: item.condition.name,
    value: value.piece ? value : null,
    components: stamps.entries,
  };
}

/**
 * Set a copy's franking and its own valuation method (#2359) — the agent API's write; the copy dialog
 * writes both through `updateItem`. `undefined` leaves a field alone; a null method follows the area.
 * Allowed on any copy: the franking is read only once the copy is a piece, and a copy that becomes
 * one later should not have to be told again.
 */
export async function setPieceValuation(
  ownerId: string,
  itemId: string,
  input: { franking?: Franking; method?: ValuationMethod | null }
): Promise<void> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { collection: { select: { ownerId: true } } },
  });
  if (!item || item.collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  await prisma.item.update({
    where: { id: itemId },
    data: {
      ...(input.franking !== undefined ? { franking: input.franking } : {}),
      ...(input.method !== undefined ? { valuationMethod: input.method } : {}),
    },
  });
}

/** What the identification step holds of a piece before it is written (#2353). */
export interface PiecePreviewInput {
  conditionId: string;
  /** The piece's own format; null is none. */
  formatId: string | null;
  /** The stamps on it, in the collector's order. */
  stamps: readonly DraftPieceEntry[];
  /** The franking chosen, or null on a correction, which reads the copy's own. */
  franking: Franking | null;
  /** The piece's own method chosen (#2369), null for *As inherited*; absent on a correction, which
   *  reads the copy's own. */
  method?: ValuationMethod | null;
  /** The copy a correction re-answers — its franking and own method are its own. */
  itemId: string | null;
  /** Stamp prices typed on the piece and not yet saved (#2368), valued as if they were. */
  typed?: readonly TypedPiecePrice[];
}

/**
 * The value a piece **will** have, for the identification step (#2353): its stamps valued by the
 * method exactly as the copy will be once written — at the condition chosen, no certificate, the
 * method from the most expensive stamp's area (a correction's own method winning). Before the copy's
 * modifier and faults, which identification does not set. Null when what is described is not a piece.
 */
export async function previewPieceValue(
  ownerId: string,
  collectionId: string,
  input: PiecePreviewInput
): Promise<CopyValuation | null> {
  await assertCollectionOwner(ownerId, collectionId);
  const [first] = input.stamps;
  if (!first) return null;
  const corrected = input.itemId
    ? await prisma.item.findFirst({
        where: { id: input.itemId, collectionId },
        select: { id: true, stampCount: true, franking: true, valuationMethod: true },
      })
    : null;
  const own = corrected ? pieceCopyOf(corrected) : null;
  const key = input.itemId ?? "preview";
  const valuations = await valuateItemRows(collectionId, [
    {
      id: key,
      stampId: first.stampId,
      conditionId: input.conditionId,
      certificateStatusId: null,
      formatId: input.formatId,
      unknownVariant: false,
      copy: {
        itemId: key,
        stampCount: input.stamps.reduce((sum, s) => sum + s.quantity, 0),
        franking: input.franking ?? own?.franking ?? DEFAULT_FRANKING,
        method: input.method !== undefined ? input.method : (own?.method ?? null),
        draftEntries: input.stamps,
      },
      faultReductionPercent: null,
      valueModifier: null,
      candidateStampIds: null,
    },
  ], undefined, input.typed ?? []);
  const value = valuations.get(key);
  return value?.piece ? value : null;
}
