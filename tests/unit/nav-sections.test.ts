import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SECTION_TINTS,
  sectionForPath,
  sectionTintForHref,
} from "../../src/app/c/[collectionSlug]/nav-sections";
import { RECENT_ENTITY_LABELS, type RecentEntityKind } from "../../src/lib/recent-entities";

const base = "/c/main";

describe("sectionForPath", () => {
  it("files Areas under Catalog, at its unchanged address (#1234)", () => {
    assert.equal(sectionForPath(`${base}/areas`, base), "catalog");
  });

  it("keeps the rest of Collection where it was", () => {
    for (const route of ["/inventory", "/locations", "/albums"]) {
      assert.equal(sectionForPath(`${base}${route}`, base), "collection");
    }
  });
});

describe("sectionTintForHref", () => {
  // The address each detail screen records its visit under — one per kind the Recent list holds.
  const recordedHref: Record<RecentEntityKind, string> = {
    item: `${base}/inventory/i1`,
    stamp: `${base}/stamps/s1`,
    issue: `${base}/issues/is1`,
    offer: `${base}/offers/o1`,
    purchase: `${base}/purchases/p1`,
    sale: `${base}/sales/s1`,
    auctionSale: `${base}/auctions/sales/a1`,
    trade: `${base}/trades/t1`,
  };

  it("gives every kind the Recent list holds the tint of the section it comes from", () => {
    const expected: Record<RecentEntityKind, keyof typeof SECTION_TINTS> = {
      item: "collection",
      stamp: "catalog",
      issue: "catalog",
      offer: "selling",
      purchase: "buying",
      sale: "selling",
      auctionSale: "buying",
      trade: "partners",
    };
    for (const kind of Object.keys(RECENT_ENTITY_LABELS) as RecentEntityKind[]) {
      assert.equal(
        sectionTintForHref(recordedHref[kind], base),
        SECTION_TINTS[expected[kind]],
        kind
      );
    }
  });

  it("reads the tint from the navigation's own table, not a copy of it", () => {
    assert.equal(sectionTintForHref(`${base}/trades/t1`, base), SECTION_TINTS.partners);
    assert.equal(sectionTintForHref(`${base}/areas`, base), SECTION_TINTS.catalog);
  });

  it("ignores a query or a fragment on the link", () => {
    assert.equal(sectionTintForHref(`${base}/offers/o1?tab=lines#x`, base), SECTION_TINTS.selling);
  });

  it("answers null for a link that lands in no section", () => {
    assert.equal(sectionTintForHref(base, base), null);
    assert.equal(sectionTintForHref(`${base}/settings`, base), null);
    assert.equal(sectionTintForHref("/c/other/offers/o1", base), null);
  });
});
