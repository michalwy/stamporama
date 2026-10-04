import "server-only";
import { prisma } from "./db";
import {
  anchoringResolver,
  resolveAnchoringMarkets,
  type AnchoringResolver,
  type MarketCode,
} from "./market-anchoring";

// The database half of `market-anchoring.ts` (#1634; ADR-0064): the collection's home market, its
// areas' anchoring markets inherited down the tree, and the area each stamp is valued in. The rules
// are all in the pure module; this only reads what they are applied to.

/** The collection's home market — what a tree naming no anchors anchors on, and what a result whose
 * contacts name no market counts as. */
export async function getCollectionHomeMarket(collectionId: string): Promise<MarketCode> {
  const collection = await prisma.collection.findUniqueOrThrow({
    where: { id: collectionId },
    select: { homeMarket: true },
  });
  return collection.homeMarket;
}

/** Every area's anchoring markets, inherited. Ownership is the caller's. */
export async function buildAnchoringMarketsMap(
  collectionId: string,
  homeMarket?: MarketCode
): Promise<Map<string, MarketCode[]>> {
  const [areas, home] = await Promise.all([
    prisma.collectionArea.findMany({
      where: { collectionId },
      select: { id: true, parentId: true, anchorMarkets: true },
    }),
    homeMarket ?? getCollectionHomeMarket(collectionId),
  ]);
  return resolveAnchoringMarkets(areas, home);
}

/**
 * What anchors each of these stamps — the resolver every market read filters its results through.
 *
 * A stamp is valued in its **primary** area, else its first, which is the area `valuateItemRows`
 * reads its catalogue from: the price a result is compared with and the market it is judged by come
 * from the same place. Ownership is the caller's, as `readStampMarketValues` has it.
 */
export async function loadAnchoring(
  collectionId: string,
  stampIds: readonly string[]
): Promise<AnchoringResolver> {
  const homeMarket = await getCollectionHomeMarket(collectionId);
  const [anchorsByArea, links] = await Promise.all([
    buildAnchoringMarketsMap(collectionId, homeMarket),
    stampIds.length === 0
      ? Promise.resolve([])
      : prisma.stampCollectionArea.findMany({
          where: { stampId: { in: [...new Set(stampIds)] }, stamp: { collectionId } },
          select: { stampId: true, collectionAreaId: true, isPrimary: true },
          orderBy: { collectionAreaId: "asc" },
        }),
  ]);
  const areaOfStamp = new Map<string, string | null>();
  for (const link of links) {
    if (link.isPrimary || !areaOfStamp.has(link.stampId)) {
      areaOfStamp.set(link.stampId, link.collectionAreaId);
    }
  }
  return anchoringResolver(homeMarket, areaOfStamp, anchorsByArea);
}
