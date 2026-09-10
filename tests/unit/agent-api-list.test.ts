import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LIST_LIMIT,
  LIST_PARAMETERS,
  MAX_LIST_LIMIT,
  listResponse,
  parseListWindow,
} from "../../src/lib/agent-api/list";
import { parseParameters } from "../../src/lib/agent-api/params";
import { isApiError } from "../../src/lib/agent-api/errors";

// The list conventions (#706). The one that is not obvious is that **every list states its full
// total**: an agent handed twenty-five rows and no total answers confidently about a slice it cannot
// tell from the whole. So `total` is the count of what matched and is never derived from the page,
// and `nextCursor` is what says there is more.

const window = (query: string) =>
  parseListWindow(
    parseParameters(LIST_PARAMETERS, { path: {}, query: new URLSearchParams(query) })
  );

function rejection(run: () => unknown) {
  try {
    run();
  } catch (error) {
    assert.ok(isApiError(error));
    return error;
  }
  return assert.fail("expected a rejection");
}

describe("agent API list window", () => {
  it("defaults to the hard default limit and the first page", () => {
    assert.deepEqual(window(""), { limit: DEFAULT_LIST_LIMIT, offset: 0 });
  });

  it("takes a limit inside the cap and a cursor that this API issued", () => {
    assert.deepEqual(window("limit=10&cursor=25"), { limit: 10, offset: 25 });
    assert.deepEqual(window(`limit=${MAX_LIST_LIMIT}`).limit, MAX_LIST_LIMIT);
  });

  it("refuses a limit above the cap rather than silently clamping it", () => {
    // Clamping would hand back fewer rows than asked for with nothing saying so, which is the same
    // failure `total` exists to prevent one level down.
    const error = rejection(() => window(`limit=${MAX_LIST_LIMIT + 1}`));
    assert.equal(error.code, "invalid_request");
    assert.match(error.message, new RegExp(String(MAX_LIST_LIMIT)));
    assert.equal(rejection(() => window("limit=0")).code, "invalid_request");
  });

  it("tells an agent that invented a cursor to use the one it was given", () => {
    const error = rejection(() => window("cursor=abc"));
    assert.match(error.message, /nextCursor/);
  });
});

describe("agent API list response", () => {
  it("states the full total and points at the next page", () => {
    const page = listResponse(["a", "b"], 7, { limit: 2, offset: 0 });
    assert.deepEqual(page.items, ["a", "b"]);
    assert.equal(page.total, 7);
    assert.equal(page.nextCursor, "2");
  });

  it("ends the walk on the last page", () => {
    assert.equal(listResponse(["g"], 7, { limit: 2, offset: 6 }).nextCursor, null);
    assert.equal(listResponse([], 0, { limit: 2, offset: 0 }).nextCursor, null);
  });

  it("chains: following every cursor visits every row exactly once", () => {
    const rows = Array.from({ length: 7 }, (_, i) => i);
    const seen: number[] = [];
    let offset = 0;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = listResponse(rows.slice(offset, offset + 3), rows.length, { limit: 3, offset });
      seen.push(...page.items);
      if (page.nextCursor === null) break;
      offset = Number(page.nextCursor);
    }
    assert.deepEqual(seen, rows);
  });

  it("does not take the total from the page, which would always claim to be complete", () => {
    const page = listResponse(["a"], 100, { limit: 1, offset: 0 });
    assert.equal(page.total, 100);
    assert.notEqual(page.total, page.items.length);
  });
});
