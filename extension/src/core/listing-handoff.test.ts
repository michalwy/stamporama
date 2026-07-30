import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeListingReport, parseListingHandoff } from "./listing-handoff";

// The handoff element is written by a client-rendered screen, so the parser's real job is telling a
// task apart from a node that exists but holds nothing yet — half a handoff must read as none.

const task = {
  offerId: "off_1",
  collectionId: "col_1",
  state: "ready",
  platform: { id: "con_1", name: "Colnect", module: "colnect" },
  title: "Mi·PL 1-3",
  description: null,
  privateNote: null,
  descriptionFormat: "plain",
  price: "12.00",
  currency: "PLN",
  quantity: 1,
  items: [],
  photos: { status: "none", outOfDate: false, images: [] },
};

const handoff = { v: 1, requestId: "req_1", task };

describe("parseListingHandoff", () => {
  it("accepts a well-formed handoff", () => {
    const parsed = parseListingHandoff(JSON.stringify(handoff));
    assert.deepEqual(parsed, handoff);
  });

  it("reads an empty, absent or unparsable node as no handoff", () => {
    assert.equal(parseListingHandoff(null), null);
    assert.equal(parseListingHandoff(""), null);
    assert.equal(parseListingHandoff("   "), null);
    assert.equal(parseListingHandoff("not json"), null);
    assert.equal(parseListingHandoff("[]"), null);
    assert.equal(parseListingHandoff("null"), null);
  });

  it("refuses a payload of another version", () => {
    assert.equal(parseListingHandoff(JSON.stringify({ ...handoff, v: 2 })), null);
  });

  it("requires a request id, so an answer can name what it answers", () => {
    assert.equal(parseListingHandoff(JSON.stringify({ ...handoff, requestId: "  " })), null);
    assert.equal(parseListingHandoff(JSON.stringify({ v: 1, task })), null);
  });

  it("requires the spine the shell dereferences at once", () => {
    const bad = (t: unknown) => parseListingHandoff(JSON.stringify({ ...handoff, task: t }));
    assert.equal(bad(undefined), null);
    assert.equal(bad({ ...task, offerId: "" }), null);
    assert.equal(bad({ ...task, items: undefined }), null);
    assert.equal(bad({ ...task, platform: undefined }), null);
    assert.equal(bad({ ...task, platform: { id: "con_1", name: "Colnect", module: 7 } }), null);
  });

  it("keeps a platform naming no module — a refusal is the shell's to state, in full", () => {
    const payload = { ...handoff, task: { ...task, platform: { ...task.platform, module: null } } };
    assert.deepEqual(parseListingHandoff(JSON.stringify(payload)), payload);
  });
});

describe("describeListingReport", () => {
  const base = { moduleId: "colnect", moduleName: "Colnect", formUrl: "https://colnect.com/x" };

  it("counts what was filled, and says nothing of skips when there were none", () => {
    const msg = describeListingReport({ ...base, filled: [{ field: "Price", value: "12.00" }], skipped: [] });
    assert.match(msg, /Filled 1 field in Colnect's listing form/);
    assert.doesNotMatch(msg, /could not be filled/);
  });

  it("counts the skips beside them — a skip is a report, not a failure", () => {
    const msg = describeListingReport({
      ...base,
      filled: [
        { field: "Price", value: "12.00" },
        { field: "Sets", value: "1" },
      ],
      skipped: [{ field: "Condition — 1", reason: "This stamp has no Colnect item-ID." }],
    });
    assert.match(msg, /Filled 2 fields/);
    assert.match(msg, /1 field could not be filled/);
  });
});
