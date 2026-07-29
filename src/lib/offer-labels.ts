import "server-only";
import { readCollectionAreas } from "./areas";
import { buildAreaVendorMaps } from "./area-vendor";
import { loadIssuePrefixMap } from "./issue-prefix";
import { deriveOfferLabel, deriveSetLabel } from "./offer-set-rules";
import { compareSetItems } from "./offer-set-order";
import type { CatalogNumberGroupEntry } from "./offer-title-template";

// How an offer, one of its sets and one of its copies are *named* when the collector titled nothing
// (#209, #379). The rules themselves are pure (`offer-set-rules.ts`); what lives here is the one
// server-side read they need — the collection's area tree — because a catalog number is only
// readable under the vendor that leads in the stamp's own area.
//
// Shared by the offers domain and the sales domain (the sellable-offer picker and a sale line both
// name an offer set), so a set reads identically wherever it is printed.

/** The stamp fields a label is derived from. */
export const STAMP_LABEL_SELECT = {
  stamp: {
    select: {
      name: true,
      // Every recorded number with its vendor, plus the area the stamp hangs under: the derived set
      // label names the catalogue it collapsed (#379), and which vendor leads follows from the area.
      catalogNumbers: { select: { number: true, catalogVendorId: true } },
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      // …and the issue it belongs to, which may override that area's prefix (#377).
      issueMemberships: { select: { issueId: true }, take: 1 },
      // The denormalized catalog sort key (ADR-0014) a set's derived copy order falls back to (#306).
      primaryCatalogSortKey: true,
    },
  },
} as const;

export type StampLabelRow = {
  name: string | null;
  catalogNumbers: { number: string; catalogVendorId: string }[];
  stampAreaLinks: { collectionAreaId: string; isPrimary: boolean }[];
  issueMemberships: { issueId: string }[];
  primaryCatalogSortKey: number | null;
};

export type LabelSetItemRow = {
  itemId: string;
  sortOrder: number | null;
  item: { stamp: StampLabelRow };
};

export type LabelSetRow = {
  title: string | null;
  items: readonly LabelSetItemRow[];
};

/** A set's copies in effective order (#306) — explicit positions first, then catalog order. */
export function orderedLabelItems<T extends LabelSetItemRow>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    compareSetItems(
      { itemId: a.itemId, sortOrder: a.sortOrder, catalogSortKey: a.item.stamp.primaryCatalogSortKey },
      { itemId: b.itemId, sortOrder: b.sortOrder, catalogSortKey: b.item.stamp.primaryCatalogSortKey }
    )
  );
}

export interface OfferLabeller {
  /** The number a stamp is named by: its area's primary vendor's, else whichever was recorded
   * first — naming *some* catalogue beats naming none — carried with the parts a label prefixes it
   * with. Null when the stamp carries no catalog number at all. */
  catalogOf(stamp: StampLabelRow): CatalogNumberGroupEntry | null;
  /** Short label for one copy: its leading catalog number, else the stamp's name. The number is
   * bare — a copy is listed inside a set whose own label already names the catalogue (#379), so
   * repeating `Mi·PL` on every line of it says nothing. */
  copy(stamp: StampLabelRow): string;
  set(set: LabelSetRow): string;
  offer(sets: readonly LabelSetRow[]): string;
}

/**
 * Set / offer label derivation over one collection's area tree (#379). A derived set label names the
 * catalogue its numbers came from and collapses them into ranges, which needs to know *which* vendor
 * leads in the stamp's area and how that vendor's numbers are prefixed there — so the tree is read
 * **once per page of offers** and resolved with the same pure `buildAreaVendorMaps` the client
 * renders catalog chips with, exactly as the auction lot's derived name does (#353).
 *
 * The caller has already resolved the collection for its owner, hence `readCollectionAreas`.
 */
export async function makeOfferLabeller(collectionId: string): Promise<OfferLabeller> {
  const [areas, issuePrefixes] = await Promise.all([
    readCollectionAreas(collectionId),
    loadIssuePrefixMap(collectionId),
  ]);
  const { primaryVendorByArea, vendorMapFor } = buildAreaVendorMaps(areas, issuePrefixes);

  function catalogOf(stamp: StampLabelRow): CatalogNumberGroupEntry | null {
    const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    const primaryVendorId = areaId ? (primaryVendorByArea.get(areaId) ?? null) : null;
    const leading =
      (primaryVendorId
        ? stamp.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId)
        : undefined) ?? stamp.catalogNumbers[0];
    if (!leading) return null;
    const vendor = vendorMapFor(areaId, stamp.issueMemberships[0]?.issueId ?? null).get(
      leading.catalogVendorId
    );
    return {
      vendorId: leading.catalogVendorId,
      // No vendor entry for this area leaves both parts blank, which renders the bare number —
      // the same fallback `formatStampCN` makes.
      vendorAbbr: vendor?.vendorAbbreviation ?? "",
      areaPrefix: vendor?.prefix ?? null,
      number: leading.number,
    };
  }

  function set(row: LabelSetRow): string {
    return deriveSetLabel(
      row.title,
      orderedLabelItems(row.items).map((li) => ({
        catalog: catalogOf(li.item.stamp),
        stampName: li.item.stamp.name,
      }))
    );
  }

  return {
    catalogOf,
    copy: (stamp) => catalogOf(stamp)?.number ?? stamp.name ?? "Copy",
    set,
    offer: (sets) => deriveOfferLabel(sets.map(set)),
  };
}
