import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

// A real repository under a temporary directory, with linked worktrees of its own, so that
// allocation reads a `git worktree list` this suite controls rather than the one it runs in. The
// realpath matters: the script compares `pwd -P` against what git prints, and macOS's temporary
// directory sits behind a symlink.
function makeRepo(linked: number) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "dev-slot-repo-")));
  const main = path.join(dir, "main");
  mkdirSync(main);
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.invalid",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.invalid",
      },
    });
    assert.equal(result.status, 0, result.stderr);
  };
  git(main, "init", "-q");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  const worktrees: string[] = [];
  for (let i = 1; i <= linked; i++) {
    const wt = path.join(dir, `wt${i}`);
    git(main, "worktree", "add", "-q", "--detach", wt);
    worktrees.push(wt);
  }
  // Each script is copied into the worktree it should answer for: both resolve their worktree from
  // their own location, so a copy can only ever touch this temporary tree.
  const install = (wt: string) => {
    mkdirSync(path.join(wt, "scripts"), { recursive: true });
    for (const name of ["dev-slot.sh", "e2e-db.sh"]) {
      copyFileSync(path.join(repoRoot, "scripts", name), path.join(wt, "scripts", name));
    }
    return path.join(wt, "scripts", "dev-slot.sh");
  };
  return { dir, main, worktrees, install };
}

// No STAMPORAMA_SLOT inherited from whoever runs the suite: it would pin a slot and skip allocation.
function cleanEnv(extra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.STAMPORAMA_SLOT;
  return env;
}

describe("an exhausted slot pool (#1203)", () => {
  it("stops before writing .env.slot or starting a container, and says how to free a slot", () => {
    const { dir, worktrees, install } = makeRepo(10);
    try {
      worktrees.slice(0, 9).forEach((wt, i) => writeFileSync(path.join(wt, ".env.slot"), `STAMPORAMA_SLOT=${i + 1}\n`));
      const tenth = worktrees[9];
      const script = install(tenth);
      const slotFile = path.join(tenth, ".env.slot");

      for (const verb of ["env", "number"]) {
        const result = spawnSync(script, [verb], { encoding: "utf8", timeout: 30_000, env: cleanEnv() });
        assert.notEqual(result.status, 0, `${verb} succeeded:\n${result.stdout}`);
        assert.match(result.stderr, /every slot 1\.\.9 is held/, verb);
        assert.match(result.stderr, /pnpm e2e:db:down/, verb);
        assert.match(result.stderr, /pnpm slot release/, verb);
        assert.doesNotMatch(result.stderr, /syntax error/, verb);
        assert.equal(result.stdout, "", `${verb} printed something to act on:\n${result.stdout}`);
        assert.equal(existsSync(slotFile), false, `${verb} wrote an .env.slot`);
      }

      // The integration suite's own entry point, with a `docker` that only records being called: the
      // run must end before Compose is asked for anything.
      const bin = path.join(dir, "bin");
      mkdirSync(bin);
      const calls = path.join(dir, "docker-calls");
      writeFileSync(path.join(bin, "docker"), `#!/bin/sh\necho "$@" >> '${calls}'\n`);
      chmodSync(path.join(bin, "docker"), 0o755);
      const suite = spawnSync(path.join(tenth, "scripts", "e2e-db.sh"), ["test"], {
        encoding: "utf8",
        timeout: 30_000,
        env: cleanEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }),
      });
      assert.notEqual(suite.status, 0, suite.stdout);
      assert.match(suite.stderr, /every slot 1\.\.9 is held/);
      assert.equal(existsSync(calls), false, `docker was called:\n${existsSync(calls) ? readFileSync(calls, "utf8") : ""}`);
      assert.equal(existsSync(slotFile), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still allocates the lowest free number when one is left", () => {
    const { dir, worktrees, install } = makeRepo(3);
    try {
      writeFileSync(path.join(worktrees[0], ".env.slot"), "STAMPORAMA_SLOT=1\n");
      const script = install(worktrees[2]);
      const result = spawnSync(script, ["number"], { encoding: "utf8", timeout: 30_000, env: cleanEnv() });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), "2");
      assert.match(readFileSync(path.join(worktrees[2], ".env.slot"), "utf8"), /^STAMPORAMA_SLOT=2$/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("dev-slot.sh show is a read (#922)", () => {
  it("does not take back a slot that was just released", () => {
    const { dir, worktrees, install } = makeRepo(1);
    try {
      const wt = worktrees[0];
      const script = install(wt);
      const slotFile = path.join(wt, ".env.slot");
      writeFileSync(slotFile, "STAMPORAMA_SLOT=4\n");

      const released = spawnSync(script, ["release"], { encoding: "utf8", timeout: 30_000, env: cleanEnv() });
      assert.equal(released.status, 0, released.stderr);

      const shown = spawnSync(script, ["show"], { encoding: "utf8", timeout: 30_000, env: cleanEnv() });
      assert.equal(shown.status, 0, shown.stderr);
      assert.equal(existsSync(slotFile), false, "show allocated a slot");
      assert.match(shown.stdout, /\(no slot yet\) <- this worktree/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
