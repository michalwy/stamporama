import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  DelcampeListingProfileData,
  DelcampeListingProfileList,
} from "../../src/lib/delcampe-listing-profile";
import type { DelcampeLearnedCategoryList } from "../../src/lib/delcampe-categories";
import type { PlatformCategoryLessonRow } from "../../src/lib/platform-category";
import { DELCAMPE_PROFILE_DEFAULTS } from "../../src/lib/delcampe-listing-profile-rules";
import {
  DELCAMPE_SETTINGS_PARTS,
  NO_DELCAMPE_PLATFORM,
  delcampeCatalogWords,
  delcampeSummary,
} from "../../src/app/c/[collectionSlug]/settings/delcampe-summary";

/**
 * The Delcampe page's summary strip (#1479): one tile per tab — the listing profiles and the
 * categories — each saying where its tab stands, and the state of Delcampe's own list stated with
 * or without a platform, since it is the instance's rather than the platform's.
 */

const date = (iso: string) => `on ${iso.slice(0, 10)}`;

function profile(name: string, isDefault = false): DelcampeListingProfileData {
  return {
    ...DELCAMPE_PROFILE_DEFAULTS,
    id: name,
    platformId: "p",
    name,
    shippingModel: "Fee template",
    isDefault,
  };
}

function profiles(list: DelcampeListingProfileData[], platformId: string | null = "p") {
  return {
    platformId,
    platformName: platformId ? "Delcampe" : null,
    profiles: list,
    defaultProfileId: list.find((p) => p.isDefault)?.id ?? null,
  } satisfies DelcampeListingProfileList;
}

function categories(
  lessons: number,
  catalog: DelcampeLearnedCategoryList["catalog"],
  platformId: string | null = "p"
): DelcampeLearnedCategoryList {
  return {
    platformId,
    platformName: platformId ? "Delcampe" : null,
    lessons: Array.from({ length: lessons }, (_, i) => ({ id: `l${i}` }) as PlatformCategoryLessonRow),
    catalog,
  };
}

const READ = { count: 7012, lastRefreshedAt: "2026-09-29T08:00:00.000Z", source: "read" } as const;
const BUNDLED = { count: 6980, lastRefreshedAt: "2026-06-01", source: "bundled" } as const;

describe("Delcampe settings summary (#1479)", () => {
  it("has a tile per tab, in the tabs' order", () => {
    const tiles = delcampeSummary(profiles([]), categories(0, READ), date);
    assert.deepEqual(
      tiles.map((t) => [t.part, t.title]),
      DELCAMPE_SETTINGS_PARTS.map((p) => [p.key, p.label])
    );
  });

  it("counts the profiles and names the default", () => {
    const [tile] = delcampeSummary(
      profiles([profile("Standard letter", true), profile("Heavy lot")]),
      categories(0, READ),
      date
    );
    assert.equal(tile.figure, "2 profiles");
    assert.equal(tile.detail, "Default: Standard letter");
  });

  it("says when profiles have no default, and says nothing more of none", () => {
    assert.equal(
      delcampeSummary(profiles([profile("Standard letter")]), categories(0, READ), date)[0].detail,
      "No default"
    );
    const [none] = delcampeSummary(profiles([]), categories(0, READ), date);
    assert.equal(none.figure, "0 profiles");
    assert.equal(none.detail, null);
  });

  it("counts the kinds of stamp mapped and dates the list read here", () => {
    const [, one] = delcampeSummary(profiles([]), categories(1, READ), date);
    assert.equal(one.figure, "1 kind of stamp mapped");
    assert.equal(one.detail, "Delcampe’s list read on 2026-09-29");
    const [, many] = delcampeSummary(profiles([]), categories(3, READ), date);
    assert.equal(many.figure, "3 kinds of stamp mapped");
  });

  it("does not date the shipped snapshot as if it had been read", () => {
    assert.equal(delcampeCatalogWords(BUNDLED, date), "Delcampe’s list not read here yet");
    assert.equal(
      delcampeCatalogWords({ ...READ, lastRefreshedAt: null }, date),
      "Delcampe’s list read, date unknown"
    );
  });

  it("says the platform is not chosen, and still states the list", () => {
    const [p, c] = delcampeSummary(profiles([], null), categories(0, BUNDLED, null), date);
    assert.equal(p.figure, NO_DELCAMPE_PLATFORM);
    assert.equal(p.detail, null);
    assert.equal(c.figure, NO_DELCAMPE_PLATFORM);
    assert.equal(c.detail, "Delcampe’s list not read here yet");
  });
});
