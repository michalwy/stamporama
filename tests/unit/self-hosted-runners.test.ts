import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `scripts/check-self-hosted-runners.mjs` keeps every workflow but `deploy.yml` off self-hosted
// runners (#2689): the repository is public and the one self-hosted runner is the owner's Raspberry
// Pi. This is the CI check the owner asked for — it runs inside the required `Unit tests` job, which
// any change under `.github/` triggers — so its first case is the tree as it stands, and the rest
// pin that it actually fails on the shapes it exists to catch. A check that passes everything looks
// exactly like one that passes the tree.
//
// The script is run rather than imported: `allowJs` is off, and running it is also how its exit
// status — the thing CI reads — gets tested.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(repoRoot, "scripts", "check-self-hosted-runners.mjs");

function run(root: string) {
  return spawnSync(process.execPath, [SCRIPT, root], { encoding: "utf8", timeout: 30_000 });
}

/** A repository root holding exactly these workflows. */
function tree(workflows: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "self-hosted-"));
  mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  for (const [name, text] of Object.entries(workflows)) {
    writeFileSync(path.join(root, ".github", "workflows", name), text);
  }
  return root;
}

const job = (runsOn: string, extra = "") =>
  `name: X\non:\n  pull_request:\njobs:\n  build:\n${extra}    runs-on: ${runsOn}\n    steps:\n      - run: echo hi\n`;

const DEPLOY = "name: Deploy\non:\n  release:\n    types: [published]\njobs:\n  deploy:\n    runs-on: [self-hosted, pi, stamporama]\n";

describe("check-self-hosted-runners", () => {
  it("passes the workflows as they are in this repository", () => {
    const result = run(repoRoot);
    assert.equal(result.status, 0, result.stderr);
  });

  it("allows deploy.yml its self-hosted runner, and GitHub-hosted runners elsewhere", () => {
    const result = run(
      tree({
        "deploy.yml": DEPLOY,
        "ci.yml": job("ubuntu-latest"),
        "quoted.yml": job('"windows-2025"  # a comment'),
        "matrix.yml": job(
          "${{ matrix.runner }}",
          "    strategy:\n      matrix:\n        include:\n          - runner: ubuntu-latest\n          - runner: ubuntu-24.04-arm\n",
        ),
      }),
    );
    assert.equal(result.status, 0, result.stderr);
  });

  const bad: Record<string, string> = {
    "the label itself": job("self-hosted"),
    "the label in a list": job("[self-hosted, linux, arm64]"),
    "the word anywhere, a comment included": `# runs on self-hosted\n${job("ubuntu-latest")}`,
    "the Pi's own label, without self-hosted": job("pi"),
    "the Pi's labels as a list": job("[pi, stamporama]"),
    "a runner group": job("", "").replace("runs-on: \n", "runs-on:\n      group: home\n"),
    "a variable": job("${{ vars.RUNNER }}"),
    "a matrix that names a self-hosted label": job(
      "${{ matrix.runner }}",
      "    strategy:\n      matrix:\n        runner: [ubuntu-latest]\n        include:\n          - runner: pi\n",
    ),
    "a matrix key that cannot be found": job("${{ matrix.host }}"),
    "another workflow named like deploy": job("self-hosted").replace("name: X", "name: Deploy"),
  };

  for (const [what, text] of Object.entries(bad)) {
    it(`fails on ${what}`, () => {
      const result = run(tree({ "deploy.yml": DEPLOY, "other.yml": text }));
      assert.equal(result.status, 1, `expected a failure, got:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /other\.yml:\d+:/);
    });
  }
});
