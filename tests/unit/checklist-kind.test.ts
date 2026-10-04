import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  asChecklistKind,
  isChecklistKind,
  isChecklistShown,
  markedChecklistName,
  readSpecialisedChecklistsCookie,
  shownChecklists,
  shownChecklistWhere,
  specialisedChecklistsCookieName,
} from "../../src/lib/checklist-kind";

// The vocabulary of a checklist's kind (#1617, ADR-0031 §11): what the switch shows, the `where` the
// reads spread, the cookie that carries it per collection, and the text form of the mark.

describe("checklist kind", () => {
  it("knows its two kinds and reads anything else as standard", () => {
    assert.equal(isChecklistKind("standard"), true);
    assert.equal(isChecklistKind("specialised"), true);
    assert.equal(isChecklistKind("specialized"), false);
    assert.equal(asChecklistKind("specialised"), "specialised");
    assert.equal(asChecklistKind("bogus"), "standard");
    assert.equal(asChecklistKind(null), "standard");
  });

  it("shows a specialised checklist only with the switch on, and a standard one always", () => {
    assert.equal(isChecklistShown("standard", false), true);
    assert.equal(isChecklistShown("specialised", false), false);
    assert.equal(isChecklistShown("specialised", true), true);
  });

  it("narrows a read to the standard kind off, and adds no condition at all on", () => {
    assert.deepEqual(shownChecklistWhere(false), { kind: "standard" });
    assert.deepEqual(shownChecklistWhere(true), {});
  });

  it("filters a list in its own order", () => {
    const lists = [
      { id: "a", kind: "specialised" },
      { id: "b", kind: "standard" },
      { id: "c", kind: "specialised" },
    ];
    assert.deepEqual(
      shownChecklists(lists, false).map((c) => c.id),
      ["b"]
    );
    assert.deepEqual(
      shownChecklists(lists, true).map((c) => c.id),
      ["a", "b", "c"]
    );
  });

  it("keeps one cookie per collection, switched on only by its own value", () => {
    assert.notEqual(specialisedChecklistsCookieName("c1"), specialisedChecklistsCookieName("c2"));
    assert.equal(readSpecialisedChecklistsCookie("1"), true);
    assert.equal(readSpecialisedChecklistsCookie(""), false);
    assert.equal(readSpecialisedChecklistsCookie("true"), false);
    assert.equal(readSpecialisedChecklistsCookie(undefined), false);
  });

  it("marks a specialised name where only text fits, and leaves a standard one alone", () => {
    assert.equal(markedChecklistName({ name: "Shades", kind: "specialised" }), "Shades (specialised)");
    assert.equal(markedChecklistName({ name: "Basic", kind: "standard" }), "Basic");
    assert.equal(markedChecklistName({ name: "Basic" }), "Basic");
  });
});
