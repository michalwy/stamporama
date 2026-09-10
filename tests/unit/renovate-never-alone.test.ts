import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `renovate.json` states the never-alone set **twice**, in opposite polarities, and nothing until
// now checked that the two agree. The weekly automerge batch excludes it as a **negated**
// `matchDepNames` list; each never-alone group names the same dependencies **positively**. A
// dependency added to one and not the other is silently automerged, or silently held for ever, and
// both halves look correct on their own — which is why this is a set comparison over the file
// rather than a reading of it (#1116, out of #1113).
//
// **This is a backstop, not a gate, and the difference is the load-bearing part of it.**
// `renovate.json` is *inside* the `Detect changes` safe list in `.github/workflows/ci.yml`, so a
// pull request that touches only that file reports `Unit tests` as **skipped** — this test does not
// run on the change it exists to guard. #1114 is the worked example: a `renovate.json`-only pull
// request, merged 2026-09-10, with `Unit tests`, `Static checks`, `Integration tests` and
// `Extension checks` all `skipping` and only `Closing reference check` reporting. #1115 the same
// afternoon shows the documentation-only shape of it. So drift **cannot survive** — the next pull
// request touching anything outside the safe list turns it red — but it **can land**, minutes or a
// week earlier. Read this file's green as *no drift is in the tree as of the last run that could
// see it*, never as *drift cannot reach `main`*.
//
// **The membership is not restated here, deliberately.** The safe list's record is the `case` glob
// in the `Detect changes` job (`collaboration.md`, *Automerge is the one exception*), and prose that
// copies it drifts from it. **Taking `renovate.json` out of that list to make this suite run on it
// is not the fix**: it would revoke the lead's merge licence over the file, which the user took
// knowingly (#970).
//
// Pure by construction: one `readFileSync` and `JSON.parse`, no import that reaches Prisma
// (`unit-suite-purity.test.ts`), reading the file off disk the way `ruleset-drift.test.ts` does.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const CONFIG = path.join(repoRoot, "renovate.json");

type PackageRule = {
  description?: string;
  groupName?: string;
  matchUpdateTypes?: string[];
  matchDepNames?: string[];
  automerge?: boolean;
  schedule?: string[];
};

const packageRules = (JSON.parse(readFileSync(CONFIG, "utf8")) as { packageRules: PackageRule[] })
  .packageRules;

const batchRule = packageRules[0];
const majorRule = packageRules[packageRules.length - 1];

/**
 * The dependencies the weekly batch refuses to touch, read off its negated `matchDepNames`.
 * `slice(1)` is safe only because every entry is asserted negated below — a positive entry would
 * not merely be a missing exclusion, it would flip the matcher: in a list of only negative
 * patterns a dependency matches when none of them match it, and one positive entry makes the list
 * an allowlist instead. The batch rule's own description says so.
 */
const excludedFromBatch = (batchRule.matchDepNames ?? [])
  .filter((name) => name.startsWith("!"))
  .map((name) => name.slice(1));

/** Everything a never-alone group names positively: any rule that holds a bump for a person. */
const neverAlone = packageRules
  .filter((rule) => rule !== batchRule && rule.automerge === false && rule.matchDepNames)
  .flatMap((rule) => rule.matchDepNames as string[]);

/** Which group names a dependency, so a failure can say where the surviving copy lives. */
function groupNaming(dep: string): string {
  const rule = packageRules.find(
    (candidate) =>
      candidate !== batchRule && candidate.automerge === false && candidate.matchDepNames?.includes(dep),
  );
  return rule?.groupName ?? "an unnamed rule";
}

describe("renovate.json's two never-alone lists", () => {
  it("excludes from the weekly batch every dependency a never-alone group names", () => {
    const excluded = new Set(excludedFromBatch);
    const missing = [...new Set(neverAlone)].filter((dep) => !excluded.has(dep));
    assert.deepEqual(
      missing,
      [],
      missing
        .map(
          (dep) =>
            `${dep} is held for a person by the "${groupNaming(dep)}" group, but the weekly batch ` +
            `does not exclude it: add "!${dep}" to the first rule's matchDepNames. Until then a ` +
            `patch or minor to it automerges on Monday with nobody reading it.`,
        )
        .join("\n"),
    );
  });

  it("names in a never-alone group every dependency the weekly batch excludes", () => {
    const named = new Set(neverAlone);
    const missing = excludedFromBatch.filter((dep) => !named.has(dep));
    assert.deepEqual(
      missing,
      [],
      missing
        .map(
          (dep) =>
            `the weekly batch excludes "!${dep}", but no never-alone group names ${dep}: either ` +
            `add it to a group (with the reason a bump could invalidate, as every other rule ` +
            `states one) or drop the exclusion. As it stands it is neither batched nor grouped.`,
        )
        .join("\n"),
    );
  });

  // The `slice(1)` above depends on this, and so does the matcher's meaning — see the comment there.
  it("states the batch exclusions as negations and nothing else", () => {
    const positive = (batchRule.matchDepNames ?? []).filter((name) => !name.startsWith("!"));
    assert.deepEqual(
      positive,
      [],
      `the weekly batch's matchDepNames must hold only negated patterns; ${positive.join(", ")} ` +
        `is positive, which turns the list from an exclusion into an allowlist and lets every ` +
        `dependency it does not name out of the batch.`,
    );
  });

  // Array position is load-bearing — `packageRules` are applied in order and later rules override
  // earlier ones — and both descriptions assert it about themselves. Nothing checked it.
  it("keeps the weekly batch first, so every rule below overrides it", () => {
    assert.equal(
      batchRule.groupName,
      "weekly dependency batch",
      "the first packageRule is no longer the weekly batch; a never-alone rule placed above it " +
        "would be overridden by the batch rather than overriding it",
    );
    assert.equal(batchRule.automerge, true, "the weekly batch is the rule that automerges");
  });

  it("keeps the every-major rule last, so it overrides everything above it", () => {
    assert.deepEqual(
      majorRule.matchUpdateTypes,
      ["major"],
      "the last packageRule is no longer the every-major safety net; a rule added after it could " +
        "automerge a major",
    );
    assert.equal(majorRule.automerge, false, "the every-major rule holds every major for a person");
    assert.equal(
      majorRule.matchDepNames,
      undefined,
      "the every-major rule matches on update type alone; a matchDepNames on it would narrow the " +
        "safety net to the dependencies somebody thought of",
    );
  });
});
