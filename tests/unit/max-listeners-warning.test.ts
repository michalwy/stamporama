import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

// What a `MaxListenersExceededWarning` from this app can and cannot tell you (#1123).
//
// The warning was read as a measurement — "every line says 11, so the fan-out is bounded at 11" —
// and it is not one. `EventEmitter._addListener` sets `warned = true` on the first crossing, so
// the number is always `maxListeners + 1` and the emitter never warns for that event again. The
// reasoning lives in `docs/agents/platform.md`; this suite is what makes it a checked claim rather
// than prose, because both halves of it are Node's behaviour and neither is in our control.
//
// **This is a test about the runtime, deliberately.** Node is on the never-alone list in
// `renovate.json`, so a bump reaches a person — and this is what gives that person something to
// read: if a future Node re-warns, or reports the running total, or renders the emitter's name
// differently, these go red and the `platform.md` bullet is what has to be corrected. That is the
// "what would say it is still wrong" the issue asked for, and it is the only form of it that
// cannot be forgotten.
//
// Pure logic, no Prisma, no I/O — `tests/unit/unit-suite-purity.test.ts` walks this file's imports.

/** Collect the process-level warnings a function provokes, without racing the event loop. */
async function warningsDuring(fn: () => void): Promise<string[]> {
  const seen: string[] = [];
  const onWarning = (w: Error) => {
    if (w.name === "MaxListenersExceededWarning") seen.push(w.message);
  };
  process.on("warning", onWarning);
  try {
    fn();
    // `process.emitWarning` defers to the next tick, so let it land before we read.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("warning", onWarning);
  }
  return seen;
}

describe("MaxListenersExceededWarning is not a measurement", () => {
  it("warns once per (emitter, event) however many listeners are added after", async () => {
    const stream = new PassThrough();

    const warnings = await warningsDuring(() => {
      for (let i = 0; i < 30; i++) stream.on("error", () => {});
    });

    // The count that matters is 30. The count the log would have shown is 11.
    assert.equal(stream.listenerCount("error"), 30);
    assert.equal(
      warnings.length,
      1,
      "a second warning would mean a log could distinguish 11 from 30 after all",
    );
    assert.match(warnings[0], /\b11 error listeners added\b/);
    assert.doesNotMatch(
      warnings[0],
      /\b30\b/,
      "the message reports maxListeners + 1, never the running total",
    );
  });

  it("reports maxListeners + 1, so the number tracks the limit and not the fan-out", async () => {
    const stream = new PassThrough();
    stream.setMaxListeners(4);

    const warnings = await warningsDuring(() => {
      for (let i = 0; i < 20; i++) stream.on("close", () => {});
    });

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\b5 close listeners added\b/);
  });

  it("warns per event name, which is why the app's warnings arrive in error/close pairs", async () => {
    const stream = new PassThrough();

    const warnings = await warningsDuring(() => {
      for (let i = 0; i < 11; i++) {
        stream.on("error", () => {});
        stream.on("close", () => {});
      }
    });

    assert.equal(warnings.length, 2, "one warning per event name, not one per emitter");
    assert.ok(warnings.some((w) => w.includes("error listeners")));
    assert.ok(warnings.some((w) => w.includes("close listeners")));
  });

  it("names the exact constructor, so a subclass never hides behind its base class", async () => {
    // The discriminator that ruled out `@google-cloud/storage`'s download stream in #1123: it
    // returns a `PassThroughShim extends PassThrough`, and the production log said `[PassThrough]`.
    class PassThroughShim extends PassThrough {}

    const base = await warningsDuring(() => {
      const s = new PassThrough();
      for (let i = 0; i < 11; i++) s.on("error", () => {});
    });
    const subclass = await warningsDuring(() => {
      const s = new PassThroughShim();
      for (let i = 0; i < 11; i++) s.on("error", () => {});
    });

    assert.match(base[0], /\[PassThrough\]/);
    assert.match(subclass[0], /\[PassThroughShim\]/);
  });

  it("counts against the default limit, so the threshold is 11 unless something raises it", () => {
    // Pinned because every count quoted in #1123 and in `platform.md` assumes this default. A
    // Node that shipped a different one would make all of them wrong without anything else moving.
    assert.equal(EventEmitter.defaultMaxListeners, 10);
    assert.equal(new PassThrough().getMaxListeners(), 10);
  });
});
