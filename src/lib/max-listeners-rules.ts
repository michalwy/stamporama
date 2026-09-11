/**
 * How many listeners one emitter may collect in this process before Node says something (#1137).
 *
 * `EventEmitter.defaultMaxListeners` is Node's leak detector, and at its default of 10 this app
 * crosses it legitimately: #1123 measured a **peak of 12** over 312 `PassThrough` instances, from
 * nested `pipeline()` calls down the `@google-cloud/storage` → `teeny-request` → `node-fetch`
 * stack on a cache-missing photo fetch. Nothing is leaking — the fan-out is bounded and none of it
 * is ours — so the warning arrives on every such fetch, in pairs, indefinitely, and says nothing.
 *
 * **20 clears the measured 12 with room, and keeps the detector.** There is no CLI flag for this,
 * so it is a code change rather than an `.env` line; the alternative that was rejected is
 * `NODE_OPTIONS=--disable-warning=MaxListenersExceededWarning`, which switches the detector off
 * altogether and must not be written into this repository.
 *
 * **What it costs, stated where the change is: warnings between 11 and 20 will no longer appear.**
 * That band is the one #1123 established is legitimately occupied here, so what is given up is
 * early warning over known noise. **A leak is still caught**, because a genuine listener leak grows
 * without bound and crosses twenty as surely as it crosses eleven.
 *
 * **So a warning reappearing is a finding rather than more noise** — it means something crossed
 * *twenty*, which nothing measured here does — and it is the signal to revisit this number rather
 * than to raise it again.
 *
 * `tests/unit/max-listeners-warning.test.ts` owns what the warning itself can and cannot tell you,
 * and this module deliberately asserts none of that: the claim here is only that the process ends
 * up configured, which is the half that is ours.
 */

import { EventEmitter } from "node:events";

/** The limit every emitter created after {@link raiseDefaultMaxListeners} inherits. */
export const DEFAULT_MAX_LISTENERS = 20;

/**
 * Raise the process-wide default. Called **once**, from the server's single entry point
 * (`instrumentation-node.ts`), before anything that fetches bytes — deliberately not per module,
 * and deliberately not `setMaxListeners` on an individual emitter, since every emitter that warns
 * here belongs to a dependency and there is none of ours to call it on.
 */
export function raiseDefaultMaxListeners(): void {
  EventEmitter.defaultMaxListeners = DEFAULT_MAX_LISTENERS;
}
