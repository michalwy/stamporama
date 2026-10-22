import type { CollectionAreaData } from "./areas";
import { areaOwnTitleName } from "./area-vendor";

// The title Generate offers suggests for the new post its offers go into (#2105), before the
// collector types one. Pure — no React, no Prisma — so the rule is pinned by tests rather than by a
// comment inside the dialog.

/** What the suggestion reads off one copy: the Copies list row's own fields. */
export interface PostTitleCopy {
  areaId: string | null;
  issueYear: number | null;
  /** The stamps of a piece of several (#748); empty for an ordinary copy. */
  carriedStamps: { areaId: string | null; issues: { year: number | null }[] }[];
}

/**
 * A span of years the way a post title writes it: one year alone, a span within one century with
 * the end's last two digits (`1940–44`), across a century in full (`1998–2003`). Empty with no year.
 */
export function postYearSpan(years: readonly number[]): string {
  if (years.length === 0) return "";
  const min = Math.min(...years);
  const max = Math.max(...years);
  if (min === max) return String(min);
  if (Math.floor(min / 100) === Math.floor(max / 100)) return `${min}–${String(max % 100).padStart(2, "0")}`;
  return `${min}–${max}`;
}

/** The area and its ancestors, root first; empty for an id naming no area. */
function rootPath(byId: ReadonlyMap<string, CollectionAreaData>, areaId: string): string[] {
  const path: string[] = [];
  let current = byId.get(areaId);
  while (current && path.length < 50) {
    path.unshift(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/**
 * The suggested title for a post of `copies`: **the deepest area holding every one of them** — at any
 * level, a top-level area included (settled with the collector on 2026-10-22) — and **the span of their
 * issues' years**, `Generalgouvernement 1940–44`. Every stamp counts: a piece of several is held by an
 * area only when each stamp on it is. The area is named in the collection's default language, by its
 * own name rather than one rolled up from a parent (`areaOwnTitleName`), since the area was found by
 * what the copies share.
 *
 * With no shared area the title is the years alone; with no years either it is empty, and the field is
 * filled by hand, as before the suggestion.
 */
export function suggestGeneratorPostTitle(areas: CollectionAreaData[], copies: readonly PostTitleCopy[]): string {
  const stamps = copies.flatMap((copy) =>
    copy.carriedStamps.length > 0
      ? copy.carriedStamps.map((stamp) => ({ areaId: stamp.areaId, year: stamp.issues[0]?.year ?? null }))
      : [{ areaId: copy.areaId, year: copy.issueYear }]
  );
  const years = stamps.flatMap((stamp) => (typeof stamp.year === "number" ? [stamp.year] : []));

  const byId = new Map(areas.map((area) => [area.id, area]));
  let shared: string[] | null = null;
  for (const stamp of stamps) {
    const path = stamp.areaId ? rootPath(byId, stamp.areaId) : [];
    if (shared === null) {
      shared = path;
    } else {
      let common = 0;
      while (common < shared.length && common < path.length && shared[common] === path[common]) common++;
      shared = shared.slice(0, common);
    }
    if (shared.length === 0) break;
  }
  const deepest = shared?.at(-1);
  const areaName = deepest ? (areaOwnTitleName(areas, deepest, null)?.trim() ?? "") : "";

  return [areaName, postYearSpan(years)].filter(Boolean).join(" ");
}
