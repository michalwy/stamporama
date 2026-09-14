import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CLOSE_NEXT_STEP, describeCloseFailure, parseCloseHandoff } from "./colnect-close-handoff";

// The close handoff leads to a write on Colnect (#729), so a task that does not name its sale must
// read as no task at all rather than as a close of something.

const task = { offerId: "o1", collectionId: "c1", saleId: "h5UXNh", label: "offer #41" };

describe("parseCloseHandoff (#729)", () => {
  it("reads a complete task", () => {
    assert.deepEqual(parseCloseHandoff(JSON.stringify({ v: 1, requestId: " r1 ", task })), {
      v: 1,
      requestId: "r1",
      task,
    });
  });

  it("reads a half-rendered node as no handoff", () => {
    assert.equal(parseCloseHandoff(""), null);
    assert.equal(parseCloseHandoff(null), null);
    assert.equal(parseCloseHandoff("{not json"), null);
    assert.equal(parseCloseHandoff(JSON.stringify({ v: 2, requestId: "r1", task })), null);
    assert.equal(parseCloseHandoff(JSON.stringify({ v: 1, requestId: "", task })), null);
  });

  it("refuses a task that does not say which sale, or whose", () => {
    for (const missing of ["saleId", "offerId", "collectionId"] as const) {
      const partial = { ...task, [missing]: "  " };
      assert.equal(
        parseCloseHandoff(JSON.stringify({ v: 1, requestId: "r1", task: partial })),
        null,
        missing
      );
    }
  });

  it("names an unlabelled offer rather than leaving a gap in the sentence", () => {
    const parsed = parseCloseHandoff(
      JSON.stringify({ v: 1, requestId: "r1", task: { ...task, label: undefined } })
    );
    assert.equal(parsed?.task.label, "this offer");
  });
});

// #1292: a failed close says what happened and what to do next, never only the step that broke.
describe("describeCloseFailure (#1292)", () => {
  it("follows what went wrong with the way on, as one sentence each", () => {
    assert.equal(
      describeCloseFailure("Colnect answered HTTP 403: Forbidden."),
      `Colnect answered HTTP 403: Forbidden. ${CLOSE_NEXT_STEP}`
    );
    assert.equal(describeCloseFailure("No page  "), `No page. ${CLOSE_NEXT_STEP}`);
  });

  it("still says the listing was not closed when there is no reason to quote", () => {
    assert.equal(describeCloseFailure(" "), `The listing was not closed. ${CLOSE_NEXT_STEP}`);
  });
});
