import "server-only";
import type { TitleTemplateCopy, TitleCatalogNumber } from "./offer-title-template";
import { getCollectionAreas } from "./areas";
import { buildAreaVendorMaps, buildAreaTitleMap, type AreaVendorMaps } from "./area-vendor";

// Shared server-side normalisation from an inventory `Item` row to the pure `TitleTemplateCopy`
// shape the title-template engine (#210) consumes. Used both when generating offer / set titles
// (`offers.ts`) and when previewing a template against a sample copy (`title-samples.ts`). Keeping
// the Prisma `select`, the per-area catalog resolution, and the mapping in one place means the two
// paths resolve every token — including the parameterised `{catalog}` — identically.

/** Copy fields the title template resolves over: stamp name / **all** catalog numbers (with vendor
 * abbreviation, for `{catalog:Mi…}`) / year / condition / certificate / primary area + its id (to
 * resolve per-area catalog prefixes and the primary vendor) / issue. */
export const TITLE_COPY_SELECT = {
  id: true,
  stamp: {
    select: {
      name: true,
      issuedYear: true,
      catalogNumbers: {
        select: { catalogVendorId: true, number: true, catalogVendor: { select: { abbreviation: true } } },
      },
      stampAreaLinks: {
        select: { isPrimary: true, collectionAreaId: true, collectionArea: { select: { name: true } } },
      },
      issueMemberships: { select: { issue: { select: { name: true, year: true } } }, take: 1 },
    },
  },
  condition: { select: { name: true, abbreviation: true } },
  certificateStatus: { select: { name: true, abbreviation: true } },
  location: { select: { name: true } },
  locationRef: true,
} as const;

export type TitleCopyRow = {
  id: string;
  stamp: {
    name: string | null;
    issuedYear: number | null;
    catalogNumbers: { catalogVendorId: string; number: string; catalogVendor: { abbreviation: string } }[];
    stampAreaLinks: { isPrimary: boolean; collectionAreaId: string; collectionArea: { name: string } }[];
    issueMemberships: { issue: { name: string | null; year: number | null } }[];
  };
  condition: { name: string; abbreviation: string };
  certificateStatus: { name: string; abbreviation: string } | null;
  location: { name: string } | null;
  locationRef: string | null;
};

/** Normalise a fetched `Item` row (selected with {@link TITLE_COPY_SELECT}) into the pure
 * `TitleTemplateCopy` the engine renders, using the collection's area-vendor `maps` to resolve each
 * catalog number's per-area prefix and which vendor is the copy's area primary. Picks the primary
 * area (else the first). */
export function toTitleCopy(
  row: TitleCopyRow,
  maps: AreaVendorMaps,
  areaTitleById: ReadonlyMap<string, string>
): TitleTemplateCopy {
  const areas = row.stamp.stampAreaLinks;
  const primaryLink = areas.find((a) => a.isPrimary) ?? areas[0];
  const areaId = primaryLink?.collectionAreaId ?? null;
  const vendorMap = areaId ? maps.vendorMapByArea.get(areaId) : undefined;
  const primaryVendorId = areaId ? (maps.primaryVendorByArea.get(areaId) ?? null) : null;
  const issue = row.stamp.issueMemberships[0]?.issue ?? null;
  // The area shown in the title rolls up per its `titleName` config (#210); falls back to the leaf
  // area's own name when nothing is configured up the chain.
  const areaTitle = areaId ? (areaTitleById.get(areaId) ?? primaryLink?.collectionArea.name ?? null) : null;

  const catalogNumbers: TitleCatalogNumber[] = row.stamp.catalogNumbers.map((cn) => {
    const entry = vendorMap?.get(cn.catalogVendorId);
    return {
      vendorId: cn.catalogVendorId,
      // Prefer the area-vendor entry's abbreviation; fall back to the vendor relation.
      vendorAbbr: entry?.vendorAbbreviation ?? cn.catalogVendor.abbreviation,
      areaPrefix: entry?.prefix ?? null,
      number: cn.number,
      isPrimary: cn.catalogVendorId === primaryVendorId,
    };
  });
  // Primary vendor first (drives the default `{catalog}` selection + a stable render order); the
  // rest keep their recorded order.
  catalogNumbers.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));

  return {
    name: row.stamp.name,
    catalogNumbers,
    year: row.stamp.issuedYear,
    condition: row.condition.name,
    conditionAbbr: row.condition.abbreviation,
    certificate: row.certificateStatus?.name ?? null,
    certificateAbbr: row.certificateStatus?.abbreviation ?? null,
    area: areaTitle,
    location: row.location?.name ?? null,
    ref: row.locationRef ?? null,
    issueName: issue?.name ?? null,
    issueYear: issue?.year ?? null,
  };
}

/** Build a row→`TitleTemplateCopy` mapper for a collection, loading its area-vendor maps once (they
 * resolve per-area catalog prefixes and primary vendors with ancestor inheritance). Owner-scoped via
 * {@link getCollectionAreas}. Callers fetch their own rows with {@link TITLE_COPY_SELECT} and map. */
export async function makeTitleCopyMapper(
  ownerId: string,
  collectionId: string
): Promise<(row: TitleCopyRow) => TitleTemplateCopy> {
  const areas = await getCollectionAreas(ownerId, collectionId);
  const maps = buildAreaVendorMaps(areas);
  const areaTitleById = buildAreaTitleMap(areas);
  return (row) => toTitleCopy(row, maps, areaTitleById);
}
