import { test } from "node:test";
import assert from "node:assert/strict";
import {
  copyDispositions,
  holdingLabel,
  isEmptyAnswer,
  wantAxesLabel,
  wantedRows,
  wantProgressLabel,
  type SearchAnswer,
  type SearchCopy,
  type SearchStamp,
  type SearchWant,
  type SearchWants,
} from "./search";

const stamp = (copies: number, variantCopies: number): SearchStamp => ({
  stampId: "s1",
  name: "Eagle",
  issuedYear: 1960,
  areaName: "Poland",
  issueName: null,
  issueYear: null,
  catalogNumbers: ["Mi·PL 200"],
  subtype: null,
  hasVariants: false,
  isVariant: false,
  copies,
  variantCopies,
  wants: null,
  url: "https://stamps.example/c/main/stamps/s1",
});

test("a stamp with no copies anywhere says so rather than going quiet", () => {
  assert.equal(holdingLabel(stamp(0, 0)), "Not held");
});

test("copies of the stamp itself are counted in the collector's own words", () => {
  assert.equal(holdingLabel(stamp(1, 0)), "1 copy");
  assert.equal(holdingLabel(stamp(3, 0)), "3 copies");
});

test("variant copies are named separately, never summed into the stamp's own", () => {
  // #528's rule: two figures, because a copy of a specific variant is not a copy of the umbrella.
  assert.equal(holdingLabel(stamp(2, 3)), "2 copies · 3 under variants");
});

test("an umbrella held only through its variants does not read as not held", () => {
  assert.equal(holdingLabel(stamp(0, 4)), "4 under variants");
});

const want = (e: Partial<SearchWant> = {}): SearchWant => ({
  conditions: "Mint never hinged",
  certificate: "Any certificate",
  format: "Single",
  priority: "high",
  here: 0,
  coming: 0,
  ...e,
});

const wants = (...entries: Partial<SearchWant>[]): SearchWants => ({
  openCount: entries.length,
  topPriority: "high",
  wants: entries.map(want),
});

test("a want states what is actually wanted, not that there is one", () => {
  assert.equal(wantAxesLabel(want()), "Mint never hinged · Any certificate · Single");
});

test("every open want is a row of its own — two conditions are two decisions", () => {
  const s = stamp(0, 0);
  s.wants = wants({}, { conditions: "Used" });
  assert.deepEqual(
    wantedRows([s]).map((r) => r.want.conditions),
    ["Mint never hinged", "Used"]
  );
});

test("want rows come out most urgent first, across stamps", () => {
  const low = stamp(0, 0);
  low.wants = wants({ priority: "low", conditions: "Used" });
  const high = stamp(0, 0);
  high.wants = wants({ priority: "high", conditions: "Mint never hinged" });
  assert.deepEqual(
    wantedRows([low, high]).map((r) => r.want.priority),
    ["high", "low"]
  );
});

test("a stamp with no wants contributes no rows", () => {
  assert.deepEqual(wantedRows([stamp(3, 0)]), []);
});

test("a want nothing is answering yet stays quiet", () => {
  assert.equal(wantProgressLabel(want()), "");
});

test("copies already answering a want, and ones on the way, are said apart", () => {
  assert.equal(wantProgressLabel(want({ here: 1 })), "1 already answers it");
  assert.equal(wantProgressLabel(want({ here: 2, coming: 1 })), "2 already answer it · 1 on the way");
  assert.equal(wantProgressLabel(want({ coming: 2 })), "2 on the way");
});

test("an answer is empty only when every group is", () => {
  const empty: SearchAnswer = { query: "200", stamps: [], issues: [], copies: [] };
  assert.equal(isEmptyAnswer(empty), true);
  assert.equal(isEmptyAnswer({ ...empty, stamps: [stamp(0, 0)] }), false);
  assert.equal(
    isEmptyAnswer({
      ...empty,
      issues: [{ issueId: "i1", name: "Birds", year: 1960, url: "https://x/i1" }],
    }),
    false
  );
});

const copy = (dispositions: Partial<SearchCopy> = {}): SearchCopy => ({
  itemId: "c1",
  itemNo: 12,
  stampName: "Eagle",
  issueName: null,
  catalogNumbers: ["Mi·PL 200"],
  conditionName: "Used",
  formatName: null,
  locationRef: null,
  inCollection: false,
  forSale: false,
  forTrade: false,
  url: "https://stamps.example/c/main/inventory/c1",
  ...dispositions,
});

test("a copy wears every disposition it carries, in the app's own order", () => {
  assert.deepEqual(
    copyDispositions(copy({ inCollection: true, forSale: true, forTrade: true })).map((d) => d.label),
    ["In collection", "For sale", "For trade"]
  );
});

test("a duplicate kept until it sells is both kept and for sale", () => {
  assert.deepEqual(
    copyDispositions(copy({ inCollection: true, forSale: true })).map((d) => d.token),
    ["collection", "sale"]
  );
});

test("a copy with no disposition decided says nothing, as the app's row does", () => {
  assert.deepEqual(copyDispositions(copy()), []);
});
