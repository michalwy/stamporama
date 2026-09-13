import "server-only";
import { prisma } from "./db";
import { getItemStamps, type ItemStampSummary } from "./items";
import {
  CARRIER_VALUATION_SELECT,
  carrierValuationOf,
  valuateItemRows,
  type ValuationRow,
} from "./item-valuation";
import { getCollectionBaseCurrency } from "./pricing";
import { isMultiStampCount } from "./multi-stamp";
import {
  carrierComponentRows,
  sumCarrierComponents,
  type CarrierComponentShare,
  type CarrierSuggestion,
} from "./carrier-value";
import type { CopyValuation, ExplicitValue } from "./valuation";

// The value of a **multi-stamp copy** (#747; ADR-0044 §6) — the database half. The rule a carrier is
// valued by lives in `valuation.ts` (`valuateExplicitValue`) and is applied inside `valuateItemRows`
// for every reader at once; the suggestion's arithmetic is the pure `carrier-value.ts`. This module
// does the two things only the Valuation dialog needs: read the recorded figure beside the sum of the
// piece's stamps, and record what the collector accepted.

/** One stamp on the piece, valued as the suggestion values it. */
export interface CarrierComponentRead extends ItemStampSummary {
  /** At the copy's condition, the entry's format and no certificate. */
  valuation: CopyValuation;
  share: CarrierComponentShare;
}

export interface CarrierValuationRead {
  itemId: string;
  collectionId: string;
  baseCurrency: string;
  /** False when the copy carries one stamp — it is then valued from the catalogue, and nothing here
   *  applies. Reported rather than refused, so a dialog opened on a row a moment before it was edited
   *  down to one stamp can say so instead of failing. */
  multiStamp: boolean;
  conditionName: string;
  /** What the collector recorded, as stored; null when nothing has been. */
  recorded: ExplicitValue | null;
  /** A carrier's valuation as every list and total reads it — the recorded figure converted to base,
   *  or unpriced. Null for a copy carrying one stamp, which is valued from the catalogue instead. */
  value: CopyValuation | null;
  components: CarrierComponentRead[];
  suggestion: CarrierSuggestion;
}

/**
 * The recorded value of one copy beside the sum of its stamps. Ownership asserted through
 * `getItemStamps`, which is also where the components' labels come from — the same read model the
 * copy dialog and the copy's own screen draw the stamp list from.
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
      ...CARRIER_VALUATION_SELECT,
    },
  });
  const carrier = carrierValuationOf(item);

  // Only ever valued as a carrier, where the catalogue is not consulted — so the variant flag is
  // never read and is stated rather than looked up.
  const ownRow: ValuationRow | null = carrier && {
    id: item.id,
    stampId: item.stampId,
    conditionId: item.conditionId,
    certificateStatusId: item.certificateStatusId,
    formatId: item.formatId,
    unknownVariant: false,
    carrier,
  };
  // Keyed by entry id, which no copy id can equal — one batched valuation for the piece and its
  // stamps together.
  const componentRows: ValuationRow[] = carrierComponentRows(item, stamps.entries);

  const [valuations, baseCurrency] = await Promise.all([
    valuateItemRows(item.collectionId, ownRow ? [ownRow, ...componentRows] : componentRows),
    getCollectionBaseCurrency(item.collectionId),
  ]);

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
    multiStamp: carrier !== null,
    conditionName: item.condition.name,
    recorded: carrier?.explicitValue ?? null,
    value: carrier ? valuations.get(item.id)! : null,
    components: stamps.entries.map((entry, index) => ({
      ...entry,
      valuation: componentValuations[index],
      share: suggestion.shares[index],
    })),
    suggestion,
  };
}

/**
 * Record — or, with `null`, clear — a multi-stamp copy's value (#747).
 *
 * **Only a carrier has one.** An ordinary copy is valued from the catalogue, and a figure recorded on
 * it would be a second answer the catalogue could never overrule, so the write is refused with a
 * sentence rather than stored and ignored. The value is whatever the collector accepted: the
 * suggestion is never written by anything but this call, and this call is only ever made by the
 * collector saving the dialog.
 */
export async function setCarrierValue(
  ownerId: string,
  itemId: string,
  value: ExplicitValue | null
): Promise<void> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { stampCount: true, collection: { select: { ownerId: true } } },
  });
  if (!item || item.collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  if (!isMultiStampCount(item.stampCount)) {
    throw new CarrierValueError(
      "Only a copy carrying several stamps has a value of its own — this one is valued from the catalog."
    );
  }
  await prisma.item.update({
    where: { id: itemId },
    data: {
      explicitValue: value?.amount ?? null,
      explicitValueCurrency: value?.currency ?? null,
    },
  });
}

/** A refusal whose message is written for the collector, as against a failure. */
export class CarrierValueError extends Error {}
