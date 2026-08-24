import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLNECT_LIST_WRITE_PATH,
  COLNECT_WRITE_BACKOFF_MS,
  classifyColnectListWrite,
  colnectListWriteBody,
  colnectWriteBackoffMs,
  retryAfterMs,
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
