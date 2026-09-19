import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUCTION_SALE_VIEW_DEFAULTS,
  AUCTION_SALE_VIEW_PARAMS,
  auctionSaleViewClearUpdates,
  auctionSaleViewNarrowings,
  auctionSaleViewNarrowsLots,
  auctionSaleViewUpdatesFor,
  auctionSaleViewUrlUpdates,
  resolveAuctionSaleView,
  type AuctionSaleView,
} from "../../src/app/c/[collectionSlug]/auctions/sales/[saleId]/sale-view-params";

/**
 * The toolbar over an auction sale's lots (#1353) — what it is called in the address, what survives
 * a reload, and which of its settings are *narrowing* the parcel rather than merely arranging it.
 *
 * The regression these guard is the one the collector reported: a screen that comes back only half
 * as it was left. Four of the ten settings were remembered in `localStorage`, the other six were
 * component state, and nothing was in the URL — so a reload restored the grouping and the sort and
 * silently dropped every filter. `every` below is typed `Required<AuctionSaleView>`, so a control
 * added to the toolbar fails to compile here until it has been given a name, and then fails loudly
 * until it is serialised and classified.
 */
describe("auction sale view params (#1353)", () => {
  const every: Required<AuctionSaleView> = {
    signal: "outbid",
    outcome: "won",
    group: "none",
    byIssue: true,
    unpriced: true,
    noPhoto: true,
    unknownVariant: true,
    notDescribed: true,
    sortKey: "year",
    sortDir: "desc",
  };

  /** A reader over a plain object, standing in for `usePersistedFilterParams`' own. */
  const reader = (params: Record<string, string>) => (key: string) => params[key] ?? null;

  it("gives every setting a name in the address", () => {
    const updates = auctionSaleViewUpdatesFor(every);
    assert.equal(
      Object.keys(updates).length,
      Object.keys(every).length,
      "a setting is missing from the address"
    );
    for (const param of Object.keys(updates)) {
      assert.ok(AUCTION_SALE_VIEW_PARAMS.includes(param), `${param} is not a tracked param`);
    }
    assert.equal(AUCTION_SALE_VIEW_PARAMS.length, Object.keys(every).length);
  });

  it("reads back exactly what it wrote", () => {
    // With the grouping flattened, *not described* cannot be in force — the one asymmetry, checked
    // in its own test below. Everything else survives the round trip verbatim.
    const written = auctionSaleViewUpdatesFor({ ...every, group: "lot" });
    const back = resolveAuctionSaleView(reader(written));
    assert.deepEqual(back, { ...every, group: "lot" });
  });

  it("writes nothing for a setting at its default, so an untouched parcel keeps a clean address", () => {
    const updates = auctionSaleViewUpdatesFor(AUCTION_SALE_VIEW_DEFAULTS);
    assert.deepEqual(
      Object.values(updates).filter(Boolean),
      [],
      "a default reached the address bar"
    );
    assert.deepEqual(resolveAuctionSaleView(() => null), AUCTION_SALE_VIEW_DEFAULTS);
  });

  it("names only the settings it was handed, so one press does not drag the rest into the URL", () => {
    assert.deepEqual(auctionSaleViewUpdatesFor({ noPhoto: true }), { noPhoto: "1" });
    // Switching a filter off writes `""`, which is how the funnel deletes it from both homes. A
    // press that simply omitted the key would leave the stored copy to be read straight back.
    assert.deepEqual(auctionSaleViewUpdatesFor({ noPhoto: false }), { noPhoto: "" });
  });

  it("falls back to the default on a value nothing recognises, rather than showing an empty parcel", () => {
    const view = resolveAuctionSaleView(
      reader({ signal: "beaten", outcome: "maybe", sort: "colour", dir: "sideways", group: "grid" })
    );
    assert.equal(view.signal, undefined);
    assert.equal(view.outcome, undefined);
    assert.equal(view.sortKey, "added");
    assert.equal(view.sortDir, "asc");
    assert.equal(view.group, "lot");
  });

  describe("'not described' is a lot filter among line filters", () => {
    it("is not in force with the lots off the screen, however the address got that way", () => {
      const flat = resolveAuctionSaleView(reader({ group: "none", undescribed: "1" }));
      assert.equal(flat.notDescribed, false, "a hand-edited link got round the rule");
      // Its three neighbours are about lines and are unaffected by the grouping.
      assert.equal(
        resolveAuctionSaleView(reader({ group: "none", noPhoto: "1" })).noPhoto,
        true
      );
    });

    it("is cleared outright when the grouping is switched off", () => {
      // Not merely ignored: left in the address and the memory it would come back unannounced the
      // moment the collector grouped by lot again.
      assert.deepEqual(auctionSaleViewUpdatesFor({ group: "none" }), {
        group: "none",
        undescribed: "",
      });
      // Grouping back on says nothing about it, so it stays off.
      assert.deepEqual(auctionSaleViewUpdatesFor({ group: "lot" }), { group: "" });
    });
  });

  describe("what narrows, and what only arranges", () => {
    it("announces every filter in force", () => {
      const narrowings = auctionSaleViewNarrowings({ ...every, group: "lot" });
      assert.deepEqual(
        narrowings.map((n) => n.key),
        ["signal", "outcome", "unpriced", "noPhoto", "unknownVariant", "notDescribed"]
      );
      assert.equal(narrowings.find((n) => n.key === "signal")?.value, "outbid");
    });

    it("says nothing about grouping or sorting, which hide nothing", () => {
      const arranged: AuctionSaleView = {
        ...AUCTION_SALE_VIEW_DEFAULTS,
        group: "none",
        byIssue: true,
        sortKey: "price",
        sortDir: "desc",
      };
      assert.deepEqual(auctionSaleViewNarrowings(arranged), []);
      assert.equal(auctionSaleViewNarrowsLots(arranged), false);
    });

    it("counts lots only where a filter actually takes one off the screen", () => {
      const lines = { ...AUCTION_SALE_VIEW_DEFAULTS, noPhoto: true, unpriced: true };
      assert.equal(auctionSaleViewNarrowsLots(lines), false);
      assert.equal(auctionSaleViewNarrowings(lines).length, 2, "still narrowed, just not by lot");
      assert.equal(
        auctionSaleViewNarrowsLots({ ...AUCTION_SALE_VIEW_DEFAULTS, notDescribed: true }),
        true
      );
      assert.equal(
        auctionSaleViewNarrowsLots({ ...AUCTION_SALE_VIEW_DEFAULTS, signal: "leading" }),
        true
      );
    });

    it("clears exactly what it announces, and leaves the arrangement alone", () => {
      const cleared = auctionSaleViewClearUpdates();
      const announced = auctionSaleViewUpdatesFor({ ...every, group: "lot" });
      // Every narrowing filter is cleared…
      for (const { key } of auctionSaleViewNarrowings({ ...every, group: "lot" })) {
        const param = Object.keys(auctionSaleViewUpdatesFor({ [key]: every[key] } as Partial<AuctionSaleView>))[0];
        assert.ok(param in cleared, `${key} is announced but never cleared`);
      }
      // …and nothing else is touched, so a collector who clears the filters keeps his grouping and
      // his sort order.
      for (const param of ["group", "byIssue", "sort", "dir"]) {
        assert.ok(param in announced, `${param} is not a tracked param any more`);
        assert.ok(!(param in cleared), `${param} must survive Clear filters`);
      }
      // What is cleared stays cleared when read back.
      assert.deepEqual(resolveAuctionSaleView(reader(cleared)), AUCTION_SALE_VIEW_DEFAULTS);
    });
  });

  describe("the restore's other half — writing the view back into the address (#844)", () => {
    it("leaves a parcel nobody narrowed with a clean address", () => {
      assert.equal(auctionSaleViewUrlUpdates(AUCTION_SALE_VIEW_DEFAULTS, () => null), null);
    });

    it("writes a restored setting the address does not carry", () => {
      const restored: AuctionSaleView = { ...AUCTION_SALE_VIEW_DEFAULTS, signal: "outbid" };
      assert.deepEqual(auctionSaleViewUrlUpdates(restored, () => null), { signal: "outbid" });
    });

    it("writes once and then stands still", () => {
      const restored: AuctionSaleView = { ...AUCTION_SALE_VIEW_DEFAULTS, signal: "outbid" };
      assert.equal(auctionSaleViewUrlUpdates(restored, reader({ signal: "outbid" })), null);
    });

    it("never clears — a filter switched off leaves the URL through the press itself", () => {
      // A stale param the view does not carry is not this function's to delete: doing so would race
      // the write that switched the filter off, and it is that write which removes it.
      const view: AuctionSaleView = { ...AUCTION_SALE_VIEW_DEFAULTS, noPhoto: true };
      const updates = auctionSaleViewUrlUpdates(view, reader({ noPhoto: "1", signal: "leading" }));
      assert.equal(updates, null);
      assert.deepEqual(
        auctionSaleViewUrlUpdates({ ...view, unpriced: true }, reader({ noPhoto: "1" })),
        { unpriced: "1" }
      );
    });
  });
});
