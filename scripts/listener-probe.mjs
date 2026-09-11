/**
 * Diagnostic preload for `MaxListenersExceededWarning` (#1123).
 *
 * Node's warning is not a measurement, and reading it as one sends you looking for the wrong
 * thing. `EventEmitter._addListener` sets `warned = true` the first time a listener count passes
 * `maxListeners`, so a given (emitter, event name) warns **once**, and the number it prints is
 * always `maxListeners + 1` — 11 on Node's default of 10, and **21 in this app's server**, which
 * raises the default to 20 at boot (#1137, `src/lib/max-listeners-rules.ts`). A stream that goes on
 * to collect 500 listeners logs the same line as one that stops at the threshold and never says
 * anything again.
 *
 * Two consequences, and they are why this file exists rather than a note in an issue:
 *
 *   - **A log cannot tell a bounded fan-out from a leak.** No volume of production logging
 *     answers "does the count climb", because the count in the message cannot climb.
 *   - **Repeating warnings mean many emitters, not one growing.** Each line is a *different*
 *     object crossing the threshold for the first time.
 *
 * What this prints instead is the real peak listener count per (constructor, event) and how many
 * instances were seen — the numbers the warning withholds — plus the stacks that added them.
 *
 * Usage — it is a preload, so it needs no change to any source file:
 *
 *   NODE_OPTIONS="--import ./scripts/listener-probe.mjs" PROBE_OUT=/tmp/probe.txt pnpm start
 *   kill -USR2 <the next-server pid>      # dump without stopping the process
 *
 * `next start` runs the server in a child process, so signal the `next-server` process rather
 * than the `pnpm` one — `NODE_OPTIONS` is inherited, the signal is not.
 *
 * ESM and `--import` rather than CommonJS and `--require`, and the reason is lint rather than
 * taste: `eslint-config-next` registers its plugins for js, jsx, mjs, ts, tsx, mts and cts — `cjs`
 * is not in that list — while `eslint.config.mjs` applies `react-hooks/exhaustive-deps` in a config
 * object with no `files:` of its own. So any `.cjs` file under a linted path makes `pnpm lint` exit
 * 2 on a configuration error before it reads a line of code, and an empty one reproduces it.
 * `--import` runs this before the main module just as `--require` did, and wants Node 20.6+, which
 * the Dockerfile's `node:24` satisfies.
 *
 * Environment:
 *   PROBE_CTORS         comma-separated constructor names to watch (default `PassThrough`)
 *   PROBE_AT            capture the adding stacks once a count reaches this (default 11)
 *   PROBE_OUT           file to append dumps to (default `/tmp/listener-probe.txt`)
 *   PROBE_INTERVAL_MIN  also dump every N minutes, unset or 0 meaning never (default never)
 *
 * `PROBE_INTERVAL_MIN` exists for the case this was written for: a container somebody else is
 * running. Signalling a process inside one means finding the right pid first — `pnpm start` runs
 * the server as a **child**, so the pid the shell reports is the wrong one — and that is the step
 * most likely to go wrong when the person diagnosing is not the person at the keyboard. With an
 * interval set, the whole procedure is *set two variables, restart, come back later, read the
 * log*. Every dump also goes to stdout, so `docker logs` has it without any file to fetch. The
 * timer is `unref`'d: it can never be the reason a process fails to exit.
 *
 * `PROBE_CTORS` matches the constructor name **exactly**, and so does Node's own warning: it
 * renders the emitter with `inspect(target, { depth: -1 })`, so a subclass prints under its own
 * name. `[PassThrough]` in a log is a plain `PassThrough` and never, for instance,
 * `@google-cloud/storage`'s `PassThroughShim` — which is the cheapest way to rule a candidate
 * in or out before reading any of its code.
 *
 * Deliberately not wired into the app, and not a `package.json` script. It patches
 * `EventEmitter.prototype`, which every stream in the process goes through, so it is something a
 * person turns on while diagnosing and off again afterwards — not something a deployment carries.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";

const WATCH = (process.env.PROBE_CTORS || "PassThrough").split(",");
const AT = Number(process.env.PROBE_AT || 11);
const OUT = process.env.PROBE_OUT || "/tmp/listener-probe.txt";
const INTERVAL_MIN = Number(process.env.PROBE_INTERVAL_MIN || 0);

/** emitter -> { id, stacks: { [event]: string[] } }; weak so tracking never retains a stream. */
const tracked = new WeakMap();
/** "Ctor|event" -> { instances: Set<number>, peak, stacks, stackId } */
const summary = new Map();
let nextId = 1;

function ctorName(emitter) {
  try {
    return emitter && emitter.constructor && emitter.constructor.name;
  } catch {
    // A null-prototype or proxied emitter: not something we watch.
    return undefined;
  }
}

function record(emitter, event) {
  const name = ctorName(emitter);
  if (!WATCH.includes(name)) return;

  let entry = tracked.get(emitter);
  if (!entry) {
    entry = { id: nextId++, stacks: Object.create(null) };
    tracked.set(emitter, entry);
  }

  const count = emitter.listenerCount(event);
  // Drop this frame and the patched method's frame, then keep enough to name the library.
  const stack = new Error(`listener #${count}`).stack.split("\n").slice(2, 12).join("\n");
  (entry.stacks[event] ||= []).push(stack);

  const key = `${name}|${event}`;
  let row = summary.get(key);
  if (!row) {
    row = { instances: new Set(), peak: 0, stacks: null, stackId: null };
    summary.set(key, row);
  }
  row.instances.add(entry.id);

  if (count > row.peak) {
    row.peak = count;
    if (count >= AT) {
      row.stacks = entry.stacks[event].slice();
      row.stackId = entry.id;
    }
  }
}

for (const method of ["on", "addListener", "once", "prependListener", "prependOnceListener"]) {
  const original = EventEmitter.prototype[method];
  EventEmitter.prototype[method] = function patched(event, listener) {
    const result = original.call(this, event, listener);
    // Never let the probe break the program it is measuring.
    try {
      record(this, event);
    } catch {
      /* ignore */
    }
    return result;
  };
}

function dump(reason) {
  const lines = ["", `===== listener probe (${reason}) =====`];
  const rows = [...summary.entries()].sort((a, b) => b[1].peak - a[1].peak);
  if (rows.length === 0) lines.push(`(nothing seen for: ${WATCH.join(", ")})`);
  for (const [key, row] of rows) {
    lines.push(`${key}: peak=${row.peak} on one instance, instances=${row.instances.size}`);
  }
  for (const [key, row] of rows) {
    if (!row.stacks) continue;
    lines.push("", `--- all ${row.stacks.length} '${key}' adds on instance #${row.stackId} ---`);
    row.stacks.forEach((stack, i) => lines.push(`  [add ${i + 1}]`, stack));
  }
  lines.push("===== end listener probe =====");
  const text = `${lines.join("\n")}\n`;
  try {
    fs.appendFileSync(OUT, text);
  } catch {
    // A read-only or missing path must not take the server down; stdout still has it.
  }
  process.stdout.write(text);
}

process.on("SIGUSR2", () => dump("SIGUSR2"));
process.on("exit", () => dump("exit"));

// Say so on the way up. Without this a probe that failed to load and one that saw nothing worth
// reporting look identical in a log, which is the distinction the whole exercise turns on.
process.stdout.write(
  `[listener-probe] active: watching ${WATCH.join(", ")}, stacks at >=${AT}` +
    (INTERVAL_MIN > 0 ? `, dumping every ${INTERVAL_MIN} min` : ", dump on SIGUSR2 or exit") +
    "\n",
);

if (INTERVAL_MIN > 0) {
  // unref: a diagnostic must never be the thing that keeps a process alive.
  setInterval(() => dump(`every ${INTERVAL_MIN} min`), INTERVAL_MIN * 60_000).unref();
}
