import "server-only";
import type { TitleTemplateCopy, TitleCatalogNumber } from "./offer-title-template";
import { getCollectionAreas } from "./areas";
import { buildAreaVendorMaps, buildAreaTitleMap, type AreaVendorMaps } from "./area-vendor";
import { resolveTranslation } from "./translations";

// Shared server-side normalisation from an inventory `Item` row to the pure `TitleTemplateCopy`
// shape the title-template engine (#210) consumes. Used both when generating offer / set titles
// (`offers.ts`) and when previewing a template against a sample copy (`title-samples.ts`). Keeping
// the Prisma `select`, the per-area catalog resolution, and the mapping in one place means the two
// paths resolve every token — including the parameterised `{catalog}` — identically.

/** Copy fields the title template resolves over: stamp name / **all** catalog numbers (with vendor
 * abbreviation, for `{catalog:Mi…}`) / year / condition / certificate / primary area + its id (to
 * resolve per-area catalog prefixes and the primary vendor) / issue. */
// Translation rows come along unfiltered rather than scoped to the target language: the select is a
// static const shared by every caller, and an entity carries at most one row per language the
// collection's platforms list in — a handful, against the one row per language *per item* a dynamic
// select would save. `toTitleCopy` picks the language.
export const TITLE_COPY_SELECT = {
  id: true,
  stamp: {
    select: {
      name: true,
      issuedYear: true,
      translations: { select: { language: true, name: true } },
      catalogNumbers: {
        select: { catalogVendorId: true, number: true, catalogVendor: { select: { abbreviation: true } } },
      },
      stampAreaLinks: {
        select: { isPrimary: true, collectionAreaId: true, collectionArea: { select: { name: true } } },
      },
      issueMemberships: {
        select: {
          issue: {
            select: {
              name: true,
              year: true,
              translations: { select: { language: true, name: true } },
            },
          },
        },
        take: 1,
      },
    },
  },
  condition: {
    select: {
      name: true,
      abbreviation: true,
      translations: { select: { language: true, name: true, abbreviation: true } },
    },
  },
  certificateStatus: {
    select: {
      name: true,
      abbreviation: true,
      translations: { select: { language: true, name: true, abbreviation: true } },
    },
  },
  location: { select: { name: true } },
  locationRef: true,
} as const;

/** A translation row for a single-`name` entity (stamp, issue). */
type NameTranslation = { language: string; name: string | null };
/** A translation row for the name + abbreviation entities (condition, certificate status). */
type LabelTranslation = { language: string; name: string | null; abbreviation: string | null };

export type TitleCopyRow = {
  id: string;
  stamp: {
    name: string | null;
    issuedYear: number | null;
    translations: NameTranslation[];
    catalogNumbers: { catalogVendorId: string; number: string; catalogVendor: { abbreviation: string } }[];
    stampAreaLinks: { isPrimary: boolean; collectionAreaId: string; collectionArea: { name: string } }[];
    issueMemberships: { issue: { name: string | null; year: number | null; translations: NameTranslation[] } }[];
  };
  condition: { name: string; abbreviation: string; translations: LabelTranslation[] };
  certificateStatus: { name: string; abbreviation: string; translations: LabelTranslation[] } | null;
  location: { name: string } | null;
  locationRef: string | null;
};

/** Normalise a fetched `Item` row (selected with {@link TITLE_COPY_SELECT}) into the pure
 * `TitleTemplateCopy` the engine renders, using the collection's area-vendor `maps` to resolve each
 * catalog number's per-area prefix and which vendor is the copy's area primary. Picks the primary
 * area (else the first).
 *
 * `language` is the platform's listing language (#293). Stamp name (#296), issue name (#295) and
 * the condition / certificate status name + abbreviation (#294) each resolve to their translation
 * for it, **field by field**, falling back to the entity's default-language column — so a Polish
 * listing can translate `Mint Never Hinged` while keeping `MNH`. `{area}` resolves earlier, in
 * `areaTitleById`, because its fallback also walks the area roll-up chain. */
export function toTitleCopy(
  row: TitleCopyRow,
  maps: AreaVendorMaps,
  areaTitleById: ReadonlyMap<string, string>,
  language: string | null = null
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
    name: resolveTranslation(row.stamp.translations, language, (t) => t.name, row.stamp.name),
    catalogNumbers,
    year: row.stamp.issuedYear,
    condition: resolveTranslation(
      row.condition.translations,
      language,
      (t) => t.name,
      row.condition.name
    ),
    conditionAbbr: resolveTranslation(
      row.condition.translations,
      language,
      (t) => t.abbreviation,
      row.condition.abbreviation
    ),
    certificate: row.certificateStatus
      ? resolveTranslation(
          row.certificateStatus.translations,
          language,
          (t) => t.name,
          row.certificateStatus.name
        )
      : null,
    certificateAbbr: row.certificateStatus
      ? resolveTranslation(
          row.certificateStatus.translations,
          language,
          (t) => t.abbreviation,
          row.certificateStatus.abbreviation
        )
      : null,
    area: areaTitle,
    location: row.location?.name ?? null,
    ref: row.locationRef ?? null,
    issueName: issue ? resolveTranslation(issue.translations, language, (t) => t.name, issue.name) : null,
    issueYear: issue?.year ?? null,
  };
}

/** Build a row→`TitleTemplateCopy` mapper for a collection, loading its area-vendor maps once (they
 * resolve per-area catalog prefixes and primary vendors with ancestor inheritance). Owner-scoped via
 * {@link getCollectionAreas}. Callers fetch their own rows with {@link TITLE_COPY_SELECT} and map.
 *
 * `language` (#293) is the listing language of the platform the title is generated for — an ISO
 * 639-1 code, or null for the default language. Entity text resolves to that language where a
 * translation exists and falls back silently to the default value otherwise (surfacing the
 * fallback in the preview is #298). Every translatable token now honours it: `{area}` (#293),
 * `{condition}` / `{conditionAbbr}` / `{certificate}` / `{certificateAbbr}` (#294), `{issueName}`
 * (#295) and `{name}` (#296). */
export async function makeTitleCopyMapper(
  ownerId: string,
  collectionId: string,
  language: string | null = null
): Promise<(row: TitleCopyRow) => TitleTemplateCopy> {
  const areas = await getCollectionAreas(ownerId, collectionId);
  const maps = buildAreaVendorMaps(areas);
  const areaTitleById = buildAreaTitleMap(areas, language);
  return (row) => toTitleCopy(row, maps, areaTitleById, language);
}
