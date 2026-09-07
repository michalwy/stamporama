// Per-file timings for the integration suite (#880).
//
// Run it through `pnpm test:integration:time`, which brings this worktree's database up first.
// It spawns each `tests/integration/*.test.ts` as its own process behind a fixed-size worker
// pool — which is what `node --test` does anyway — and reports the wall clock of each one. So
// the total it prints is the suite's total, and the per-file numbers add up to it.
//
// **Pass the concurrency you are asking about.** The default is this machine's core count, which
// is the number `pnpm test:integration` uses locally and is usually nothing like CI's: a GitHub
// `ubuntu-latest` runner has 4 cores, so `pnpm test:integration:time 4` is the run that answers
// "why does CI take that long". Comparing a 16-way local run against a 4-way CI one is how a
// suite comes to look four times healthier than it is.
//
// What it is for is attribution, and the failure it exists to prevent is fixing the wrong thing.
// The first measurement taken with it (2026-09-07) found no slow files at all — a flat 10.4 s
// floor under 134 of the 142, which turned out to be the connection pool holding each process
// open after its last query rather than anything a test did. Sharding across databases, the
// obvious fix at the time, would have divided that idle wait by the number of shards and left
// every second of it in place.

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "tests/integration");

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => path.join("tests/integration", f))
  .sort();

const concurrency = Number(process.argv[2]) || availableParallelism();

const results = [];
let next = 0;

async function worker() {
  while (next < files.length) {
    const file = files[next++];
    const started = Date.now();
    const code = await new Promise((resolve) => {
      const child = spawn(
        path.join(root, "node_modules/.bin/tsx"),
        ["--tsconfig", "tests/integration/tsconfig.json", "--test", file],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.on("close", (status) => {
        const tests = output.match(/^# tests (\d+)/m);
        results.push({ file, ms: Date.now() - started, status, tests: Number(tests?.[1] ?? 0) });
        resolve(status);
      });
    });
    if (code !== 0) console.error(`FAILED  ${file}`);
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const wall = Date.now() - started;

results.sort((a, b) => b.ms - a.ms);
for (const r of results) {
  console.log(
    `${String(r.ms).padStart(7)} ms  ${String(r.tests).padStart(4)} tests  ` +
      `${r.status === 0 ? "    " : "FAIL"}  ${r.file}`,
  );
}

const total = results.reduce((sum, r) => sum + r.ms, 0);
const median = [...results].sort((a, b) => a.ms - b.ms)[Math.floor(results.length / 2)].ms;
const failures = results.filter((r) => r.status !== 0).length;

// The gap between `sum` and `wall x concurrency` is how much of the pool sat empty. Close to
// zero means the files pack well and the total is genuinely the sum of the parts — so a suite
// that is too slow is then too slow everywhere, not because of one long file at the end.
console.log(
  `\n${results.length} files, ${results.reduce((sum, r) => sum + r.tests, 0)} tests, ` +
    `${failures} failing\n` +
    `wall ${(wall / 1000).toFixed(1)} s at concurrency ${concurrency}, ` +
    `sum ${(total / 1000).toFixed(1)} s, median file ${(median / 1000).toFixed(1)} s, ` +
    `pool utilisation ${((total / (wall * concurrency)) * 100).toFixed(0)}%`,
);

if (failures > 0) process.exitCode = 1;
