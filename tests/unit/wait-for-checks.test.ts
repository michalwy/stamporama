import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `scripts/ci/wait-for-checks.sh` is how a thread waits for CI in one call (#2700), and it decides
// whether the author merges its own pull request — so a green it reports must be a real one. It runs
// the script itself with `gh` replaced by a stub. What that leaves untested is the `--jq` filter
// that turns GitHub's answer into tab-separated lines; the stub starts from those lines. The filter
// was run once against a real merged pull request when the script was written.
//
// The stub answers the pull request read with a fixed head, and the check-runs read with the next
// of a sequence of polls, repeating the last one — so a run can be pending first and green later.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const script = path.join(repoRoot, "scripts", "ci", "wait-for-checks.sh");
const SHA = "abc1230000000000000000000000000000000000";
const REQUIRED = [
  "Closing reference check",
  "Extension checks",
  "Integration tests",
  "Static checks",
  "Unit tests",
];

let dir: string;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wait-for-checks-"));
  const gh = path.join(dir, "gh");
  writeFileSync(
    gh,
    [
      "#!/usr/bin/env bash",
      'case "$*" in',
      `  *"/pulls/"*) echo ${SHA}; exit 0 ;;`,
      "esac",
      'n=$(cat "$STUB_DIR/count" 2>/dev/null || echo 0)',
      'echo $((n + 1)) > "$STUB_DIR/count"',
      'f="$STUB_DIR/poll.$n"',
      '[ -f "$f" ] || f=$(ls "$STUB_DIR"/poll.* | sort -t. -k2 -n | tail -1)',
      'cat "$f"',
      "",
    ].join("\n"),
  );
  chmodSync(gh, 0o755);
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Run = [name: string, status: string, conclusion: string, startedAt: string];

function line([name, status, conclusion, startedAt]: Run) {
  return [name, status, conclusion, startedAt, `https://example.test/${encodeURIComponent(name)}`].join("\t");
}

function all(conclusion: string, status = "completed"): Run[] {
  return REQUIRED.map((name) => [name, status, conclusion, "2026-11-22T10:00:00Z"]);
}

function wait(polls: Run[][], timeout = "60") {
  const stub = mkdtempSync(path.join(dir, "run-"));
  polls.forEach((runs, i) => writeFileSync(path.join(stub, `poll.${i}`), runs.map(line).join("\n") + "\n"));
  const result = spawnSync("bash", [script, "7"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? dir,
      NODE_ENV: "test",
      STUB_DIR: stub,
      GH_REPO_PATH: "owner/repo",
      WAIT_INTERVAL: "0",
      WAIT_TIMEOUT: timeout,
    },
  });
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `exactly one line of output, got:\n${result.stdout}${result.stderr}`);
  return { status: result.status, out: lines[0] };
}

describe("wait-for-checks.sh", () => {
  it("reports green when all five required checks succeed", () => {
    const { status, out } = wait([all("success")]);
    assert.equal(status, 0);
    assert.match(out, new RegExp(`^green ${SHA} PR #7`));
  });

  it("waits through pending polls and then reports once", () => {
    const { status, out } = wait([[], all("none", "in_progress"), all("success")]);
    assert.equal(status, 0, out);
    assert.match(out, /^green /);
  });

  it("reports red, naming the failed check, without waiting for the rest", () => {
    const runs = all("none", "in_progress");
    runs[3] = ["Static checks", "completed", "failure", "2026-11-22T10:00:00Z"];
    const { status, out } = wait([runs]);
    assert.equal(status, 1);
    assert.match(out, /^red .*Static checks=failure https:\/\/example\.test\/Static%20checks/);
  });

  it("counts a skipped suite as green only when Detect changes succeeded", () => {
    const skipped = all("skipped");
    skipped[0] = ["Closing reference check", "completed", "success", "2026-11-22T10:00:00Z"];
    const detect: Run = ["Detect changes", "completed", "success", "2026-11-22T09:59:00Z"];
    assert.equal(wait([[...skipped, detect]]).status, 0);
    const failedDetect: Run = ["Detect changes", "completed", "failure", "2026-11-22T09:59:00Z"];
    const { status, out } = wait([[...skipped, failedDetect]]);
    assert.equal(status, 1);
    assert.match(out, /skipped-without-Detect-changes/);
  });

  it("reads a re-run by its latest start, in either direction", () => {
    const rerunGreen: Run[] = [
      ...all("success"),
      ["Unit tests", "completed", "failure", "2026-11-22T09:00:00Z"],
    ];
    assert.equal(wait([rerunGreen]).status, 0);
    const rerunRed: Run[] = [
      ...all("success"),
      ["Unit tests", "completed", "cancelled", "2026-11-22T11:00:00Z"],
    ];
    assert.equal(wait([rerunRed]).status, 1);
  });

  it("is not green while a required check is missing, and times out naming it", () => {
    const { status, out } = wait([all("success").slice(1)], "0");
    assert.equal(status, 2);
    assert.match(out, /^timeout .*Closing reference check=missing/);
  });

  it("rejects a missing pull request number", () => {
    const result = spawnSync("bash", [script], { encoding: "utf8" });
    assert.equal(result.status, 3);
  });
});
