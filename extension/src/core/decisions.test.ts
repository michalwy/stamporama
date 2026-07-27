import { test } from "node:test";
import assert from "node:assert/strict";
import { isAlreadyLinkedElsewhere, type Candidate, type MatchResult } from "./decisions";

// The filter behind "Show already linked elsewhere" (#305). It decides what disappears from the
// decision list by default, so the free-candidate case is the one that must never be swallowed.

function candidate(stampId: string, existingColnectId: string | null): Candidate {
  return {
    stampId,
    name: stampId,
    issuedYear: null,
    areaName: null,
    issueName: null,
    photoId: null,
    catalogNumbers: [],
    backfill: [],
    existingColnectId,
  };
}

function needsConfirm(reason: string, candidates: Candidate[]): MatchResult {
  return { colnectId: "111", status: "needs-confirm", reason, candidates, refs: [] };
}

test("a single candidate already linked to another item is resolved", () => {
  assert.equal(
    isAlreadyLinkedElsewhere(needsConfirm("existing-different", [candidate("s1", "222")])),
    true
  );
});

test("several candidates count as resolved only when every one of them is taken", () => {
  const taken = [candidate("s1", "222"), candidate("s2", "333")];
  assert.equal(isAlreadyLinkedElsewhere(needsConfirm("multiple-candidates", taken)), true);

  const oneFree = [candidate("s1", "222"), candidate("s2", null)];
  assert.equal(isAlreadyLinkedElsewhere(needsConfirm("multiple-candidates", oneFree)), false);
});

test("an unlinked candidate — including a partial conflict — stays in the list", () => {
  assert.equal(
    isAlreadyLinkedElsewhere(needsConfirm("partial-conflict", [candidate("s1", null)])),
    false
  );
  assert.equal(isAlreadyLinkedElsewhere(needsConfirm("multiple-candidates", [])), false);
});

test("auto and skipped rows are never filtered — the toggle only governs decisions", () => {
  const auto: MatchResult = {
    colnectId: "111",
    status: "auto",
    stampId: "s1",
    written: false,
    alreadySet: true,
    stamp: candidate("s1", "111"),
    refs: [],
  };
  assert.equal(isAlreadyLinkedElsewhere(auto), false);
  assert.equal(
    isAlreadyLinkedElsewhere({ colnectId: "111", status: "skipped", reason: "no-candidates", refs: [] }),
    false
  );
});
