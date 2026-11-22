import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `.github/workflows/deploy.yml` is the one workflow allowed onto a self-hosted runner — the owner's
// Raspberry Pi, in a public repository — and what keeps that safe is what can start it (#2689).
// The owner decided its triggers, runner, environment, concurrency and repository check on
// 2026-11-22; this pins each of them, so a change to any is a red test and not a quiet edit.
//
// Read as text, like `scripts/check-self-hosted-runners.mjs`: there is no YAML parser among this
// repository's dependencies and one file does not justify adding it. Each assertion therefore
// matches a whole line in the shape the file is written in, and fails — rather than passes — when
// that shape changes.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const text = readFileSync(path.join(repoRoot, ".github", "workflows", "deploy.yml"), "utf8");
const lines = text.split("\n").filter((line) => !/^\s*#/.test(line));

/** The keys directly under a top-level `key:`, at two spaces. */
function childrenOf(key: string) {
  const start = lines.findIndex((line) => line === `${key}:`);
  assert.notEqual(start, -1, `no top-level "${key}:"`);
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = line.match(/^ {2}([A-Za-z_-]+):/);
    if (match) out.push(match[1]);
  }
  return out;
}

const has = (re: RegExp) => lines.some((line) => re.test(line));

describe("deploy workflow", () => {
  it("starts on a published release and by hand, and on nothing else", () => {
    assert.deepEqual(childrenOf("on"), ["release", "workflow_dispatch"]);
    assert.ok(has(/^ {4}types: \[published\]$/), "release must be types: [published]");
  });

  it("never runs for a pull request, a fork or another workflow", () => {
    for (const trigger of ["pull_request", "pull_request_target", "workflow_call", "workflow_run", "push", "schedule"]) {
      assert.ok(!has(new RegExp(`^\\s*${trigger}:`)), `deploy.yml must not have ${trigger}`);
    }
  });

  it("takes the version to deploy as a required input of a manual run", () => {
    assert.ok(has(/^ {6}version:$/));
    assert.ok(has(/^ {8}required: true$/));
  });

  it("runs only in michalwy/stamporama, on the Pi's runner, in the prod environment", () => {
    assert.ok(has(/^ {4}if: github\.repository == 'michalwy\/stamporama'$/));
    assert.ok(has(/^ {4}runs-on: \[self-hosted, pi, stamporama\]$/));
    assert.ok(has(/^ {4}environment: prod$/));
  });

  it("queues a second deploy instead of cancelling the first, and has a timeout", () => {
    assert.ok(has(/^concurrency:$/));
    assert.ok(has(/^ {2}cancel-in-progress: false$/));
    assert.ok(has(/^ {4}timeout-minutes: \d+$/));
  });

  it("puts no expression inside a run: script, where a version string could become shell", () => {
    const start = lines.findIndex((line) => /^\s*run: \|$/.test(line));
    assert.notEqual(start, -1);
    const indent = lines[start].search(/\S/);
    const body = [];
    for (const line of lines.slice(start + 1)) {
      if (line.trim() !== "" && line.search(/\S/) <= indent) break;
      body.push(line);
    }
    assert.ok(body.length > 0);
    assert.ok(!body.some((line) => line.includes("${{")), "use env: for values the script needs");
  });
});
