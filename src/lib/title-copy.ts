import "server-only";
import type {
  TitleTemplateCopy,
  TitleCatalogNumber,
  TitleFallback,
} from "./offer-title-template";
import type { TranslatableEntity } from "./translations";
import { prisma } from "./db";
import { getCollectionAreas } from "./areas";
import { loadIssuePrefixMap } from "./issue-prefix";
import { DEFAULT_ITEM_NO_PAD } from "./item-number";
import {
  buildAreaVendorMaps,
  buildAreaTitleEntries,
  type AreaTitleEntry,
  type AreaVendorMaps,
} from "./area-vendor";
import { normalizeLanguage } from "./languages";
import { resolveTranslationWithFallback } from "./translations";

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
  // The internal copy number behind `{itemNo}` (#268).
  itemNo: true,
  stamp: {
    select: {
      // Entity ids ride along so a fallback can name the row a missing translation goes on (#299).
      id: true,
      name: true,
      issuedYear: true,
      translations: { select: { language: true, name: true } },
      // The subtype behind `{subtype}` (#339). `isDefault` rides along because the default subtype
      // renders as nothing — see `toTitleCopy`.
      subtype: {
        select: {
          id: true,
          name: true,
          isDefault: true,
          translations: { select: { language: true, name: true } },
        },
      },
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
              id: true,
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
      id: true,
      name: true,
      abbreviation: true,
      translations: { select: { language: true, name: true, abbreviation: true } },
    },
  },
  certificateStatus: {
    select: {
      id: true,
      name: true,
      abbreviation: true,
      translations: { select: { language: true, name: true, abbreviation: true } },
    },
  },
  // The copy's physical format behind `{format}` / `{formatAbbr}` (#345). Null for a single, which
  // is most copies — a null relation, not a row to suppress.
  format: {
    select: {
      id: true,
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
  /** Internal copy number (#268) behind `{itemNo}`. */
  itemNo: number;
  stamp: {
    id: string;
    name: string | null;
    issuedYear: number | null;
    translations: NameTranslation[];
    subtype: {
      id: string;
      name: string;
      isDefault: boolean;
      translations: NameTranslation[];
    } | null;
    catalogNumbers: { catalogVendorId: string; number: string; catalogVendor: { abbreviation: string } }[];
    stampAreaLinks: { isPrimary: boolean; collectionAreaId: string; collectionArea: { name: string } }[];
    issueMemberships: {
      issue: { id: string; name: string | null; year: number | null; translations: NameTranslation[] };
    }[];
  };
  condition: { id: string; name: string; abbreviation: string; translations: LabelTranslation[] };
  certificateStatus: {
    id: string;
    name: string;
    abbreviation: string;
    translations: LabelTranslation[];
  } | null;
  format: {
    id: string;
    name: string;
    abbreviation: string;
    translations: LabelTranslation[];
  } | null;
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
 * `areaTitleById`, because its fallback also walks the area roll-up chain.
 *
 * Every field that ends up rendering **untranslated** text is also listed in the copy's `fallbacks`
 * (#298) — the preview marks those tokens, generation itself is unaffected. */
export function toTitleCopy(
  row: TitleCopyRow,
  maps: AreaVendorMaps,
  areaTitleById: ReadonlyMap<string, AreaTitleEntry>,
  language: string | null = null,
  itemNoPad: number = DEFAULT_ITEM_NO_PAD
): TitleTemplateCopy {
  const areas = row.stamp.stampAreaLinks;
  const primaryLink = areas.find((a) => a.isPrimary) ?? areas[0];
  const areaId = primaryLink?.collectionAreaId ?? null;
  const issue = row.stamp.issueMemberships[0]?.issue ?? null;
  // The issue may override its area's catalog prefix (#377), so the vendor lookup is resolved from
  // the pair, not from the area alone.
  const vendorMap = maps.vendorMapFor(areaId, issue?.id ?? null);
  const primaryVendorId = areaId ? (maps.primaryVendorByArea.get(areaId) ?? null) : null;
  const subtype = row.stamp.subtype;
  // The area shown in the title rolls up per its `titleName` config (#210); falls back to the leaf
  // area's own name when nothing is configured up the chain.
  const areaEntry = areaId ? areaTitleById.get(areaId) : undefined;
  const areaTitle = areaId ? (areaEntry?.title ?? primaryLink?.collectionArea.name ?? null) : null;

  const catalogNumbers: TitleCatalogNumber[] = row.stamp.catalogNumbers.map((cn) => {
    const entry = vendorMap.get(cn.catalogVendorId);
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

  // Each translatable field resolves *and* reports whether it fell back; `fallbacks` collects the
  // ones that did, keyed by the `TitleTemplateCopy` field the token renders from and carrying the
  // entity row a missing translation would be written on (#299).
  const fallbacks: TitleFallback[] = [];
  const resolve = <T extends { language: string }>(
    field: string,
    entity: { type: TranslatableEntity; id: string; field: string },
    rows: readonly T[] | undefined,
    pick: (row: T) => string | null | undefined,
    fallback: string | null
  ): string | null => {
    const { value, fellBack } = resolveTranslationWithFallback(rows, language, pick, fallback);
    if (fellBack && value) {
      fallbacks.push({
        field,
        entityType: entity.type,
        entityId: entity.id,
        entityField: entity.field,
        defaultValue: value,
      });
    }
    return value;
  };

  const copy: TitleTemplateCopy = {
    name: resolve(
      "name",
      { type: "stamp", id: row.stamp.id, field: "name" },
      row.stamp.translations,
      (t: NameTranslation) => t.name,
      row.stamp.name
    ),
    catalogNumbers,
    year: row.stamp.issuedYear,
    condition: resolve(
      "condition",
      { type: "condition", id: row.condition.id, field: "name" },
      row.condition.translations,
      (t: LabelTranslation) => t.name,
      row.condition.name
    ),
    conditionAbbr: resolve(
      "conditionAbbr",
      { type: "condition", id: row.condition.id, field: "abbreviation" },
      row.condition.translations,
      (t: LabelTranslation) => t.abbreviation,
      row.condition.abbreviation
    ),
    certificate: row.certificateStatus
      ? resolve(
          "certificate",
          { type: "certificateStatus", id: row.certificateStatus.id, field: "name" },
          row.certificateStatus.translations,
          (t: LabelTranslation) => t.name,
          row.certificateStatus.name
        )
      : null,
    certificateAbbr: row.certificateStatus
      ? resolve(
          "certificateAbbr",
          { type: "certificateStatus", id: row.certificateStatus.id, field: "abbreviation" },
          row.certificateStatus.translations,
          (t: LabelTranslation) => t.abbreviation,
          row.certificateStatus.abbreviation
        )
      : null,
    // A single has no format row at all, so both tokens resolve null and the tidy pass removes
    // whatever separator was gluing them in (#345). Unlike the subtype there is no "default" row to
    // suppress here: null *is* the unmarked case (ADR-0020).
    format: row.format
      ? resolve(
          "format",
          { type: "format", id: row.format.id, field: "name" },
          row.format.translations,
          (t: LabelTranslation) => t.name,
          row.format.name
        )
      : null,
    formatAbbr: row.format
      ? resolve(
          "formatAbbr",
          { type: "format", id: row.format.id, field: "abbreviation" },
          row.format.translations,
          (t: LabelTranslation) => t.abbreviation,
          row.format.abbreviation
        )
      : null,
    area: areaTitle,
    location: row.location?.name ?? null,
    ref: row.locationRef ?? null,
    // Not translatable and not an entity — plain digits, so it never joins the fallback machinery.
    itemNo: row.itemNo,
    itemNoPad,
    issueName: issue
      ? resolve(
          "issueName",
          { type: "issue", id: issue.id, field: "name" },
          issue.translations,
          (t: NameTranslation) => t.name,
          issue.name
        )
      : null,
    issueYear: issue?.year ?? null,
    // The **default** subtype is the unmarked case and renders nothing (#339): a listing should not
    // read "Mercury Variant" for every ordinary variant. It is skipped before `resolve` rather than
    // blanked after, so a missing translation on it is never reported as a gap to fill — there is no
    // token output to translate. A base stamp has no subtype row at all.
    subtype:
      subtype && !subtype.isDefault
        ? resolve(
            "subtype",
            { type: "subtype", id: subtype.id, field: "name" },
            subtype.translations,
            (t: NameTranslation) => t.name,
            subtype.name
          )
        : null,
  };
  // `{area}` is resolved by the roll-up walk rather than `resolve`, so it reports separately — and
  // against the area the winning name came from, which may be an ancestor of the copy's own (#299).
  if (areaTitle && areaEntry?.fellBack) {
    fallbacks.push({
      field: "area",
      entityType: "area",
      entityId: areaEntry.sourceAreaId,
      entityField: "titleName",
      defaultValue: areaTitle,
    });
  }
  return fallbacks.length > 0 ? { ...copy, fallbacks } : copy;
}

/** Build a row→`TitleTemplateCopy` mapper for a collection, loading its area-vendor maps once (they
 * resolve per-area catalog prefixes and primary vendors with ancestor inheritance). Owner-scoped via
 * {@link getCollectionAreas}. Callers fetch their own rows with {@link TITLE_COPY_SELECT} and map.
 *
 * `language` (#293) is the listing language of the platform the title is generated for — an ISO
 * 639-1 code, or null for the default language. Entity text resolves to that language where a
 * translation exists and falls back to the default value otherwise; the fallback is silent in the
 * generated title and reported per copy for the preview to flag (#298). Every translatable token
 * honours it: `{area}` (#293), `{condition}` / `{conditionAbbr}` / `{certificate}` /
 * `{certificateAbbr}` (#294), `{issueName}` (#295), `{name}` (#296), `{subtype}` (#338/#339) and
 * `{format}` / `{formatAbbr}` (#344/#345).
 *
 * A language equal to the collection's own `defaultLanguage` is the same thing as no language —
 * entity columns are already written in it and carry no translation rows — so it is normalised to
 * null. Without that, a platform listing in the default language would resolve identically but
 * report *every* token as a fallback. */
export async function makeTitleCopyMapper(
  ownerId: string,
  collectionId: string,
  language: string | null = null
): Promise<(row: TitleCopyRow) => TitleTemplateCopy> {
  const [areas, issuePrefixes, collection] = await Promise.all([
    getCollectionAreas(ownerId, collectionId),
    loadIssuePrefixMap(collectionId),
    prisma.collection.findUnique({
      where: { id: collectionId },
      select: { defaultLanguage: true, itemNoPad: true },
    }),
  ]);
  const code = normalizeLanguage(language);
  const effective = code && code !== normalizeLanguage(collection?.defaultLanguage) ? code : null;
  const maps = buildAreaVendorMaps(areas, issuePrefixes);
  const areaTitleById = buildAreaTitleEntries(areas, effective);
  const itemNoPad = collection?.itemNoPad ?? DEFAULT_ITEM_NO_PAD;
  return (row) => toTitleCopy(row, maps, areaTitleById, effective, itemNoPad);
}
