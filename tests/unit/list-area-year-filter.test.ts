import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_SENTINEL,
  areaYearUrlUpdates,
  resolveAreaYearFilter,
  shouldRememberAreaYear,
  type AreaYearFilter,
} from "../../src/lib/list-area-year-filter";

const KNOWN = new Set(["pl", "de"]);

const sources = (over: Partial<Parameters<typeof resolveAreaYearFilter>[0]> = {}) => ({
  urlAreaId: null,
  urlYear: null,
  storedAreaId: null,
  storedYear: null,
  knownAreaIds: KNOWN,
  ...over,
});

describe("shared list area/year filter (#143, #844)", () => {
  describe("which of the two homes wins", () => {
    it("takes the address bar over the remembered choice, so a pasted link means what it says", () => {
      assert.deepEqual(
        resolveAreaYearFilter(
          sources({ urlAreaId: "de", urlYear: "1980", storedAreaId: "pl", storedYear: "1975" })
        ),
        { areaId: "de", year: "1980" }
      );
    });

    it("falls back to the remembered choice for each half the address does not name", () => {
      // The halves are answered independently: a link naming only the year keeps the remembered
      // area, which is what carries a country from one list to the next.
      assert.deepEqual(
        resolveAreaYearFilter(sources({ urlYear: "1980", storedAreaId: "pl", storedYear: "1975" })),
        { areaId: "pl", year: "1980" }
      );
      assert.deepEqual(
        resolveAreaYearFilter(sources({ urlAreaId: "de", storedAreaId: "pl", storedYear: "1975" })),
        { areaId: "de", year: "1975" }
      );
    });

    it("reads an explicit 'all' as a value, not as silence — that is how a filter is switched off", () => {
      // The distinction the sentinel exists for: `areaId=all` must *beat* the remembered area, where
      // an absent parameter defers to it.
      assert.deepEqual(
        resolveAreaYearFilter(
          sources({
            urlAreaId: ALL_SENTINEL,
            urlYear: ALL_SENTINEL,
            storedAreaId: "pl",
            storedYear: "1975",
          })
        ),
        { areaId: null, year: null }
      );
    });

    it("drops an area the collection no longer has, from either home", () => {
      // Nothing on screen could show such a selection — the rail cannot mark a row that is not
      // there — so it would narrow every list to an empty result with no way out of it.
      assert.deepEqual(resolveAreaYearFilter(sources({ urlAreaId: "gone" })), {
        areaId: null,
        year: null,
      });
      assert.deepEqual(resolveAreaYearFilter(sources({ storedAreaId: "gone" })), {
        areaId: null,
        year: null,
      });
    });

    it("keeps a year no facet is currently counting", () => {
      // The counterpart decision, and the reason the two halves are not treated alike: year facets
      // arrive asynchronously and are themselves narrowed by the area in force, so "no such year"
      // is never a thing this can know. Dropping it would widen the list on every load before the
      // facets land.
      assert.deepEqual(resolveAreaYearFilter(sources({ urlAreaId: "pl", urlYear: "1899" })), {
        areaId: "pl",
        year: "1899",
      });
      // "none" — the no-year bucket — is a value like any other and survives the same way.
      assert.deepEqual(resolveAreaYearFilter(sources({ storedYear: "none" })), {
        areaId: null,
        year: "none",
      });
    });
  });

  describe("what the address bar is then made to say", () => {
    const restored: AreaYearFilter = { areaId: "pl", year: "1975" };

    it("writes a restored selection into an address that never named it — the whole of #844", () => {
      // Switching lists restores the filter from memory and leaves the address empty; a reload then
      // has nothing to read back. This is the write that gives it something.
      assert.deepEqual(areaYearUrlUpdates(restored, null, null), {
        areaId: "pl",
        year: "1975",
      });
    });

    it("states both halves once anything is said, so a reload cannot half-fall-back", () => {
      // Naming only the year would leave the area to the memory again on the next load, which is
      // the disagreement the mirror exists to close.
      assert.deepEqual(areaYearUrlUpdates({ areaId: null, year: "1975" }, null, null), {
        areaId: ALL_SENTINEL,
        year: "1975",
      });
      assert.deepEqual(areaYearUrlUpdates({ areaId: "pl", year: null }, "pl", null), {
        areaId: "pl",
        year: ALL_SENTINEL,
      });
    });

    it("writes nothing when the address already describes the screen", () => {
      // The guard that makes the mirror an effect rather than a loop: it must be able to run on
      // every render and write on almost none of them.
      assert.equal(areaYearUrlUpdates(restored, "pl", "1975"), null);
      assert.equal(
        areaYearUrlUpdates({ areaId: null, year: null }, ALL_SENTINEL, ALL_SENTINEL),
        null
      );
    });

    it("leaves an unfiltered list at a clean address", () => {
      // Nothing narrows the list and nothing in the address claims otherwise: opening a list must
      // not put a filter in its URL.
      assert.equal(areaYearUrlUpdates({ areaId: null, year: null }, null, null), null);
    });

    it("retires a parameter naming an area that is gone, rather than leaving the address lying", () => {
      // The retirement case, and the reason the guard asks what has been *said* rather than only
      // what is in force: the selection is empty precisely because the address named something
      // impossible, so an "is anything in force" guard would have left `?areaId=gone` standing over
      // a list showing every area.
      const afterDrop = resolveAreaYearFilter(sources({ urlAreaId: "gone" }));
      assert.deepEqual(areaYearUrlUpdates(afterDrop, "gone", null), {
        areaId: ALL_SENTINEL,
        year: ALL_SENTINEL,
      });
    });

    it("settles after one write, from every starting point", () => {
      // A mirror that did not reach a fixed point would replace the address on every render. Run
      // the write back through the resolver as the browser would and check nothing more is due.
      const starts: [string | null, string | null, string | null, string | null][] = [
        [null, null, "pl", "1975"],
        [null, null, "pl", null],
        [null, null, null, "1975"],
        ["gone", null, null, null],
        ["de", null, "pl", "1975"],
        [ALL_SENTINEL, null, "pl", "1975"],
      ];
      for (const [urlAreaId, urlYear, storedAreaId, storedYear] of starts) {
        const first = resolveAreaYearFilter(
          sources({ urlAreaId, urlYear, storedAreaId, storedYear })
        );
        const updates = areaYearUrlUpdates(first, urlAreaId, urlYear);
        assert.notEqual(updates, null, `expected a write for ${JSON.stringify([urlAreaId, urlYear, storedAreaId, storedYear])}`);
        const nextUrlAreaId = updates!.areaId;
        const nextUrlYear = updates!.year;
        // The address now names both halves, so the memory no longer takes part.
        const second = resolveAreaYearFilter(
          sources({ urlAreaId: nextUrlAreaId, urlYear: nextUrlYear, storedAreaId, storedYear })
        );
        assert.deepEqual(second, first, "the write changed what is on screen");
        assert.equal(
          areaYearUrlUpdates(second, nextUrlAreaId, nextUrlYear),
          null,
          "the mirror did not settle"
        );
      }
    });
  });

  describe("what may be written to the remembered choice", () => {
    it("refuses to write when nothing has been said", () => {
      // The pre-hydration render: the memory reads empty through its server snapshot whether or not
      // anything is stored, so a mirror that wrote here would erase the collector's filter on every
      // reload — the reset #844 reports, one layer below the missing URL.
      assert.equal(shouldRememberAreaYear({ areaId: null, year: null }, null, null), false);
    });

    it("writes a restore back, so the next list opens on the same selection", () => {
      assert.equal(shouldRememberAreaYear({ areaId: "pl", year: null }, null, null), true);
      assert.equal(shouldRememberAreaYear({ areaId: null, year: "1975" }, null, null), true);
    });

    it("writes an explicit 'all' — otherwise the memory hands the filter straight back", () => {
      assert.equal(
        shouldRememberAreaYear({ areaId: null, year: null }, ALL_SENTINEL, ALL_SENTINEL),
        true
      );
    });
  });
});
