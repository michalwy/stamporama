import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The safe list of `Detect changes` decides which pull requests skip four of the five required
// checks, so a pattern that matched too widely would let application code reach `main` on a green
// tick that tested nothing — silently (#983). Before this file the only check on it was eleven
// paths tried by hand, once, when `renovate.json` joined it (#970).
//
// It runs `scripts/detect-changes.sh` itself, the same file the job runs, with `gh` replaced by a
// stub that answers with a file list this suite chooses. What that leaves untested is the `--jq`
// filter that turns GitHub's answer into that list; this suite starts from the list.
//
// **The cases are the point, in both directions.** Every path the issue named is here, and so are
// the two traps: `sub/renovate.json` and `renovate.json5` must run everything, because the entry is
// a filename and not a glob, and a `case` glob's `*` crosses `/`. A path added to the safe list
// needs a case here, inside; a widening needs the outside cases to still hold.
//
// This suite runs under `Unit tests`, which the script can skip. The script therefore refuses on its
// own to treat itself or the workflow as safe — the canary in it — so a list wide enough to hide
// this suite runs the suite instead. `scripts/detect-changes.sh` and `.github/workflows/ci.yml` are
// among the outside cases below for the same reason.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const script = path.join(repoRoot, "scripts", "detect-changes.sh");

let dir: string;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "detect-changes-"));
  const gh = path.join(dir, "gh");
  writeFileSync(
    gh,
    [
      "#!/usr/bin/env bash",
      'printf "%s\\n" "$*" >> "$STUB_GH_LOG"',
      '[ -z "${STUB_GH_FAIL:-}" ] || exit 1',
      'printf "%s" "$STUB_GH_FILES"',
      "",
    ].join("\n"),
  );
  chmodSync(gh, 0o755);
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Run = {
  files?: string[];
  event?: string;
  ref?: string;
  before?: string;
  ghFails?: boolean;
};

function detect({
  files = [],
  event = "pull_request",
  ref = "refs/pull/1/merge",
  before = "1111111111111111111111111111111111111111",
  ghFails = false,
}: Run = {}) {
  const output = path.join(dir, `output-${Math.random().toString(36).slice(2)}`);
  const log = path.join(dir, `gh-${Math.random().toString(36).slice(2)}`);
  writeFileSync(output, "");
  writeFileSync(log, "");
  // A fresh environment rather than `process.env`: under CI this suite runs inside a GitHub job,
  // whose own `GITHUB_*` variables must not leak into the run being tested.
  const result = spawnSync("bash", [script], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? dir,
      // Required by Next's `ProcessEnv` typing; the script never reads it.
      NODE_ENV: "test",
      GITHUB_REF: ref,
      GITHUB_OUTPUT: output,
      EVENT_NAME: event,
      REPOSITORY: "owner/repo",
      BEFORE: before,
      AFTER: "2222222222222222222222222222222222222222",
      PR_NUMBER: "1",
      STUB_GH_FILES: files.join("\n"),
      STUB_GH_LOG: log,
      ...(ghFails ? { STUB_GH_FAIL: "1" } : {}),
    },
  });
  assert.equal(result.status, 0, `the script must never fail; stderr:\n${result.stderr}`);
  const code = readFileSync(output, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("code="));
  assert.equal(code.length, 1, `expected exactly one code= line, got:\n${code.join("\n")}`);
  return { code: code[0], stdout: result.stdout, gh: readFileSync(log, "utf8") };
}

const INSIDE = [
  "README.md",
  "docs/agents/albums.md",
  "extension/README.md",
  ".claude/plans/x.md",
  "renovate.json",
];

const OUTSIDE = [
  "package.json",
  "tsconfig.json",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yml",
  "prisma/schema.prisma",
  "src/lib/x.ts",
  "scripts/e2e-db.sh",
  "scripts/detect-changes.sh",
  "extension/src/background.ts",
  // The traps: a filename, not a glob.
  "sub/renovate.json",
  "renovate.json5",
];

describe("detect-changes.sh, the safe list", () => {
  for (const file of INSIDE) {
    it(`skips the suite for ${file} alone`, () => {
      assert.equal(detect({ files: [file] }).code, "code=false");
    });
  }

  for (const file of OUTSIDE) {
    it(`runs everything for ${file}`, () => {
      const { code, stdout } = detect({ files: [file] });
      assert.equal(code, "code=true");
      assert.match(stdout, new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is outside the safe list`));
    });
  }

  it("skips the suite when every file is inside", () => {
    assert.equal(detect({ files: INSIDE }).code, "code=false");
  });

  it("runs everything when one file of an otherwise safe diff is outside, wherever it sits", () => {
    // The question is whether the whole diff is inside, never whether part of it is.
    for (const position of [0, 2, INSIDE.length]) {
      const files = [...INSIDE];
      files.splice(position, 0, "src/lib/x.ts");
      assert.equal(detect({ files }).code, "code=true", files.join(", "));
    }
  });

  it("reads a push's files from the compare endpoint", () => {
    const { code, gh } = detect({ event: "push", files: ["docs/agents/albums.md"] });
    assert.equal(code, "code=false");
    assert.match(gh, /compare\/1{40}\.\.\.2{40}/);
  });
});

describe("detect-changes.sh, when it cannot answer", () => {
  it("runs everything for a tag, without asking GitHub", () => {
    const { code, gh } = detect({ ref: "refs/tags/v1.2.3", files: ["README.md"] });
    assert.equal(code, "code=true");
    assert.equal(gh, "");
  });

  it("runs everything when the file list cannot be fetched", () => {
    assert.equal(detect({ ghFails: true, files: ["README.md"] }).code, "code=true");
    assert.equal(detect({ event: "push", ghFails: true, files: ["README.md"] }).code, "code=true");
  });

  it("runs everything when the file list is empty", () => {
    assert.equal(detect({ files: [] }).code, "code=true");
  });

  it("runs everything for a push with no previous commit", () => {
    for (const before of ["", "0".repeat(40)]) {
      assert.equal(detect({ event: "push", before, files: ["README.md"] }).code, "code=true");
    }
  });

  it("runs everything for an event that carries no diff", () => {
    assert.equal(detect({ event: "workflow_dispatch", files: ["README.md"] }).code, "code=true");
  });
});
