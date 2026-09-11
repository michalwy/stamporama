import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  DEFAULT_MAX_LISTENERS,
  raiseDefaultMaxListeners,
} from "../../src/lib/max-listeners-rules";

// That the process ends up configured (#1137) — the half of this that is ours.
//
// **Deliberately not a test that a warning fails to appear.** That is Node's behaviour, and
// `tests/unit/max-listeners-warning.test.ts` already owns it; re-asserting it here would pin the
// mechanism where the intent is what this change is about. The intent is one sentence: the server
// raises the limit at startup, so every emitter created afterwards carries the raised one.
//
// Pure logic, no Prisma, no I/O — `tests/unit/unit-suite-purity.test.ts` walks this file's imports.
// The entry point that calls this, `src/instrumentation-node.ts`, reaches Prisma and the GCS SDK,
// which is why the constant and the call live in a module of their own rather than in it.

describe("the server's listener limit", () => {
  it("is 20 — the peak of 12 measured in #1123, with room above it", () => {
    // Pinned as a literal on purpose. Comparing the configured value against the same constant
    // would pass whatever that constant said, which is a test asserting nothing; this is what
    // makes a change to the number a deliberate act with a red test in front of it.
    assert.equal(DEFAULT_MAX_LISTENERS, 20);
  });

  it("is raised on the process, so an emitter created afterwards inherits it", () => {
    // Node's own default, read before we touch it. It is here as the control rather than as a
    // claim about Node — without it, the assertion below cannot tell "we raised it" from
    // "it was already that".
    assert.equal(EventEmitter.defaultMaxListeners, 10, "Node's default, before this app moves it");

    raiseDefaultMaxListeners();

    assert.equal(EventEmitter.defaultMaxListeners, DEFAULT_MAX_LISTENERS);
    assert.equal(
      new PassThrough().getMaxListeners(),
      DEFAULT_MAX_LISTENERS,
      "a fresh emitter inherits the raised default — which is the whole of what the change buys",
    );
  });
});
