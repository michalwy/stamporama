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
 * than to raise it again. **That sentence is about the server, and the section below is why it has
 * to say so.**
 *
 * ## The raise is the server's only, and `scripts/migrate-photos-to-gcs.ts` runs without it (#1152)
 *
 * `register()` is Next's server boot hook and does not fire in a `tsx`-run script, so that
 * migration runs on Node's default of **10**. It is the only script this applies to: exactly two
 * files under `scripts/` import `src/lib` — it and `refresh-delcampe-categories.ts`, which touches
 * no storage. **Read that as scoped to `scripts/` and not to "everything outside the server"** —
 * the test suites import `src/lib` too, and they are not long-running processes streaming bytes.
 *
 * **The decision was to leave it that way, and the reason is that nothing here has measured that
 * script's path.** What #1123 measured is a cache-missing **fetch** — a GCS download. The migration
 * performs no GCS read at all: it selects rows `where: { storageBackend: "filesystem" }`, reads
 * them through `FilesystemStorage.get`, which is a bare `createReadStream` and constructs no
 * `PassThrough`, and writes with `"delivery"`, which `CachingStorage.put` passes straight to
 * `GcsStorage.put` → `file.createWriteStream({ resumable: false })`. That is the **upload** half of
 * the same SDK: `startSimpleUpload_` → `makeWritableStream` → `teeny-request`, which does build a
 * plain `PassThrough` in `createMultipartStream` — but with `maxRetries: 0` and no `retry-request`
 * around it, so the repeated adder that took the download to a peak of 12 is absent. **Whether that
 * path warns at all is unmeasured**, and it needs a real bucket to measure.
 *
 * **So: a warning from that script is not a finding about this number, and it does not mean what
 * the paragraph above means.** It would be Node's default being crossed — *eleven*, not
 * twenty-one — and the line prints `MaxListeners is 10`, which is how to tell the two apart at a
 * glance. Revisit `DEFAULT_MAX_LISTENERS` on a warning from the **server**; a warning from the
 * migration is a reason to measure that path, not to raise this constant.
 *
 * **Why not simply call {@link raiseDefaultMaxListeners} from the script as well.** It is a second
 * *entry point* rather than a per-module call, so #1137's *not scattered* would not forbid it. What
 * it cannot do is close: the criterion that admits the migration is *drives GCS streaming*, not
 * *imports `src/lib`* — `refresh-delcampe-categories.ts` does the latter and would still get
 * nothing — so the list would be open at two rather than closed at two, and the next script to
 * touch storage reopens it. Against that, the raise buys nothing measured. **Add a caller when
 * there is a measurement, not before**, and correct the "one place" comment in
 * `instrumentation-node.ts` in the same change.
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
