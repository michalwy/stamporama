/**
 * What the Colnect page's summary strip says (#1480), and which attribute list its Attributes tab
 * shows — kept apart from the components so both can be tested without rendering anything.
 *
 * Four tiles, one per tab: the catalogs mapped, the conditions mapped out of all, the attribute
 * values still without a Colnect word, and the lists set to sync. Nothing is flagged: an unmapped
 * condition or value is a legitimate answer (a grade never listed on Colnect, a colour Colnect has no
 * word for), and the listing checks and the Assistant report it where it matters.
 *
 * **The unmapped attribute figure is the Attributes tab's own count** — both are
 * `unmappedAttributeCount` — and its tile opens that tab narrowed to those values.
 */

import type { ColnectConditionMappingData, ColnectMappingData } from "@/lib/colnect";
import type { ColnectListMappingData } from "@/lib/colnect-list-sync";
import type { StampAttributeData, StampAttributeLists } from "@/lib/stamp-attributes";
import { STAMP_ATTRIBUTE_KINDS, type StampAttributeKind } from "@/lib/stamp-attribute-kinds";

/** The Colnect page's tabs, in the order the setup happens in; the first is the default. */
export const COLNECT_SETTINGS_PARTS = [
  { key: "catalogs", label: "Catalogs" },
  { key: "conditions", label: "Conditions" },
  { key: "attributes", label: "Attributes" },
  { key: "lists", label: "List sync" },
] as const;

export type ColnectSettingsPart = (typeof COLNECT_SETTINGS_PARTS)[number]["key"];

/** The Attributes tab's list — `&kind=paper` — so a link or a reload opens the same one. */
export const COLNECT_KIND_PARAM = "kind";

/** The Attributes tab narrowed to the values still without a Colnect word — `&unmapped=1`. */
export const COLNECT_UNMAPPED_PARAM = "unmapped";

/** The address parameters that belong to the Attributes tab alone, dropped on leaving it. */
export const COLNECT_VIEW_PARAMS = [COLNECT_KIND_PARAM, COLNECT_UNMAPPED_PARAM] as const;

/** A value with no Colnect word yet — a blank field is the unmapped state. */
export function isUnmappedAttribute(row: StampAttributeData): boolean {
  return !row.colnectValue?.trim();
}

/** How many of one list's values, or of all four, still have no Colnect word. */
export function unmappedAttributeCount(
  lists: StampAttributeLists,
  kind?: StampAttributeKind
): number {
  const kinds: readonly StampAttributeKind[] = kind ? [kind] : STAMP_ATTRIBUTE_KINDS;
  return kinds.reduce((n, k) => n + lists[k].filter(isUnmappedAttribute).length, 0);
}

export interface ColnectAttributeView {
  /** The lists that have any values — the kinds the tab offers. Empty when none has. */
  kinds: StampAttributeKind[];
  /** The list shown, or null when there is none to show. */
  kind: StampAttributeKind | null;
  unmappedOnly: boolean;
  /** The shown list's rows, narrowed when `unmappedOnly`. */
  rows: StampAttributeData[];
}

/**
 * Which list the Attributes tab shows, **one at a time** (#1480). A kind named in the address is
 * kept when it has values; otherwise the first that has — and, narrowed to the unmapped, the first
 * that still has some, so the tile's way in never opens on a list with nothing left to do.
 */
export function colnectAttributeView(
  lists: StampAttributeLists,
  kindParam: string | null,
  unmappedOnly: boolean
): ColnectAttributeView {
  const kinds = STAMP_ATTRIBUTE_KINDS.filter((k) => lists[k].length > 0);
  const named = kinds.find((k) => k === kindParam);
  const kind =
    named ??
    (unmappedOnly ? kinds.find((k) => unmappedAttributeCount(lists, k) > 0) : undefined) ??
    kinds[0] ??
    null;
  const rows = kind
    ? unmappedOnly
      ? lists[kind].filter(isUnmappedAttribute)
      : lists[kind]
    : [];
  return { kinds, kind, unmappedOnly, rows };
}

export interface ColnectSummaryTile {
  part: ColnectSettingsPart;
  title: string;
  figure: string;
  /** A second, muted line, or null. */
  detail: string | null;
  /** Extra address parameters the tile opens its tab with — the attributes' narrowing. */
  view?: Readonly<Record<string, string>>;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** At most this many names on a detail line; the rest are counted. */
const DETAIL_NAMES = 3;

function names(list: readonly string[]): string {
  if (list.length <= DETAIL_NAMES) return list.join(", ");
  return `${list.slice(0, DETAIL_NAMES).join(", ")} and ${list.length - DETAIL_NAMES} more`;
}

export function colnectSummary(
  catalogs: readonly ColnectMappingData[],
  conditions: readonly ColnectConditionMappingData[],
  attributes: StampAttributeLists,
  lists: readonly ColnectListMappingData[]
): ColnectSummaryTile[] {
  // A catalog whose abbreviation is Colnect's own needs no row, so the figure is the exceptions and
  // the line under it says the rest already match.
  const catalogTile: ColnectSummaryTile = {
    part: "catalogs",
    title: "Catalogs",
    figure:
      catalogs.length > 0 ? count(catalogs.length, "catalog mapped", "catalogs mapped") : "None mapped",
    detail:
      catalogs.length > 0
        ? names(catalogs.map((m) => `${m.colnectAbbrev} → ${m.vendorAbbreviation}`))
        : "Same abbreviations match themselves",
  };

  const unmappedConditions = conditions.filter((c) => !c.colnectValue);
  const conditionTile: ColnectSummaryTile = {
    part: "conditions",
    title: "Conditions",
    figure:
      conditions.length > 0
        ? `${conditions.length - unmappedConditions.length} of ${conditions.length} mapped`
        : "No conditions yet",
    detail:
      unmappedConditions.length > 0
        ? `Not mapped: ${names(unmappedConditions.map((c) => c.conditionAbbreviation))}`
        : null,
  };

  const values = STAMP_ATTRIBUTE_KINDS.reduce((n, k) => n + attributes[k].length, 0);
  const unmapped = unmappedAttributeCount(attributes);
  const attributeTile: ColnectSummaryTile = {
    part: "attributes",
    title: "Attributes",
    figure:
      values === 0
        ? "No values yet"
        : unmapped > 0
          ? count(unmapped, "value without a Colnect word", "values without a Colnect word")
          : "All mapped",
    detail: values > 0 ? `of ${count(values, "value", "values")}` : null,
    view: unmapped > 0 ? { [COLNECT_UNMAPPED_PARAM]: "1" } : undefined,
  };

  const synced = lists.filter((l) => l.enabled);
  const listTile: ColnectSummaryTile = {
    part: "lists",
    title: "List sync",
    figure: synced.length > 0 ? `${synced.length} of ${lists.length} synced` : "None synced",
    detail: synced.length > 0 ? names(synced.map((l) => l.label)) : null,
  };

  return [catalogTile, conditionTile, attributeTile, listTile];
}
