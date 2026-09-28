import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  albumChapterRuns,
  albumScreenSummary,
  albumScreenViewQuery,
  cardMatchesFilter,
  entryChapterKey,
  NO_ATTENTION,
  parseAlbumScreenView,
  sheetMatchesFilter,
  type AlbumSheetAttention,
} from "../../src/lib/album-screen-view";
import { albumBoxFlag } from "../../src/lib/album-box-flag";

const flags = (a: Partial<AlbumSheetAttention> = {}): AlbumSheetAttention => ({ ...NO_ATTENTION, ...a });
const params = (qs: string) => new URLSearchParams(qs);

describe("albumChapterRuns", () => {
  it("groups runs of one year, as the plan's chapters are runs and not buckets", () => {
    const runs = albumChapterRuns(["1938", "1938", "1939", "1938", ""], (k) => k);
    assert.deepEqual(
      runs.map((r) => [r.id, r.key, r.items.length]),
      [
        ["1938", "1938", 2],
        ["1939", "1939", 1],
        ["1938~2", "1938", 1],
        ["none", "", 1],
      ]
    );
  });

  it("keys an entry as the planner does", () => {
    assert.equal(entryChapterKey({ year: 1938 }), "1938");
    assert.equal(entryChapterKey({ year: null }), "");
  });
});

describe("the address", () => {
  it("falls back to Sheets, all, and everything open", () => {
    const view = parseAlbumScreenView(params(""));
    assert.equal(view.tab, "sheets");
    assert.equal(view.sheets, "all");
    assert.equal(view.cards, "all");
    assert.equal(view.closed.size, 0);
  });

  it("ignores a value it does not know rather than landing nowhere", () => {
    const view = parseAlbumScreenView(params("tab=albums&sheets=wanted&cards=x"));
    assert.equal(view.tab, "sheets");
    assert.equal(view.sheets, "all");
    assert.equal(view.cards, "all");
  });

  it("round-trips, leaves the defaults out and keeps what it does not own", () => {
    const view = parseAlbumScreenView(params("tab=printed&cards=diverged&closed=1939,1938~2"));
    assert.deepEqual([...view.closed].sort(), ["1938~2", "1939"]);
    const qs = albumScreenViewQuery(view, "other=1");
    assert.deepEqual(Object.fromEntries(params(qs)), {
      other: "1",
      tab: "printed",
      cards: "diverged",
      closed: "1938~2,1939",
    });
    assert.equal(albumScreenViewQuery(parseAlbumScreenView(params(qs)), ""), qs.replace("other=1&", ""));
    assert.equal(albumScreenViewQuery(parseAlbumScreenView(params("")), ""), "");
  });
});

describe("filters", () => {
  const live = { printed: false, attention: flags() };
  const flagged = { printed: false, attention: flags({ untranslated: 1 }) };
  const card = { printed: true, attention: flags() };

  it("narrows the sheets", () => {
    const all = [live, flagged, card];
    assert.deepEqual(all.filter((s) => sheetMatchesFilter(s, "all")), all);
    assert.deepEqual(all.filter((s) => sheetMatchesFilter(s, "attention")), [flagged]);
    assert.deepEqual(all.filter((s) => sheetMatchesFilter(s, "live")), [live, flagged]);
    assert.deepEqual(all.filter((s) => sheetMatchesFilter(s, "printed")), [card]);
  });

  it("narrows the cards to the ones the report says differ", () => {
    assert.equal(cardMatchesFilter({ divergences: [] }, "diverged"), false);
    assert.equal(cardMatchesFilter({ divergences: [{}] }, "diverged"), true);
    assert.equal(cardMatchesFilter({ divergences: [] }, "all"), true);
  });
});

describe("albumScreenSummary", () => {
  it("adds up the rows' own figures, so the strip cannot disagree with them", () => {
    const summary = albumScreenSummary(
      [{ year: 1940 }, { year: 1938 }, { year: 1938 }, { year: null }],
      [
        { printed: false, attention: flags({ inherited: 2, oversize: 1 }) },
        { printed: false, attention: flags({ untranslated: 3, unmeasured: 1 }) },
        { printed: false, attention: flags() },
        { printed: true, attention: flags() },
      ],
      [{ divergences: [] }, { divergences: [{}, {}] }]
    );
    assert.equal(summary.entries, 4);
    assert.equal(summary.chapters, 3);
    assert.deepEqual(summary.years, { from: 1938, to: 1940 });
    assert.equal(summary.sheets, 4);
    assert.equal(summary.live, 3);
    assert.equal(summary.printed, 1);
    assert.deepEqual(summary.attention, { unmeasured: 1, oversize: 1, inherited: 2, untranslated: 3 });
    assert.equal(summary.attentionSheets, 2);
    assert.equal(summary.cards, 2);
    assert.equal(summary.divergedCards, 1);
  });

  it("has no years for an album with none", () => {
    assert.equal(albumScreenSummary([{ year: null }], [], []).years, null);
  });
});

describe("albumBoxFlag", () => {
  it("names one flag per box, the one worth reading first", () => {
    assert.equal(albumBoxFlag({ sizeSource: null, stripLabel: null, adjustment: null }), "unmeasured");
    assert.equal(albumBoxFlag({ sizeSource: "inherited", stripLabel: null, adjustment: null }), "oversize");
    assert.equal(albumBoxFlag({ sizeSource: "inherited", stripLabel: "26 mm", adjustment: null }), "inherited");
    assert.equal(albumBoxFlag({ sizeSource: "stated", stripLabel: "26 mm", adjustment: { w: 1 } }), "corrected");
    assert.equal(albumBoxFlag({ sizeSource: "stated", stripLabel: "26 mm", adjustment: null }), null);
  });
});
