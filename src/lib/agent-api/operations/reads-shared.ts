import "server-only";
import { prisma } from "../../db";
import { makeCatalogLabeller, type CatalogLabelling } from "../../collection-search";
import { buildLocationPath, type LocationPathNode } from "../../location-path";
import { notFound } from "../errors";
import type { OperationContext } from "../types";

// What every collection read needs before it can state a row (#710) — the collection it is acting
// on, the catalog labeller, and the location tree.
//
// **Server-side, and only because these are database reads.** The decisions about what a row says
// live in the pure `../collection-reads.ts`; this file fetches the three things those projections
// cannot derive from a row, and nothing else (`agent-api.md`, *The module layout is the Prisma-free
// split*). It imports the types and the helpers beside it and never the registry (#658).

/** The collection a token is pinned to, proved to exist. */
export interface CollectionHeader {
  readonly slug: string;
  readonly baseCurrency: string;
}

/**
 * The token's collection, or a `not_found` the agent can act on.
 *
 * **Scoped by owner as well as by id**, so the ownership check costs nothing extra — the same shape
 * `readCollectionVocabulary` uses (#708). A token is pinned to one collection (#706), so this can
 * only fail when the collection was deleted after the token was minted, which is a `not_found` and
 * never a 500.
 */
export async function loadCollectionHeader(
  context: OperationContext
): Promise<CollectionHeader> {
  const collection = await prisma.collection.findFirst({
    where: { id: context.collectionId, ownerId: context.ownerId },
    select: { slug: true, baseCurrency: true },
  });
  if (!collection) {
    throw notFound(
      "This token's collection no longer exists. Ask the collector for a token on a live collection."
    );
  }
  return collection;
}

/**
 * Where a record lives in the app, relative to this instance.
 *
 * **Relative on purpose**, `agentPhotoUrl`'s own reasoning (#706): the agent reached this instance
 * at some origin and can resolve against it, and the app has no configured public base URL to state
 * instead — inventing one out of a request header would be a header the caller controls.
 *
 * The slug comes off the **authorized** collection rather than out of anything the caller sent,
 * which is `resolveQuickJump`'s rule: this is an address somebody is about to follow, and the only
 * slug that can be right is the one belonging to the collection the token proved.
 */
export function collectionPath(header: CollectionHeader, suffix: string): string {
  return `/c/${encodeURIComponent(header.slug)}${suffix}`;
}

/** The labeller that turns stored `{vendor, number}` pairs into `Mi·PL 200`, the area's primary
 *  catalog first — `collection-search.ts`'s own, so a number reads the same to an agent as it does
 *  in the window a collector opens at an auction (#181/#357/#377). */
export async function loadCatalogLabelling(collectionId: string): Promise<CatalogLabelling> {
  const vendors = await prisma.catalogVendor.findMany({
    where: { collectionId },
    select: { id: true, abbreviation: true },
  });
  return makeCatalogLabeller(collectionId, vendors);
}

/** Resolves a copy's `locationId` to the breadcrumb a collector would read. */
export interface LocationPaths {
  readonly pathFor: (locationId: string | null) => string | null;
}

/**
 * The collection's storage locations, as paths.
 *
 * Loaded **whole, once per read** rather than joined per row: these are a handful of rows and a page
 * of twenty-five copies would otherwise be twenty-five joins for a breadcrumb. The derivation is the
 * pure `buildLocationPath` the printable packing list and the Copies list's filing groups already
 * share (#330/#421), so *where a copy is* cannot come to have two spellings.
 */
export async function loadLocationPaths(collectionId: string): Promise<LocationPaths> {
  const locations: LocationPathNode[] = await prisma.location.findMany({
    where: { collectionId },
    select: { id: true, name: true, parentId: true },
  });
  return { pathFor: (locationId) => buildLocationPath(locations, locationId) };
}
