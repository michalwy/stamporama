import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `scripts/check-renovate-automerge.mjs` is what stands between a `renovate.json` edit and a
// never-alone dependency automerging (#818). Its own workflow runs it on the pull request that edits
// the file; this suite pins that it **fails** on the shapes it exists to catch, each one a mutation
// of the real file, so a check that has quietly stopped discriminating goes red here.
//
// The script is run rather than imported: `allowJs` is off, and running it is also how the workflow
// sees it. Pure by construction — a temp directory, a JSON file and a child `node`.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = path.join(repoRoot, "scripts", "check-renovate-automerge.mjs");

type Rule = Record<string, unknown> & { matchDepNames?: string[]; matchUpdateTypes?: string[] };
type Config = Record<string, unknown> & { extends: string[]; packageRules: Rule[] };

const real = readFileSync(path.join(repoRoot, "renovate.json"), "utf8");

function run(config: Config | string) {
  const dir = mkdtempSync(path.join(tmpdir(), "renovate-automerge-"));
  writeFileSync(path.join(dir, "renovate.json"), typeof config === "string" ? config : JSON.stringify(config));
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8", timeout: 30_000 });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** The real file, changed by `edit` — asserted actually changed, so a no-op mutation cannot pass. */
function mutated(edit: (config: Config) => void): Config {
  const config = JSON.parse(real) as Config;
  edit(config);
  assert.notEqual(JSON.stringify(config), JSON.stringify(JSON.parse(real)), "the mutation changed nothing");
  return config;
}

function assertFails(config: Config, expected: RegExp) {
  const { status, output } = run(config);
  assert.equal(status, 1, `expected the check to fail, it exited ${status}:\n${output}`);
  assert.match(output, expected);
}

describe("check-renovate-automerge", () => {
  it("passes on the renovate.json in this tree", () => {
    const { status, output } = run(real);
    assert.equal(status, 0, output);
    assert.match(output, /never-alone dependencies automerge nothing/);
  });

  // The trap #814 nearly shipped: matchPackageNames reads packageName, and the CI Node pin's
  // packageName is actions/node-versions, so the exclusion would not have held Node back.
  it("refuses matchPackageNames, the matcher that misses the CI Node pin", () => {
    assertFails(
      mutated((c) => {
        c.packageRules[0].matchPackageNames = c.packageRules[0].matchDepNames;
        delete c.packageRules[0].matchDepNames;
      }),
      /"matchPackageNames" is not modelled.*actions\/node-versions/,
    );
  });

  // Later rules win. With the exclusions gone the batch relies on order alone, and placed after the
  // never-alone groups it overrides them.
  it("fails when the order lets the batch override the never-alone groups", () => {
    assertFails(
      mutated((c) => {
        const [batch, ...rest] = c.packageRules;
        delete batch.matchDepNames;
        c.packageRules = [...rest.slice(0, -1), batch, rest[rest.length - 1]];
      }),
      /next is never-alone but automerges its minor, patch updates/,
    );
  });

  // The counterpart: in the real file the order and the exclusions each protect the list on their
  // own, so the pass above cannot tell whether the negations are read at all. Here only they do.
  it("passes with the batch after the groups while its exclusions hold", () => {
    const { status, output } = run(
      mutated((c) => {
        const [batch, ...rest] = c.packageRules;
        c.packageRules = [...rest.slice(0, -1), batch, rest[rest.length - 1]];
      }),
    );
    assert.equal(status, 0, output);
  });

  it("fails when a later rule automerges a never-alone dependency", () => {
    assertFails(
      mutated((c) => {
        c.packageRules.push({ matchDepNames: ["sharp"], automerge: true });
      }),
      /sharp is never-alone but automerges/,
    );
  });

  it("fails when a major can automerge", () => {
    assertFails(
      mutated((c) => {
        delete c.packageRules[0].matchUpdateTypes;
        c.packageRules.pop();
      }),
      /a major update to a dependency no rule names automerges/,
    );
  });

  it("fails its positive control when the batch automerges nothing", () => {
    assertFails(
      mutated((c) => {
        c.packageRules[0].automerge = false;
      }),
      /positive control: a patch/,
    );
  });

  it("refuses a preset it has not been checked against", () => {
    assertFails(
      mutated((c) => {
        c.extends.push(":automergeMinor");
      }),
      /"extends" is .* not the verified/,
    );
  });

  it("refuses a glob, which it does not model", () => {
    assertFails(
      mutated((c) => {
        c.packageRules[0].matchDepNames!.push("!@prisma/*");
      }),
      /"!@prisma\/\*" is a glob or regex/,
    );
  });

  it("refuses an unmodelled top-level key that can switch automerge on", () => {
    assertFails(
      mutated((c) => {
        c.major = { automerge: true };
      }),
      /top-level "major" is not modelled/,
    );
  });
});
