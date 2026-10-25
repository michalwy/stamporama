import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  issueChecklistsInAlbumsMessage,
  issueHasStampsMessage,
  moveCollisions,
  spokenIssue,
} from "../../src/lib/agent-api/issue-tree";

// The pure half of `move_stamp_to_issue` (#2169) and `delete_issue` (#2172): the refusals an agent is
// told. The operations are driven end to end in `tests/integration/agent-api-issue-tree.test.ts`.

describe("spokenIssue", () => {
  it("names an issue by its short number, name and year, leaving out what it lacks", () => {
    assert.equal(spokenIssue({ issueNo: 12, name: "Freimarken", year: 1950 }), 'iss 12 "Freimarken" (1950)');
    assert.equal(spokenIssue({ issueNo: 3, name: null, year: null }), "iss 3");
  });
});

describe("moveCollisions", () => {
  it("names the moved stamp and the holder, with the holder's id in accepted", () => {
    const error = moveCollisions('iss 7 "GG"', [
      {
        label: "Mi·GG 5",
        stamp: "Mi 5 (st 40)",
        holders: [{ stampId: "s-held", name: "Krakau", issueName: "Burgen", issueYear: 1941 }],
      },
    ]);
    assert.match(error.message, /^Mi 5 \(st 40\) would read as Mi·GG 5 under iss 7 "GG", which is already "Krakau" in Burgen, 1941 \(id s-held\)/);
    assert.match(error.message, /Nothing was moved\./);
    assert.deepEqual(error.accepted, ["s-held"]);
  });
});

describe("issueHasStampsMessage", () => {
  it("counts the stamps, splitting off the variants when there are any", () => {
    assert.match(issueHasStampsMessage("iss 4", 1, 1), /^iss 4 is not deleted: it has 1 stamp\. /);
    assert.match(issueHasStampsMessage("iss 4", 5, 3), /it has 5 stamps \(3 at the top level and 2 variants\)\./);
    assert.match(issueHasStampsMessage("iss 4", 2, 1), /\(1 at the top level and 1 variant\)/);
    assert.match(issueHasStampsMessage("iss 4", 1, 1), /`move_stamp_to_issue`/);
  });
});

describe("issueChecklistsInAlbumsMessage", () => {
  it("names each printed checklist with its albums", () => {
    const message = issueChecklistsInAlbumsMessage("iss 9", [{ checklist: "Burgen", albums: ["Polen I"] }]);
    assert.match(message, /^iss 9 is not deleted: "Burgen" is printed in "Polen I", and deleting the issue would take its card out of that album\./);
    assert.match(message, /Nothing was changed\.$/);
  });
});
