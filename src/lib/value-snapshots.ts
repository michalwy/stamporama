import "server-only";
import { prisma } from "./db";
import { getHoldingsValuationByAreaSubtree } from "./items";
import { offersSummary } from "./offers";
import { auctionLotExposure } from "./auctions";
import { readSnapshot as readRateSnapshot } from "./exchange-rates";
import { holdingsSnapshotFields, ratesIntoBase, snapshotDay } from "./value-snapshot-rules";

/**
 * Daily collection value snapshots (#652; ADR-0053): the one thing the Overview cannot compute after
 * the fact. Growth in copies and spend falls out of event dates; the value of the holdings on a past
 * day does not, because catalogue prices, holdings, listings and rates have all moved since — so it
 * is recorded, one row per collection per UTC day plus one per area subtree. The chart over it is
 * #653.
 *
 * Every figure is a read that already exists, at the scope the Overview tile states it over
 * (`getOverviewValue`): holdings over `excludeGone`, asking over `state=active`, exposure over the
 * watchlist's open lots. Nothing is re-derived here, so a snapshot taken today and the tile read
 * today cannot disagree.
 *
 * **Idempotent per (collection, day)**: a later pass the same day replaces the day's figures, so a
 * restart or the hourly tick never doubles a point. A day the app was not running is left as a gap —
 * nothing here can reconstruct it, and a back-filled point would be today's state with an old date.
 */

export interface CollectionSnapshotOutcome {
  /** False when the day's row already existed and was updated. */
  created: boolean;
  areaCount: number;
}

/** Record today's snapshot for one collection. Null when the collection does not exist (it may have
 * been deleted between listing and recording). */
export async function recordCollectionValueSnapshot(
  collectionId: string,
  now: Date = new Date()
): Promise<CollectionSnapshotOutcome | null> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, baseCurrency: true },
  });
  if (!collection) return null;
  const { ownerId, baseCurrency } = collection;

  const areas = await prisma.collectionArea.findMany({
    where: { collectionId },
    select: { id: true, parentId: true },
  });

  const [holdings, offers, exposure] = await Promise.all([
    getHoldingsValuationByAreaSubtree(collectionId, areas),
    offersSummary(ownerId, collectionId, { states: ["active"] }),
    auctionLotExposure(ownerId, collectionId, {}),
  ]);
  // Read after the figures, not before: a conversion above may have refreshed a stale table, and the
  // table recorded must be the one the figures were converted with.
  const rateTable = await readRateSnapshot(collectionId);

  const day = snapshotDay(now);
  const figures = {
    takenAt: now,
    baseCurrency,
    rates: rateTable ? ratesIntoBase(rateTable.rates, baseCurrency) : {},
    ratesFetchedAt: rateTable?.fetchedAt ?? null,
    ...holdingsSnapshotFields(holdings.collection),
    askingValue: offers.askingBaseAmount,
    askingOfferCount: offers.offerCount,
    askingUnpricedCount: offers.unpricedCount,
    askingUnconvertibleCount: offers.unconvertibleCount,
    exposureCommitted: exposure.committedTotal,
    exposureCeiling: exposure.ceilingTotal,
    exposurePayableCount: exposure.payableCount,
    exposureUncappedCount: exposure.uncappedCount,
    exposureUnconvertibleCount: exposure.unconvertibleCount,
  };

  return prisma.$transaction(async (tx) => {
    const existing = await tx.collectionValueSnapshot.findUnique({
      where: { collectionId_day: { collectionId, day } },
      select: { id: true },
    });
    const snapshot = await tx.collectionValueSnapshot.upsert({
      where: { collectionId_day: { collectionId, day } },
      create: { collectionId, day, ...figures },
      update: figures,
      select: { id: true },
    });
    // The day's area rows are replaced whole, as the exchange-rate table is: one pass is one
    // observation, and an area deleted since the last pass must not keep a row for today.
    await tx.collectionAreaValueSnapshot.deleteMany({ where: { snapshotId: snapshot.id } });
    await tx.collectionAreaValueSnapshot.createMany({
      data: areas.map((area) => ({
        snapshotId: snapshot.id,
        collectionAreaId: area.id,
        ...holdingsSnapshotFields(holdings.areas.get(area.id)!),
      })),
    });
    return { created: existing === null, areaCount: areas.length };
  });
}

export interface ValueSnapshotPass {
  /** Collections recorded, created or updated. */
  recorded: number;
  /** Of those, how many wrote the day's first row. */
  created: number;
  areaRows: number;
  failed: number;
}

/**
 * One pass over every collection (or the given ones — tests pass their own, so a pass never reaches
 * a collection another suite is building). A collection that fails is logged and skipped; it does not
 * stop the rest, and its day stays a gap unless a later pass that day succeeds.
 */
export async function recordValueSnapshots(
  options: { now?: Date; collectionIds?: string[] } = {}
): Promise<ValueSnapshotPass> {
  const now = options.now ?? new Date();
  const ids =
    options.collectionIds ??
    (await prisma.collection.findMany({ select: { id: true } })).map((c) => c.id);

  const pass: ValueSnapshotPass = { recorded: 0, created: 0, areaRows: 0, failed: 0 };
  for (const id of ids) {
    try {
      const outcome = await recordCollectionValueSnapshot(id, now);
      if (!outcome) continue;
      pass.recorded++;
      if (outcome.created) pass.created++;
      pass.areaRows += outcome.areaCount;
    } catch (err) {
      pass.failed++;
      console.error(`[value-snapshots] collection ${id} failed`, err);
    }
  }
  return pass;
}
