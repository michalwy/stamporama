import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCollectionPath, isSidebarPinKind, movePinIds } from "../../src/lib/sidebar-pin-rules";
import {
  NAV_SCREENS,
  isNavScreenActive,
  navScreenByPath,
} from "../../src/app/c/[collectionSlug]/nav-entries";
import { sectionForPath } from "../../src/app/c/[collectionSlug]/nav-sections";

// The Pinned section of the sidebar (#2504): the pure rules, and the nav table the sidebar and its
// pinned screens are both drawn from.

const base = "/c/main";

describe("sidebar pin rules (#2504)", () => {
  it("knows its kinds", () => {
    assert.ok(isSidebarPinKind("screen"));
    assert.ok(isSidebarPinKind("purchase"));
    assert.ok(isSidebarPinKind("post"));
    assert.ok(!isSidebarPinKind("stamp"));
  });

  it("accepts only addresses under the collection", () => {
    assert.ok(isCollectionPath("/offers/prepare"));
    assert.ok(isCollectionPath("/purchases/abc"));
    assert.ok(!isCollectionPath("//evil.example"));
    assert.ok(!isCollectionPath("https://evil.example"));
    assert.ok(!isCollectionPath("offers"));
    assert.ok(!isCollectionPath(""));
  });

  it("moves a dragged id to where it was dropped", () => {
    assert.deepEqual(movePinIds(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
    assert.deepEqual(movePinIds(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
    assert.deepEqual(movePinIds(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
    assert.deepEqual(movePinIds(["a", "b"], 5, 0), ["a", "b"]);
  });
});

describe("the nav table (#2504)", () => {
  it("names every screen once", () => {
    const paths = NAV_SCREENS.map((s) => s.path);
    assert.equal(new Set(paths).size, paths.length);
  });

  it("files each entry in the section that owns its route", () => {
    for (const screen of NAV_SCREENS) {
      assert.equal(
        sectionForPath(`${base}${screen.path}`, base),
        screen.section,
        `${screen.label} (${screen.path})`
      );
    }
  });

  it("gives a child its group's icon, so a pinned child is marked", () => {
    assert.equal(navScreenByPath("/offers/prepare")?.icon, "offers");
    assert.equal(navScreenByPath("/offers/posts")?.icon, "marketplaces");
    assert.equal(navScreenByPath("/auctions/sales")?.pinnedLabel, "Auction sales");
  });

  it("lights an entry as the sidebar always has", () => {
    const at = (path: string) =>
      NAV_SCREENS.filter((s) => isNavScreenActive(`${base}${path}`, base, s)).map((s) => s.label);
    assert.deepEqual(at("/offers/abc"), ["Offers"]);
    assert.deepEqual(at("/offers/prepare"), ["Prepare"]);
    assert.deepEqual(at("/auctions"), ["Lots"]);
    assert.deepEqual(at("/auctions/sales/x"), ["Sales"]);
    assert.deepEqual(at(""), ["Overview"]);
    assert.deepEqual(at("/inventory/structure"), ["Collection structure"]);
    assert.deepEqual(at("/stamps/variant-prices"), ["Variant prices"]);
  });
});
