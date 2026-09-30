/**
 * What the Delcampe page's summary strip says (#1479), kept apart from the components so it can be
 * tested without rendering anything — `allegro-summary.ts`'s shape, for the page designed beside it
 * in #1465.
 *
 * Two tiles, one per tab: the listing profiles (how many, which is the default) and the categories
 * (how many kinds of stamp are mapped, and whether Delcampe's own list has been read here and when).
 * **Nothing is flagged**: Delcampe has no connection to lose, and the design asked the strip to state
 * these, not to raise them.
 */

import type { DelcampeListingProfileList } from "@/lib/delcampe-listing-profile";
import type { DelcampeLearnedCategoryList } from "@/lib/delcampe-categories";

/** The Delcampe page's tabs, in their order; the first is the default. */
export const DELCAMPE_SETTINGS_PARTS = [
  { key: "profiles", label: "Listing profiles" },
  { key: "categories", label: "Categories" },
] as const;

export type DelcampeSettingsPart = (typeof DELCAMPE_SETTINGS_PARTS)[number]["key"];

export interface DelcampeSummaryTile {
  part: DelcampeSettingsPart;
  title: string;
  figure: string;
  /** A second, muted line, or null. */
  detail: string | null;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Said on a tile while no platform is Delcampe — its profiles and mappings hang off one. */
export const NO_DELCAMPE_PLATFORM = "Platform not chosen";

/**
 * The state of Delcampe's own category list in a line. A list read here is dated by that pass; the
 * snapshot a release ships with is not a reading at all, and says so rather than borrowing its date.
 */
export function delcampeCatalogWords(
  catalog: DelcampeLearnedCategoryList["catalog"],
  formatDate: (iso: string) => string
): string {
  if (catalog.source === "bundled") return "Delcampe’s list not read here yet";
  return catalog.lastRefreshedAt
    ? `Delcampe’s list read ${formatDate(catalog.lastRefreshedAt)}`
    : "Delcampe’s list read, date unknown";
}

export function delcampeSummary(
  profiles: DelcampeListingProfileList,
  categories: DelcampeLearnedCategoryList,
  formatDate: (iso: string) => string
): DelcampeSummaryTile[] {
  const defaultProfile = profiles.profiles.find((p) => p.isDefault) ?? null;
  const profileTile: DelcampeSummaryTile = {
    part: "profiles",
    title: "Listing profiles",
    figure: profiles.platformId
      ? count(profiles.profiles.length, "profile", "profiles")
      : NO_DELCAMPE_PLATFORM,
    detail: !profiles.platformId
      ? null
      : defaultProfile
        ? `Default: ${defaultProfile.name}`
        : profiles.profiles.length > 0
          ? "No default"
          : null,
  };

  // The catalogue is the instance's, not the platform's, so its line stands with no platform too —
  // it is the thing an instance being set up needs first.
  const categoryTile: DelcampeSummaryTile = {
    part: "categories",
    title: "Categories",
    figure: categories.platformId
      ? count(categories.lessons.length, "kind of stamp mapped", "kinds of stamp mapped")
      : NO_DELCAMPE_PLATFORM,
    detail: delcampeCatalogWords(categories.catalog, formatDate),
  };

  return [profileTile, categoryTile];
}
