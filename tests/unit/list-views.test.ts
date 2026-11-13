import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkPresetName,
  cleanListView,
  comparePresetNames,
  droppedNote,
  isUnnarrowedListView,
  parseListView,
  parseRefs,
  readListView,
  referencedIds,
  sameListView,
  writeListView,
  type ListView,
  type ListViewSpec,
} from "../../src/lib/list-views";
import {
  AUCTION_LOTS_VIEW,
  COPIES_VIEW,
  OFFERS_VIEW,
  STAMPS_VIEW,
  SUPPLIES_VIEW,
  WANTS_VIEW,
} from "../../src/app/c/[collectionSlug]/shared/list-view-specs";

// Filter presets (#2487): a list's whole view captured from the address and storage, and laid back
// down replacing — never merging into — the view on screen.

const C = "col1";

/** A localStorage stand-in the pure functions read through. */
function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    read: (key: string) => map.get(key) ?? null,
    apply(writes: Map<string, string | null>) {
      for (const [k, v] of writes) {
        if (v === null) map.delete(k);
        else map.set(k, v);
      }
    },
  };
}

const url = (qs: string) => new URLSearchParams(qs);

/** Apply `view` over the address and storage given, then read the view back as the list would. */
function roundTrip(
  spec: ListViewSpec,
  view: ListView,
  before: { qs?: string; stored?: Record<string, string> } = {}
) {
  const store = storage(before.stored);
  const write = writeListView(spec, view, url(before.qs ?? ""), store.read, C);
  store.apply(write.storage);
  return { read: readListView(spec, write.url, store.read, C), url: write.url, store };
}

const SPEC: ListViewSpec = {
  list: "copies",
  ignoreParams: ["tab"],
  remembered: [
    { name: "conditionIds", store: { key: "stamporama:f:{c}", format: "qs", field: "conditionIds" } },
    { name: "held", store: { key: "stamporama:f:{c}", format: "qs", field: "held" } },
    { name: "platform", store: { key: "stamporama:p:{c}", format: "raw" } },
    {
      name: "areaId",
      store: { key: "stamporama:list-filters:{c}", format: "json", field: "areaId" },
      sentinel: "all",
    },
    { name: "closed", store: { key: "stamporama:closed:{c}", format: "raw" }, bool: true },
  ],
  stored: [
    { name: "groupMode", key: "stamporama:g:{c}", defaultValue: "none" },
    { name: "fields", key: "stamporama:sf:{c}" },
  ],
  refs: { tagIds: "tag", areaId: "area" },
};

describe("readListView", () => {
  it("captures every address parameter it is not told to ignore — a filter added later included", () => {
    const view = readListView(SPEC, url("tagIds=a,b&search=  mint &newFilter=1&tab=x"), () => null, C);
    assert.deepEqual(view.params, { tagIds: "a,b", search: "  mint ", newFilter: "1" });
  });

  it("reads a remembered value from storage while the address names none, and the address over it", () => {
    const store = storage({
      "stamporama:f:col1": "conditionIds=c1&held=2",
      "stamporama:p:col1": "p1",
    });
    assert.deepEqual(readListView(SPEC, url(""), store.read, C).params, {
      conditionIds: "c1",
      held: "2",
      platform: "p1",
    });
    // An empty value in the address wins too: the list shows no condition filter.
    assert.deepEqual(readListView(SPEC, url("conditionIds=&platform=p2"), store.read, C).params, {
      held: "2",
      platform: "p2",
    });
  });

  it("reads the all sentinel as nothing chosen, and a switch's off spellings alike", () => {
    const store = storage({ "stamporama:list-filters:col1": JSON.stringify({ areaId: "a9", year: null }) });
    assert.equal(readListView(SPEC, url(""), store.read, C).params.areaId, "a9");
    assert.equal(readListView(SPEC, url("areaId=all"), store.read, C).params.areaId, undefined);
    assert.equal(readListView(SPEC, url("closed=0"), store.read, C).params.closed, undefined);
    assert.equal(readListView(SPEC, url("closed=true"), store.read, C).params.closed, "1");
  });

  it("reads a stored preference with nothing stored as its default", () => {
    assert.deepEqual(readListView(SPEC, url(""), () => null, C).stored, { groupMode: "none" });
  });
});

describe("writeListView", () => {
  const VIEW: ListView = {
    params: { tagIds: "t1", conditionIds: "c1", areaId: "a1", closed: "1", search: "  x " },
    stored: { groupMode: "issue", fields: "name" },
    local: {},
  };

  it("lays a view down so it reads back exactly", () => {
    const { read } = roundTrip(SPEC, VIEW);
    assert.ok(sameListView(read, VIEW), JSON.stringify(read));
  });

  it("replaces the view on screen rather than merging into it", () => {
    const { read, url: written, store } = roundTrip(
      SPEC,
      { params: { tagIds: "t1" }, stored: {}, local: {} },
      {
        qs: "search=old&conditionIds=c9&platform=p9&decade=1960s",
        stored: {
          "stamporama:f:col1": "conditionIds=c9&held=3",
          "stamporama:p:col1": "p9",
          "stamporama:g:col1": "issue",
          "stamporama:sf:col1": "notes",
          "stamporama:list-filters:col1": JSON.stringify({ areaId: "a9", year: "1970" }),
        },
      }
    );
    assert.deepEqual(read.params, { tagIds: "t1" });
    assert.deepEqual(read.stored, { groupMode: "none" });
    assert.equal(written.toString(), "tagIds=t1");
    // A remembered value the preset does not hold is forgotten, so the next visit does not bring it
    // back — and a field of a shared memory the list does not own is left alone.
    assert.equal(store.map.get("stamporama:f:col1"), undefined);
    assert.equal(store.map.get("stamporama:p:col1"), undefined);
    assert.equal(store.map.get("stamporama:list-filters:col1"), JSON.stringify({ areaId: null, year: "1970" }));
  });

  it("keeps the parameters that are not view state", () => {
    const { url: written } = roundTrip(SPEC, VIEW, { qs: "tab=register&tagIds=zz" });
    assert.equal(written.get("tab"), "register");
    assert.equal(written.get("tagIds"), "t1");
  });

  it("remembers what it applies, so the list opens on it next time", () => {
    const { store } = roundTrip(SPEC, VIEW);
    assert.equal(store.map.get("stamporama:f:col1"), "conditionIds=c1");
    assert.equal(store.map.get("stamporama:closed:col1"), "1");
    assert.equal(store.map.get("stamporama:list-filters:col1"), JSON.stringify({ areaId: "a1" }));
  });
});

describe("the lists' own specs", () => {
  it("Copies: area, years, several dropdowns, sort and grouping come back exactly", () => {
    const view: ListView = {
      params: {
        areaId: "area1",
        year: "1950-1959",
        conditionIds: "c1,c2",
        forSale: "true",
        tagIds: "t1",
        tagMode: "all",
        notOfferedPlatform: "p1",
        sortBy: "catalogNumber",
        sortDir: "desc",
        search: "Chopin",
      },
      stored: {
        groupMode: "issue",
        groupByCondition: "1",
        groupByFormat: "0",
        groupByCertificate: "0",
        subAreas: "0",
        subLocations: "1",
        searchFields: "name",
      },
      local: {},
    };
    const { read } = roundTrip(COPIES_VIEW, view, {
      qs: "conditionIds=c9&includeGone=true",
      stored: { "stamporama:inventory-filters:col1": "deliveryStates=ordered" },
    });
    assert.ok(sameListView(read, view), JSON.stringify(read));
  });

  it("Copies: after clearing everything, the preset brings the view back", () => {
    const view: ListView = {
      params: { areaId: "area1", conditionIds: "c1", sortBy: "name", sortDir: "asc" },
      stored: { groupMode: "duplicates", groupByCondition: "0", groupByFormat: "0", groupByCertificate: "0", subAreas: "1", subLocations: "1" },
      local: {},
    };
    const cleared = roundTrip(COPIES_VIEW, { params: {}, stored: {}, local: {} });
    const back = roundTrip(COPIES_VIEW, view, {
      qs: cleared.url.toString(),
      stored: Object.fromEntries(cleared.store.map),
    });
    assert.ok(sameListView(back.read, view), JSON.stringify(back.read));
  });

  it("Offers: the status spelled needsAction=1 in the address round-trips as one value", () => {
    const needs: ListView = { params: { status: "needsAction" }, stored: { includeClosed: "0" }, local: {} };
    const a = roundTrip(OFFERS_VIEW, needs, { qs: "state=active" });
    assert.equal(a.url.get("needsAction"), "1");
    assert.equal(a.url.get("state"), null);
    assert.ok(sameListView(a.read, needs));
    const states: ListView = { params: { status: "active,draft" }, stored: { includeClosed: "0" }, local: {} };
    const b = roundTrip(OFFERS_VIEW, states, { qs: "needsAction=1" });
    assert.equal(b.url.toString(), "state=active%2Cdraft");
    assert.ok(sameListView(b.read, states));
  });

  it("Auction lots: a switch remembered as a flag reads off whether it is absent or 0", () => {
    const off = readListView(AUCTION_LOTS_VIEW, url("includeClosed=0"), () => null, C);
    const absent = readListView(AUCTION_LOTS_VIEW, url(""), () => null, C);
    assert.ok(sameListView(off, absent));
  });

  it("Wants: the area and the year are captured from the memory the screen reads, never the address", () => {
    const store = storage({
      "stamporama:list-filters:col1": JSON.stringify({ areaId: "a1", year: "1960" }),
    });
    const view = readListView(WANTS_VIEW, url("areaId=zz"), store.read, C);
    assert.equal(view.params.areaId, "zz");
    assert.equal(view.stored.areaYear, JSON.stringify({ areaId: "a1", year: "1960" }));
    // Nothing chosen, stored or not, reads the same.
    assert.ok(
      sameListView(
        readListView(WANTS_VIEW, url(""), () => null, C),
        readListView(
          WANTS_VIEW,
          url(""),
          storage({ "stamporama:list-filters:col1": JSON.stringify({ areaId: null, year: null }) }).read,
          C
        )
      )
    );
  });
});

describe("records a preset names", () => {
  const view: ListView = {
    params: { tagIds: "t1,t2,none", areaId: "a1", search: "x" },
    stored: {},
    local: { conditionIds: "c1" },
  };
  const refs = { tagIds: "tag", areaId: "area", conditionIds: "condition" } as const;

  it("are looked up by kind, sentinels left out", () => {
    const ids = referencedIds(view, refs);
    assert.deepEqual([...(ids.get("tag") ?? [])], ["t1", "t2"]);
    assert.deepEqual([...(ids.get("area") ?? [])], ["a1"]);
    assert.deepEqual([...(ids.get("condition") ?? [])], ["c1"]);
  });

  it("are dropped when gone, named as they were saved, and the rest is applied", () => {
    const gone = new Set(["t2", "a1"]);
    const { view: cleaned, dropped } = cleanListView(
      view,
      refs,
      (_kind, id) => !gone.has(id),
      { "tag:t2": "Rare" }
    );
    assert.deepEqual(cleaned.params, { tagIds: "t1,none", search: "x" });
    assert.deepEqual(cleaned.local, { conditionIds: "c1" });
    assert.deepEqual(dropped, ["tag “Rare”", "a area"]);
    assert.equal(
      droppedNote(["tag “Rare”"]),
      "Applied without tag “Rare” — no longer in the collection."
    );
    assert.equal(droppedNote([]), null);
  });

  it("clears a parameter whose every value is gone", () => {
    const { view: cleaned } = cleanListView(
      { params: { tagIds: "t1" }, stored: {}, local: {} },
      { tagIds: "tag" },
      () => false,
      {}
    );
    assert.deepEqual(cleaned.params, {});
  });
});

describe("stored values", () => {
  it("read back only strings — an old or hand-edited row hands the list nothing else", () => {
    assert.deepEqual(parseListView({ params: { a: "1", b: 2, c: "" }, stored: null }), {
      params: { a: "1" },
      stored: {},
      local: {},
    });
    assert.deepEqual(parseRefs({ tagIds: "tag", x: "nonsense" }), { tagIds: "tag" });
  });

  it("names are required, bounded, and listed by name", () => {
    assert.deepEqual(checkPresetName("  PRL  "), { name: "PRL" });
    assert.ok("error" in checkPresetName("   "));
    assert.ok("error" in checkPresetName("x".repeat(81)));
    assert.deepEqual(["b", "A", "a2", "a10"].sort(comparePresetNames), ["A", "a2", "a10", "b"]);
  });
});

// #2499: a list back to its plain view lets go of the preset applied — "nothing narrows the list",
// whatever the sort and the grouping.
describe("isUnnarrowedListView", () => {
  const view = (v: Partial<ListView>): ListView => ({ params: {}, stored: {}, local: {}, ...v });

  it("is the plain list with every filter cleared, the area and the years included", () => {
    assert.equal(isUnnarrowedListView(COPIES_VIEW, view({})), true);
    assert.equal(isUnnarrowedListView(COPIES_VIEW, view({ params: { areaId: "a1" } })), false);
    assert.equal(isUnnarrowedListView(COPIES_VIEW, view({ params: { year: "1960" } })), false);
    assert.equal(isUnnarrowedListView(COPIES_VIEW, view({ params: { search: "x" } })), false);
    // A filter only the address carries counts the same, named in no spec.
    assert.equal(isUnnarrowedListView(COPIES_VIEW, view({ params: { decade: "1960" } })), false);
  });

  it("leaves the sort and the grouping out", () => {
    const sortedAndGrouped = view({
      params: { sortBy: "price", sortDir: "desc" },
      stored: { groupMode: "issue", groupByCondition: "1", searchFields: "name", subAreas: "0" },
    });
    assert.equal(isUnnarrowedListView(COPIES_VIEW, sortedAndGrouped), true);
    assert.equal(isUnnarrowedListView(SUPPLIES_VIEW, view({ params: { month: "1" } })), true);
  });

  it("leaves out the half of a filter that says nothing alone", () => {
    assert.equal(isUnnarrowedListView(COPIES_VIEW, view({ params: { tagMode: "all" } })), true);
    assert.equal(isUnnarrowedListView(STAMPS_VIEW, view({ params: { catalogVendorId: "v1" } })), true);
    assert.equal(
      isUnnarrowedListView(STAMPS_VIEW, view({ params: { catalogVendorId: "v1", catalogNumber: "5" } })),
      false
    );
  });

  it("counts a stored value that changes the rows, at its default or not", () => {
    assert.equal(isUnnarrowedListView(OFFERS_VIEW, view({ stored: { includeClosed: "0" } })), true);
    assert.equal(isUnnarrowedListView(OFFERS_VIEW, view({ stored: { includeClosed: "1" } })), false);
    const areaYear = (v: object) => view({ stored: { areaYear: JSON.stringify(v) } });
    assert.equal(isUnnarrowedListView(WANTS_VIEW, areaYear({ year: null, areaId: null })), true);
    assert.equal(isUnnarrowedListView(WANTS_VIEW, areaYear({})), true);
    assert.equal(isUnnarrowedListView(WANTS_VIEW, areaYear({ areaId: "a1", year: null })), false);
  });

  it("counts a list's own screen state", () => {
    assert.equal(isUnnarrowedListView(WANTS_VIEW, view({ local: { status: "closed" } })), false);
    assert.equal(isUnnarrowedListView(WANTS_VIEW, view({ stored: { groupByIssue: "1" } })), true);
  });
});
