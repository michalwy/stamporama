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
import {
  carrierComponentRows,
  sumCarrierComponents,
  type CarrierComponentShare,
  type CarrierSuggestion,
} from "./carrier-value";
import type { Franking, ValuationMethod } from "./piece-valuation";
import type { CopyValuation } from "./valuation";

// The value of a **piece** (#2359; ADR-0076) for the Valuation dialog — the database half. The rule a
// piece is valued by is `piece-valuation.ts`, applied inside `valuateItemRows` for every reader at
// once; this module reads that value beside each stamp on the piece at its used price, which the
// dialog lists. How the value was reached in full is #2353's.

/** One stamp on the piece, at its used price. */
export interface CarrierComponentRead extends ItemStampSummary {
  /** At the copy's condition, the entry's format and no certificate. */
  valuation: CopyValuation;
  share: CarrierComponentShare;
}

export interface CarrierValuationRead {
  itemId: string;
  collectionId: string;
  baseCurrency: string;
  /** False when the copy is not a piece — it is then valued from the catalogue, and nothing here
   *  applies. Reported rather than refused, so a dialog opened on a row a moment before it was edited
   *  down to one stamp can say so instead of failing. */
  multiStamp: boolean;
  conditionName: string;
  /** The piece's value as every list and total reads it — the method's result, modified and lowered
   *  for faults. Null for a copy that is not a piece. */
  value: CopyValuation | null;
  components: CarrierComponentRead[];
  /** The stamps at their used prices, summed. */
  suggestion: CarrierSuggestion;
}

/**
 * A piece's value beside its stamps. Ownership asserted through `getItemStamps`, which is also where
 * the components' labels come from — the same read model the copy dialog and the copy's own screen
 * draw the stamp list from.
 */
export async function getCarrierValuation(
  ownerId: string,
  itemId: string
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
  // Keyed by entry id, which no copy id can equal — one batched valuation for the piece and its
  // stamps together.
  const componentRows: ValuationRow[] = carrierComponentRows(item, stamps.entries);

  const [valuations, baseCurrency] = await Promise.all([
    valuateItemRows(item.collectionId, [ownRow, ...componentRows]),
    getCollectionBaseCurrency(item.collectionId),
  ]);

  const value = valuations.get(item.id)!;
  const componentValuations = stamps.entries.map((entry) => valuations.get(entry.id)!);
  const suggestion = sumCarrierComponents(
    stamps.entries.map((entry, index) => ({
      quantity: entry.quantity,
      valuation: componentValuations[index],
    })),
    baseCurrency
  );

  return {
    itemId: item.id,
    collectionId: item.collectionId,
    baseCurrency,
    multiStamp: value.piece !== null,
    conditionName: item.condition.name,
    value: value.piece ? value : null,
    components: stamps.entries.map((entry, index) => ({
      ...entry,
      valuation: componentValuations[index],
      share: suggestion.shares[index],
    })),
    suggestion,
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
