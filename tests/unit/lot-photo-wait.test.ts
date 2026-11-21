import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { awaitsPhotos, lotsAwaitingPhotos, lotsDoneWaiting } from "../../src/lib/lot-photo-wait";
import type { PrepareOffer } from "../../src/lib/offers";
import type { ReadyBlocker } from "../../src/lib/offer-photo-readiness";

// A lot on a proposal's or a post's screen waiting on its photos (#1893, #2114): asked after alone
// while it waits, and read again whole once the wait is over (#2639).

function row(id: string, over: Partial<PrepareOffer> = {}): PrepareOffer {
  return { id, readyAfterPhotos: false, readyBlockers: [], ...over } as PrepareOffer;
}

const generating = { code: "photos-generating" } as unknown as ReadyBlocker;
const missing = { code: "photos-missing" } as unknown as ReadyBlocker;

describe("awaitsPhotos", () => {
  it("is a lot set to turn Ready once its photos are done", () => {
    assert.equal(awaitsPhotos(row("a", { readyAfterPhotos: true })), true);
  });

  it("is a lot whose photos are being made", () => {
    assert.equal(awaitsPhotos(row("a", { readyBlockers: [generating] })), true);
  });

  it("is not a lot held by anything else", () => {
    assert.equal(awaitsPhotos(row("a", { readyBlockers: [missing] })), false);
    assert.equal(awaitsPhotos(row("a")), false);
  });
});

describe("lotsAwaitingPhotos", () => {
  it("names only the waiting lots", () => {
    const rows = {
      a: row("a", { readyAfterPhotos: true }),
      b: row("b"),
      c: row("c", { readyBlockers: [generating] }),
    };
    assert.deepEqual(lotsAwaitingPhotos(rows), ["a", "c"]);
  });

  it("names none before the rows are read, or once the post is up", () => {
    assert.deepEqual(lotsAwaitingPhotos(undefined), []);
    assert.deepEqual(lotsAwaitingPhotos(null), []);
  });
});

describe("lotsDoneWaiting", () => {
  it("is a lot that turned Ready — its row no longer waiting", () => {
    const fresh = { a: row("a"), b: row("b", { readyAfterPhotos: true }) };
    assert.deepEqual(lotsDoneWaiting(["a", "b"], fresh), ["a"]);
  });

  it("is a lot that left the rows — neither Preparing nor Ready any more", () => {
    assert.deepEqual(lotsDoneWaiting(["a", "b"], { b: row("b", { readyAfterPhotos: true }) }), ["a"]);
  });

  it("is every lot asked after once the post is up", () => {
    assert.deepEqual(lotsDoneWaiting(["a", "b"], null), ["a", "b"]);
  });

  it("is none while every lot still waits", () => {
    const fresh = { a: row("a", { readyAfterPhotos: true }), b: row("b", { readyBlockers: [generating] }) };
    assert.deepEqual(lotsDoneWaiting(["a", "b"], fresh), []);
  });
});
