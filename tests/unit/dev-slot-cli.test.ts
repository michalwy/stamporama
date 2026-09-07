import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The slot mechanism is a shell script (#781), so what this pins is the *wiring* rather than any
// logic: `package.json` must declare `scripts/dev-slot.sh` with no verb of its own, because pnpm
// **appends** a script's arguments instead of inserting them. It carried `dev-slot.sh show` for as
// long as the command existed, which put `show` in `$1` and pushed the caller's verb into `$2`,
// where nothing read it — so `pnpm slot release` printed the table and released nothing (#913).
//
// It runs the declaration the way pnpm does — the string from `package.json` with the arguments
// appended, in a shell — rather than spawning `pnpm` itself. Not to be quick about it: `pnpm run`
// reconciles `node_modules` against the lockfile before it runs anything, so spawning it five
// times would make a *unit* suite perform installs. What that leaves untested is pnpm's own
// appending, and that is covered elsewhere by a person: `pnpm` is on the never-alone list in
// `renovate.json`, so no bump of it reaches `main` without being read (docs/agents/collaboration.md).
//
// Nothing here runs the `release` verb against this worktree: it would delete a live `.env.slot`.
// The verb is exercised below against a throwaway copy of the script instead.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const PINNED_SLOT = "7";

const slotScript = (
  JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts.slot;

function runSlot(...args: string[]) {
  // STAMPORAMA_SLOT is pinned so `resolve_slot` returns before it can allocate: this suite never
  // writes a `.env.slot` into the worktree it is running in.
  const result = spawnSync("sh", ["-c", [slotScript, ...args].join(" ")], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, STAMPORAMA_SLOT: PINNED_SLOT },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("the `slot` script in package.json", () => {
  it("declares dev-slot.sh with no verb of its own", () => {
    assert.equal(slotScript, "scripts/dev-slot.sh");
  });

  it("passes the verb through", () => {
    // The case that fails against the old declaration: it printed the table here.
    const { status, stdout } = runSlot("number");
    assert.equal(status, 0);
    assert.ok(
      stdout.split("\n").some((line) => line.trim() === PINNED_SLOT),
      `expected a line reading "${PINNED_SLOT}", got:\n${stdout}`,
    );
    assert.ok(!stdout.includes("e2e-db"), `the verb was dropped and the table printed:\n${stdout}`);
  });

  it("still prints the table when given no verb", () => {
    // The trap in fixing the above: dev-slot.sh used to default to `env`, so dropping the verb
    // from package.json without changing that default would have made bare `pnpm slot` print
    // `export` lines — which README.md and docs/agents/platform.md both say prints the table.
    const { status, stdout } = runSlot();
    assert.equal(status, 0);
    assert.ok(stdout.includes("e2e-db"), `expected the table header, got:\n${stdout}`);
    assert.ok(!stdout.includes("export STAMPORAMA_SLOT="), `expected the table, got env:\n${stdout}`);
  });

  it("still reaches the export lines scripts/e2e-db.sh evals", () => {
    const { status, stdout } = runSlot("env");
    assert.equal(status, 0);
    assert.ok(stdout.includes(`export STAMPORAMA_SLOT=${PINNED_SLOT}`), stdout);
  });

  it("rejects a second argument rather than ignoring it", () => {
    // Silently dropping it is the defect itself, one level down.
    const { status, stderr } = runSlot("show", "release");
    assert.notEqual(status, 0);
    assert.match(stderr, /one verb at a time/);
  });

  it("rejects an unknown verb", () => {
    const { status, stderr } = runSlot("bogus");
    assert.notEqual(status, 0);
    assert.match(stderr, /usage:/);
  });
});

describe("dev-slot.sh release", () => {
  it("removes the worktree's .env.slot, and says so when there is none", () => {
    // Against a throwaway copy of the script, never the worktree this suite runs in: `release`
    // resolves its target from the script's own location, so a copy under a temporary directory
    // can only ever delete that directory's own file.
    const dir = mkdtempSync(path.join(tmpdir(), "dev-slot-"));
    try {
      mkdirSync(path.join(dir, "scripts"));
      const script = path.join(dir, "scripts", "dev-slot.sh");
      copyFileSync(path.join(repoRoot, "scripts", "dev-slot.sh"), script);
      const slotFile = path.join(dir, ".env.slot");
      writeFileSync(slotFile, "STAMPORAMA_SLOT=8\n");

      const released = spawnSync(script, ["release"], { encoding: "utf8", timeout: 30_000 });
      assert.equal(released.status, 0, released.stderr);
      assert.match(released.stdout, /^released:/);
      assert.equal(existsSync(slotFile), false);

      const again = spawnSync(script, ["release"], { encoding: "utf8", timeout: 30_000 });
      assert.equal(again.status, 0, again.stderr);
      assert.match(again.stdout, /^nothing to release:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
