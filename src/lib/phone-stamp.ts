import "server-only";
import { prisma } from "./db";
import { getStampListItem, getStampPriceDetails, type StampListItem } from "./stamps";
import { listItemsPaginated, type ItemListItem } from "./items";
import { listWantsPaginated, type WantListItem } from "./wants";
import { getLocations } from "./locations";
import { getStampConditions } from "./conditions";
import { getCertificateStatuses } from "./certificate-statuses";
import { getStampFormats } from "./stamp-formats";
import { getStampMarketEvidenceByStamp, type StampMarketValue } from "./market-values";
import { listStampCopyPhotos, type PhotoSummary } from "./photos";
import { makeCatalogLabeller } from "./collection-search";
import { readIncludeSpecialised } from "./specialised-checklists-preference";
import type { StampAverageCell } from "./stamps";
import type { LocationPathNode } from "./location-path";
import type { WantAxisDictionaries } from "./want-axes";

// Everything the phone stamp screen states (#2003, ADR-0072), read through **the desk's own reads**:
// the stamp as its page reads it, the copies as its Copies card does, the wants as its Wants card,
// the market value as the Valuation dialog and the catalogue value as the Catalog prices card. The
// phone adds no figure and no rule of its own — it is a narrower page over the same answers.

/** How many copies the screen lists before sending the collector to the desk for the rest. */
export const PHONE_STAMP_COPY_LIMIT = 100;
/** …and wants, which for one stamp are a handful at most. */
const PHONE_STAMP_WANT_LIMIT = 50;

export interface PhoneStamp {
  stamp: StampListItem;
  /** The stamp's catalogue numbers as the collector reads them (`Mi·PL 200`), primary first. */
  catalogNumbers: string[];
  /** The photos of the stamp's copies (#1290) — the picture when the stamp has none of its own. */
  copyPhotos: { photos: PhotoSummary[]; total: number };
  copies: ItemListItem[];
  /** More copies than {@link PHONE_STAMP_COPY_LIMIT}: the rest are at the desk. */
  moreCopies: boolean;
  locations: LocationPathNode[];
  wants: WantListItem[];
  dictionaries: WantAxisDictionaries;
  market: { values: StampMarketValue[]; baseCurrency: string };
  /** The cross-catalogue averages that carry an amount. */
  catalogueCells: StampAverageCell[];
}

/**
 * The phone stamp screen's data, or null when the stamp is not this collection's — another
 * collection's stamp is somebody else's screen as far as this slug is concerned, exactly as on the
 * desk.
 */
export async function getPhoneStamp(
  ownerId: string,
  collectionId: string,
  stampId: string
): Promise<PhoneStamp | null> {
  const includeSpecialised = await readIncludeSpecialised(collectionId);
  let stamp: StampListItem;
  try {
    stamp = await getStampListItem(ownerId, stampId, { includeSpecialised });
  } catch {
    return null;
  }
  if (stamp.collectionId !== collectionId) return null;

  const [
    vendors,
    copyPhotos,
    copyPage,
    locations,
    wantPage,
    conditions,
    certificateStatuses,
    formats,
    market,
    prices,
  ] = await Promise.all([
    prisma.catalogVendor.findMany({
      where: { collectionId },
      select: { id: true, abbreviation: true },
    }),
    listStampCopyPhotos(ownerId, stampId),
    // The Copies card's set: this stamp's copies still held — not sold, not traded away, not
    // disposed of — which is what the Copies list's own defaults leave in.
    listItemsPaginated(ownerId, collectionId, {
      stampId,
      excludeGone: true,
      pageSize: PHONE_STAMP_COPY_LIMIT,
    }),
    getLocations(ownerId, collectionId),
    // Open and closed, open first — the Wants card's own read: a closed want is the record that this
    // was looked for and found.
    listWantsPaginated(ownerId, collectionId, {
      stampId,
      status: "all",
      pageSize: PHONE_STAMP_WANT_LIMIT,
    }),
    getStampConditions(ownerId, collectionId),
    getCertificateStatuses(ownerId, collectionId),
    getStampFormats(ownerId, collectionId),
    getStampMarketEvidenceByStamp(ownerId, stampId),
    getStampPriceDetails(ownerId, stampId),
  ]);

  const labeller = await makeCatalogLabeller(collectionId, vendors);
  const firstIssueId = stamp.issues[0]?.issueId ?? null;

  return {
    stamp,
    catalogNumbers: labeller
      .labelFor(stamp.areaId, firstIssueId, stamp.catalogNumbers)
      .map((cn) => cn.label),
    copyPhotos,
    copies: copyPage.items,
    moreCopies: copyPage.nextCursor !== null,
    locations: locations.map(({ id, name, parentId }) => ({ id, name, parentId })),
    wants: wantPage.items,
    dictionaries: { conditions, certificateStatuses, formats },
    market: { values: market.values, baseCurrency: market.baseCurrency },
    catalogueCells: prices.averageCells.filter((c) => c.averageBase !== null),
  };
}
