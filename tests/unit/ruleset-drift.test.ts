import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `scripts/check-ruleset.mjs` compares `.github/rulesets/main.json` to the live ruleset (#946). Two
// properties of it are worth pinning here rather than discovering from a red mail at 06:20.
//
// **First, that its normaliser reproduces the artifact byte for byte.** The normalisation contract
// belongs to `.github/rulesets/README.md`, which derives the file with a `jq` pipeline; the script
// re-implements that contract in JavaScript. If the two ever disagree, `--write` rewrites a file
// nobody changed and every reader afterwards is looking at churn instead of a decision. The
// difference is not hypothetical, and it was measured rather than argued: the sibling
// implementation in `darkroom` keeps `source` and sorts every array by the canonical JSON of its
// elements *instead of* by the two keys this repository's pipeline names. Both divergences were
// re-introduced here as mutations and both turn the first case red — the ordering one because
// canonical-JSON order puts the two rules carrying `parameters` first, and `source` because it is
// content this artifact strips and that one does not.
//
// What does **not** turn it red is adding that array sort *on top of* the named sorts, since the
// named sorts run afterwards and win. Said plainly because it is the useful half: the contract is
// carried by `sort_by(.type)` and `sort_by(.context)`, and a future edit that keeps them can sort
// as much else as it likes.
//
// **Second, that a declared blind spot does not suppress a real finding.** That is the property
// dev-agent's `decisions/0005` says the whole design lives or dies on, and it is the one a check
// can silently lose while staying green — `--allow-unverifiable=bypass_actors` is passed on every
// scheduled run this repository makes today.
//
// Nothing here reaches the network. `gh` is stubbed on `PATH` and the "live" response is built from
// the committed artifact by adding back the volatile fields and **reversing every key and array
// order**, so a normaliser that merely echoed its input would fail the first case rather than pass
// it. The same trick is why there is no recorded fixture: a second copy of the ruleset in this
// repository would be one more thing to go stale, which is the failure the artifact exists to end.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(repoRoot, "scripts", "check-ruleset.mjs");
const ARTIFACT = path.join(repoRoot, ".github", "rulesets", "main.json");
const REPO = "michalwy/stamporama";
const RULESET_ID = 22358128;

const committed = readFileSync(ARTIFACT, "utf8");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Reverse key order at every level and reverse every array, so no ordering is accidentally right. */
function scramble(value: Json): Json {
  if (Array.isArray(value)) return value.map(scramble).reverse();
  if (value === null || typeof value !== "object") return value;
  const out: { [key: string]: Json } = {};
  for (const key of Object.keys(value).reverse()) out[key] = scramble(value[key]);
  return out;
}

/**
 * What the API returns: the artifact, scrambled, plus the fields the contract strips. `source` is
 * among them because this repository strips it and `darkroom` does not — the one place the two
 * normalisers genuinely disagree about content rather than order.
 */
function liveResponse(mutate: (ruleset: Record<string, Json>) => void = () => {}) {
  const ruleset = scramble(JSON.parse(committed) as Json) as Record<string, Json>;
  const full: Record<string, Json> = {
    id: RULESET_ID,
    node_id: "RRS_lADO",
    created_at: "2026-09-06T10:00:00Z",
    updated_at: "2026-09-07T18:00:00Z",
    _links: { self: { href: `https://api.github.com/repos/${REPO}/rulesets/${RULESET_ID}` } },
    source: REPO,
    current_user_can_bypass: "never",
    ...ruleset,
  };
  mutate(full);
  return full;
}

/**
 * A `gh` on `PATH` that answers the three calls the script makes and refuses anything else, so a
 * new API call cannot slip through unnoticed as a passing test.
 */
function workspace(live: Record<string, Json>, artifact = committed, rulesets?: Json[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "ruleset-drift-"));
  mkdirSync(path.join(dir, ".github", "rulesets"), { recursive: true });
  mkdirSync(path.join(dir, "bin"), { recursive: true });
  writeFileSync(path.join(dir, ".github", "rulesets", "main.json"), artifact);
  writeFileSync(path.join(dir, "live.json"), JSON.stringify(live));
  writeFileSync(
    path.join(dir, "rulesets.json"),
    JSON.stringify(rulesets ?? [{ id: RULESET_ID, name: "main", target: "branch" }]),
  );

  const gh = path.join(dir, "bin", "gh");
  writeFileSync(
    gh,
    [
      "#!/bin/sh",
      `case "$*" in`,
      `  "api repos/${REPO} --jq .default_branch") echo main ;;`,
      `  "api repos/${REPO}/rulesets") cat "${dir}/rulesets.json" ;;`,
      `  "api repos/${REPO}/rulesets/${RULESET_ID}") cat "${dir}/live.json" ;;`,
      `  *) echo "unexpected gh call: $*" >&2; exit 1 ;;`,
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(gh, 0o755);
  return dir;
}

function run(dir: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      PATH: `${path.join(dir, "bin")}:${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: REPO,
      // Annotations are asserted on explicitly below; every other case runs as if by hand.
      GITHUB_ACTIONS: "",
    },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/** A ruleset with one required context missing — the drift a person would most want reported. */
function withoutIntegrationTests(ruleset: Record<string, Json>) {
  const rules = ruleset.rules as { type: string; parameters?: Record<string, Json> }[];
  const checks = rules.find((rule) => rule.type === "required_status_checks");
  const contexts = checks?.parameters?.required_status_checks as { context: string }[];
  checks!.parameters!.required_status_checks = contexts.filter(
    (check) => check.context !== "Integration tests",
  );
}

describe("the ruleset drift check", () => {
  it("re-derives the committed artifact byte for byte, whatever order the API answers in", () => {
    const dir = workspace(liveResponse());
    // Written over a deliberately corrupted copy, so a script that wrote nothing would fail here.
    writeFileSync(path.join(dir, ".github", "rulesets", "main.json"), "{}\n");
    const { status, output } = run(dir, "--write");
    assert.equal(status, 0, output);
    assert.equal(readFileSync(path.join(dir, ".github", "rulesets", "main.json"), "utf8"), committed);
  });

  it("passes when the artifact and the ruleset agree", () => {
    const { status, output } = run(workspace(liveResponse()));
    assert.equal(status, 0, output);
    assert.match(output, /passed/);
    assert.match(output, /including bypass_actors/);
  });

  it("reports drift field by field, and names the rule rather than an index", () => {
    const { status, output } = run(workspace(liveResponse(withoutIntegrationTests)));
    assert.equal(status, 1, output);
    assert.match(output, /does not match/);
    assert.match(output, /required_status_checks\]/);
    assert.match(output, /Integration tests/);
  });

  describe("under a token that cannot read bypass_actors", () => {
    const blind = (mutate: (ruleset: Record<string, Json>) => void = () => {}) =>
      liveResponse((ruleset) => {
        delete ruleset.bypass_actors;
        mutate(ruleset);
      });

    it("fails when the blind spot is undeclared", () => {
      const { status, output } = run(workspace(blind()));
      assert.equal(status, 1, output);
      assert.match(output, /could not see bypass_actors/);
      assert.match(output, /RULESET_READ_TOKEN/);
    });

    it("passes when it is declared, and says on the run what it did not check", () => {
      const { status, output } = run(workspace(blind()), "--allow-unverifiable=bypass_actors");
      assert.equal(status, 0, output);
      assert.match(output, /NOT VERIFIED: bypass_actors/);
    });

    // The property `decisions/0005` says the design lives or dies on: a declared gap must not
    // suppress a real finding. A check that lost this would be green every day and look identical.
    it("still reports real drift while the declaration is in force", () => {
      const { status, output } = run(
        workspace(blind(withoutIntegrationTests)),
        "--allow-unverifiable=bypass_actors",
      );
      assert.equal(status, 1, output);
      assert.match(output, /Integration tests/);
      assert.match(output, /Not checked, by declaration: bypass_actors/);
    });

    it("refuses to write an artifact it cannot see the whole of", () => {
      const dir = workspace(blind());
      const { status, output } = run(dir, "--write", "--allow-unverifiable=bypass_actors");
      assert.equal(status, 1, output);
      assert.match(output, /cannot write the artifact/);
      // The declaration deliberately does not reach `--write`: the file is unchanged.
      assert.equal(readFileSync(path.join(dir, ".github", "rulesets", "main.json"), "utf8"), committed);
    });
  });

  it("tells the caller to drop a declaration the token no longer needs", () => {
    const { status, output } = run(workspace(liveResponse()), "--allow-unverifiable=bypass_actors");
    assert.equal(status, 0, output);
    assert.match(output, /no longer needed/);
  });

  // The escape hatch the enumerated allowlist exists to close: `rules` is a top-level key, so a
  // key-prefix rule would let every required context, linear history and the merge methods out
  // through one flag, wearing the appearance of a reviewed concession.
  it("refuses to exclude anything but an observed-redactable field", () => {
    const { status, output } = run(workspace(liveResponse()), "--allow-unverifiable=rules");
    assert.equal(status, 1, output);
    assert.match(output, /cannot exclude rules/);
  });

  it("reports a second branch ruleset as drift rather than going quiet", () => {
    const { status, output } = run(
      workspace(liveResponse(), committed, [
        { id: RULESET_ID, name: "main", target: "branch" },
        { id: 999, name: "all-branches", target: "branch" },
      ]),
    );
    assert.equal(status, 1, output);
    assert.match(output, /2 branch rulesets/);
  });

  describe("its annotations", () => {
    const underActions = (dir: string, ...args: string[]) => {
      const result = spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: dir,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          PATH: `${path.join(dir, "bin")}:${process.env.PATH ?? ""}`,
          GITHUB_REPOSITORY: REPO,
          GITHUB_ACTIONS: "true",
        },
      });
      return `${result.stdout ?? ""}${result.stderr ?? ""}`;
    };

    // A state somebody has already agreed to live with is a notice; one that asks for an action is
    // a warning. Neither is red, and neither is only in the log of a green run.
    it("names a declared gap as a notice", () => {
      const blind = liveResponse((ruleset) => delete ruleset.bypass_actors);
      assert.match(
        underActions(workspace(blind), "--allow-unverifiable=bypass_actors"),
        /::notice title=ruleset drift::/,
      );
    });

    it("raises a warning when the declaration has become unnecessary", () => {
      assert.match(
        underActions(workspace(liveResponse()), "--allow-unverifiable=bypass_actors"),
        /::warning title=stale declaration::/,
      );
    });
  });
});
