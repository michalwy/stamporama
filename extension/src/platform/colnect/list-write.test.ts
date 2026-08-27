import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLNECT_LIST_WRITE_PATH,
  COLNECT_WRITE_BACKOFF_MS,
  classifyColnectListWrite,
  colnectListWriteBody,
  colnectWriteBackoffMs,
  colnectCondQtyBody,
  planColnectCondQty,
  readColnectEntryRows,
  retryAfterMs,
  type ColnectCondQtyStep,
} from "./list-write";

// The one request in this repo that **changes** something in a Colnect account (#689, ADR-0042).
//
// It is asserted here rather than in a browser precisely because it is undocumented: the shape was
// read off `m.115.js` on 2026-08-22, and a test that states it is what makes a later drift visible
// as a failing assertion rather than as three thousand silently wrong writes.

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("colnectListWriteBody (#689)", () => {
  it("builds the checkbox call Colnect's own row issues", () => {
    const body = colnectListWriteBody({ colnectId: "1234567", lt: 3, direction: "+" });
    assert.equal(body, "act=check&id=1234567&cat=20&lt=3&val=%2B");
    assert.equal(COLNECT_LIST_WRITE_PATH, "/item/col", "same-origin, never an absolute URL");
  });

  it("says which way the item goes", () => {
    const off = new URLSearchParams(
      colnectListWriteBody({ colnectId: "9", lt: 4, direction: "-" })
    );
    assert.equal(off.get("val"), "-");
    assert.equal(off.get("lt"), "4", "the Wish list, by Colnect's own number");
    assert.equal(off.get("cat"), "20", "stamps");
  });
});

describe("classifyColnectListWrite (#689)", () => {
  it("takes a 2xx at face value — the real check is the next export", () => {
    assert.deepEqual(classifyColnectListWrite(200), { status: "applied" });
    assert.deepEqual(classifyColnectListWrite(204), { status: "applied" });
  });

  it("reads a 410 as the catalogue item having changed, not as a failure of the run", () => {
    assert.deepEqual(classifyColnectListWrite(410), { status: "changed" });
  });

  it("reads a 429 as a pace to back off from, carrying what the server asked for", () => {
    assert.deepEqual(classifyColnectListWrite(429), { status: "throttled", retryAfterMs: null });
    assert.deepEqual(classifyColnectListWrite(429, headers({ "retry-after": "90" })), {
      status: "throttled",
      retryAfterMs: 90_000,
    });
  });

  it("stops on a sign-in problem rather than working through the whole list failing", () => {
    assert.deepEqual(classifyColnectListWrite(401), { status: "unauthorized" });
    assert.deepEqual(classifyColnectListWrite(403), { status: "unauthorized" });
  });

  it("stops on anything it cannot classify, and never retries blind", () => {
    const outcome = classifyColnectListWrite(500);
    assert.equal(outcome.status, "stopped");
    assert.match(outcome.status === "stopped" ? outcome.reason : "", /HTTP 500/);
  });
});

describe("retryAfterMs (#689)", () => {
  it("reads seconds", () => {
    assert.equal(retryAfterMs("30"), 30_000);
    assert.equal(retryAfterMs(" 5 "), 5_000);
  });

  it("reads an HTTP date, against a stated now", () => {
    const now = Date.parse("2026-08-24T10:00:00Z");
    assert.equal(retryAfterMs("Mon, 24 Aug 2026 10:01:00 GMT", now), 60_000);
  });

  it("answers null for an absent or unreadable header", () => {
    assert.equal(retryAfterMs(null), null);
    assert.equal(retryAfterMs("soon"), null);
  });

  it("never answers a negative wait for a date already past", () => {
    const now = Date.parse("2026-08-24T10:00:00Z");
    assert.equal(retryAfterMs("Mon, 24 Aug 2026 09:00:00 GMT", now), 0);
  });
});

describe("colnectWriteBackoffMs (#689)", () => {
  it("lengthens with each consecutive refusal", () => {
    assert.deepEqual(
      [1, 2, 3].map((n) => colnectWriteBackoffMs(n, null)),
      [...COLNECT_WRITE_BACKOFF_MS]
    );
  });

  it("gives way to a longer wait the server asked for, and ignores a shorter one", () => {
    assert.equal(colnectWriteBackoffMs(1, 90_000), 90_000, "the server knows better");
    assert.equal(
      colnectWriteBackoffMs(2, 1_000),
      COLNECT_WRITE_BACKOFF_MS[1],
      "backing off to something faster than the pace that just failed is not backing off"
    );
  });

  it("stops once the back-offs are used up", () => {
    assert.equal(
      colnectWriteBackoffMs(COLNECT_WRITE_BACKOFF_MS.length + 1, null),
      null,
      "Colnect has said no often enough; the run pauses and the collector starts it again"
    );
  });
});

// ── Quantity and grade (#704) ────────────────────────────────────────────────
//
// Shapes read off `m.115.js` and verified live against one item on 2026-08-27. Asserted here for
// `colnectListWriteBody`'s reason and one more: the live check cost the collector a wrong entry on a
// real list before it was restored, and it is not something to run again to find out what changed.

describe("readColnectEntryRows (#704)", () => {
  it("reads the array of quantities Colnect indexes by condition id", () => {
    assert.deepEqual(readColnectEntryRows("[0,0,0,0,1,0]"), [{ cond: 4, qty: 1 }], "one Used");
    assert.deepEqual(readColnectEntryRows("[0,8,0,0,2,0]"), [
      { cond: 1, qty: 8 },
      { cond: 4, qty: 2 },
    ]);
  });

  it("reads an object keyed the same way, since Colnect's own handler cannot tell them apart", () => {
    assert.deepEqual(readColnectEntryRows('{"1":3}'), [{ cond: 1, qty: 3 }]);
  });

  it("answers null for anything that is not an answer about an entry", () => {
    assert.equal(readColnectEntryRows(""), null);
    assert.equal(readColnectEntryRows('"limit"'), null, "the list is full");
    assert.equal(readColnectEntryRows("<!doctype html>"), null);
  });

  it("keeps no zero rows — a grade with no copies is not a row", () => {
    assert.deepEqual(readColnectEntryRows("[0,0,0,0,0,0]"), []);
  });
});

describe("planColnectCondQty (#704)", () => {
  it("plans nothing where this side can state no grade at all", () => {
    assert.deepEqual(
      planColnectCondQty([{ cond: 1, qty: 1 }], []),
      [],
      "unmapped is reported, not guessed"
    );
  });

  it("plans nothing where Colnect's defaults already landed it right", () => {
    assert.deepEqual(planColnectCondQty([{ cond: 1, qty: 1 }], [{ cond: 1, qty: 1 }]), []);
  });

  it("corrects the count alone, in one call, where only the count is wrong", () => {
    assert.deepEqual(planColnectCondQty([{ cond: 1, qty: 1 }], [{ cond: 1, qty: 4 }]), [
      { act: "quantity", cond: 1, qty: 4 },
    ]);
  });

  it("re-grades the default row rather than removing it and adding another", () => {
    assert.deepEqual(planColnectCondQty([{ cond: 1, qty: 1 }], [{ cond: 4, qty: 1 }]), [
      { act: "cond", cond: 4, qty: 1, previousCond: 1, qtyOnly: false },
      { act: "quantity", cond: 4, qty: 1 },
    ]);
  });

  it("gives a stamp of two grades the two rows Colnect can hold", () => {
    assert.deepEqual(
      planColnectCondQty([{ cond: 1, qty: 1 }], [
        { cond: 1, qty: 2 },
        { cond: 4, qty: 1 },
      ]),
      [
        { act: "cond", cond: 4, qty: 1, previousCond: null, qtyOnly: false },
        { act: "quantity", cond: 1, qty: 2 },
        { act: "quantity", cond: 4, qty: 1 },
      ]
    );
  });

  it("drops a grade Colnect holds that this side does not, once nothing needs its row", () => {
    assert.deepEqual(
      planColnectCondQty(
        [
          { cond: 1, qty: 1 },
          { cond: 5, qty: 2 },
        ],
        [{ cond: 1, qty: 1 }]
      ),
      [{ act: "x_cond_qty", cond: 5 }]
    );
  });

  it("marks a re-graded row that stated no grade with Colnect's own x_qty_only", () => {
    assert.deepEqual(planColnectCondQty([{ cond: 0, qty: 3 }], [{ cond: 2, qty: 3 }]), [
      { act: "cond", cond: 2, qty: 3, previousCond: null, qtyOnly: true },
      { act: "quantity", cond: 2, qty: 3 },
    ]);
  });
});

describe("colnectCondQtyBody (#704)", () => {
  const body = (step: ColnectCondQtyStep) =>
    new URLSearchParams(colnectCondQtyBody({ colnectId: "127455", lt: 5, step }));

  it("sends a nested val for a grade, the way jQuery serialises Colnect's own object", () => {
    const sent = body({ act: "cond", cond: 1, qty: 8, previousCond: 4, qtyOnly: false });
    assert.equal(sent.get("act"), "cond");
    assert.equal(sent.get("id"), "127455");
    assert.equal(sent.get("cat"), "20");
    assert.equal(sent.get("lt"), "5");
    assert.equal(sent.get("val[qty]"), "8");
    assert.equal(sent.get("val[cond]"), "1");
    assert.equal(sent.get("val[x_prev_cond]"), "4", "which row is being re-graded");
    assert.equal(sent.get("val[x_qty_only]"), null);
  });

  it("leaves x_prev_cond off an added row — its absence is what makes it an addition", () => {
    const sent = body({ act: "cond", cond: 4, qty: 1, previousCond: null, qtyOnly: false });
    assert.equal(sent.get("val[x_prev_cond]"), null);
    assert.equal(sent.get("val[cond]"), "4");
  });

  it("carries x_qty_only where the row it replaces stated a count and no grade", () => {
    const sent = body({ act: "cond", cond: 2, qty: 3, previousCond: null, qtyOnly: true });
    assert.equal(sent.get("val[x_qty_only]"), "true");
  });

  it("sends a count against the row its grade identifies", () => {
    const sent = body({ act: "quantity", cond: 1, qty: 8 });
    assert.equal(sent.get("act"), "quantity");
    assert.equal(sent.get("val[qty]"), "8");
    assert.equal(sent.get("val[cond]"), "1");
  });

  it("removes a row with a scalar val, the way membership takes one", () => {
    const sent = body({ act: "x_cond_qty", cond: 5 });
    assert.equal(sent.get("act"), "x_cond_qty");
    assert.equal(sent.get("val"), "5");
    assert.equal(sent.get("val[cond]"), null, "not the nested form — this act does not take one");
  });
});
