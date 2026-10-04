#!/usr/bin/env node
/**
 * Does `renovate.json` automerge only what it says it does? (#818)
 *
 *     node scripts/check-renovate-automerge.mjs   # exit 1 when a rule lets the wrong thing through
 *
 * `packageRules` decide which updates merge with nobody reading them, and the way they fail is
 * silent: a rule that matches the wrong field is still valid configuration. #814 nearly shipped the
 * never-alone exclusion as `matchPackageNames`, which does not see the CI Node pin (`depName` node,
 * `packageName` actions/node-versions), so a Node minor would have joined the weekly batch. Reading
 * did not catch it and `renovate-config-validator` cannot. This script works out, per dependency and
 * per update type, whether `automerge` comes out true, and asserts:
 *
 *   - nothing on the never-alone list automerges, at any update type;
 *   - no major automerges, for any dependency;
 *   - a dependency nobody named does automerge its patch and minor — the positive control, so a
 *     check that matches nothing cannot pass by being vacuous;
 *   - every rule matches something, so a rule the simulator misreads shows up as dead.
 *
 * **It simulates Renovate rather than running it**, so it needs no dependency and no install — the
 * full resolver is a large package pulled in for one check, which the issue weighed and declined.
 * The simulation is honest only because it **fails closed**: it models `matchDepNames` and
 * `matchUpdateTypes` with literal names, applied in array order with later rules winning, and any
 * other matcher, key, glob, regex or preset is an error, never a guess. Extending it means
 * re-checking it against Renovate itself: in a scratch directory with `renovate` installed, run
 * `resolveConfigPresets` (`renovate/dist/config/presets`) and `applyPackageRules`
 * (`renovate/dist/util/package-rules`) over every dependency × update type and compare with
 * `automerges()` below. Done on 2026-10-04 with Renovate 44.132.5: the two presets contributed 726
 * rules, none touching `automerge`, and over this repository's 47 dependencies × 9 update types the
 * two sides agreed on every pair, for the real file and for eight mutations of it (3,807 pairs).
 *
 * **What it does not judge is membership.** The never-alone list is whatever `renovate.json` says
 * it is; a name taken off both halves of it on purpose is a reviewer's call, not this check's.
 *
 * **Why the dependency universe is complete without extracting anything.** Under the two modelled
 * matchers a dependency's outcome depends only on whether each rule names it, so every dependency
 * no rule names behaves exactly like one made-up name. The universe is therefore the names the
 * rules mention plus that one stand-in, which is every case there is.
 *
 * `.github/workflows/renovate-rules.yml` runs it on a pull request that touches `renovate.json` —
 * advisory, not a required context, decided by the user on 2026-10-04 —
 * and `tests/unit/renovate-automerge.test.ts` pins that it fails on the shapes it exists to catch.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The presets checked against Renovate itself. A different list has not been, whatever it adds. */
export const VERIFIED_PRESETS = ["config:recommended", ":pinVersions"];

/** Top-level keys known to leave `automerge` alone (`automergeType`/`Strategy` say how, not whether). */
const INERT_TOP_LEVEL = new Set([
  "$schema",
  "extends",
  "minimumReleaseAge",
  "prConcurrentLimit",
  "labels",
  "commitMessagePrefix",
  "automergeType",
  "automergeStrategy",
  "packageRules",
]);

const MODELLED_MATCHERS = new Set(["matchDepNames", "matchUpdateTypes"]);
const INERT_RULE_KEYS = new Set(["description", "groupName", "schedule"]);

/** Every update type Renovate produces; `pin` and `digest` included because `:pinVersions` makes pins. */
export const UPDATE_TYPES = [
  "major",
  "minor",
  "patch",
  "pin",
  "digest",
  "pinDigest",
  "lockFileMaintenance",
  "rollback",
  "bump",
  "replacement",
];

/** A dependency no rule names; it stands for all of them. */
export const UNNAMED = "dependency-no-rule-names";

// A literal package name. Anything Renovate would read as a glob (`*`, `?`, `{`, `[`) or a regex
// (`/…/`) is refused rather than approximated.
const LITERAL_NAME = /^!?[A-Za-z0-9@][A-Za-z0-9@/._-]*$/;

/** Renovate's `matchRegexOrGlobList` over literal names: every positive misses → no; any negative hits → no. */
function matchesNames(dep, patterns) {
  const positive = patterns.filter((p) => !p.startsWith("!")).map((p) => p.toLowerCase());
  const negative = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1).toLowerCase());
  if (positive.length > 0 && !positive.includes(dep)) return false;
  return !negative.includes(dep);
}

function matches(rule, dep, updateType) {
  if (rule.matchDepNames && !matchesNames(dep, rule.matchDepNames)) return false;
  if (rule.matchUpdateTypes && !rule.matchUpdateTypes.includes(updateType)) return false;
  return true;
}

/** Everything that makes the simulation unsafe to trust. Empty means `evaluate()` can be believed. */
function unsupported(config) {
  const problems = [];
  for (const key of Object.keys(config)) {
    if (!INERT_TOP_LEVEL.has(key)) {
      problems.push(`top-level "${key}" is not modelled and may change what automerges`);
    }
  }
  const presets = config.extends ?? [];
  const sameAsVerified =
    presets.length === VERIFIED_PRESETS.length && VERIFIED_PRESETS.every((p) => presets.includes(p));
  if (!sameAsVerified) {
    problems.push(
      `"extends" is ${JSON.stringify(presets)}, not the verified ${JSON.stringify(VERIFIED_PRESETS)}; ` +
        `a preset can carry packageRules of its own, so re-check the result against Renovate ` +
        `before updating VERIFIED_PRESETS`,
    );
  }
  (config.packageRules ?? []).forEach((rule, i) => {
    const where = `packageRules[${i}]${rule.groupName ? ` ("${rule.groupName}")` : ""}`;
    for (const key of Object.keys(rule)) {
      if (MODELLED_MATCHERS.has(key) || INERT_RULE_KEYS.has(key) || key === "automerge") continue;
      problems.push(
        `${where}: "${key}" is not modelled` +
          (key === "matchPackageNames"
            ? ` — and it reads packageName, not depName: the CI Node pin is depName node but ` +
              `packageName actions/node-versions, so it would slip past (#814)`
            : ""),
      );
    }
    for (const key of MODELLED_MATCHERS) {
      if (!(key in rule)) continue;
      if (!Array.isArray(rule[key]) || rule[key].length === 0) {
        problems.push(`${where}: "${key}" must be a non-empty list (Renovate reads an empty one as no match)`);
      }
    }
    for (const name of rule.matchDepNames ?? []) {
      if (!LITERAL_NAME.test(name)) {
        problems.push(`${where}: "${name}" is a glob or regex, and only literal names are modelled`);
      }
    }
    for (const type of rule.matchUpdateTypes ?? []) {
      if (!UPDATE_TYPES.includes(type)) problems.push(`${where}: unknown update type "${type}"`);
    }
    if ("automerge" in rule && typeof rule.automerge !== "boolean") {
      problems.push(`${where}: "automerge" must be true or false`);
    }
  });
  return problems;
}

/**
 * The never-alone set, read both ways round: names a holding rule states positively, and names the
 * automerge rules exclude. `tests/unit/renovate-never-alone.test.ts` checks the two agree; here the
 * union is protected, so a name dropped from one half alone is still covered.
 */
export function neverAlone(config) {
  const names = new Set();
  for (const rule of config.packageRules ?? []) {
    for (const name of rule.matchDepNames ?? []) {
      const literal = name.startsWith("!") ? name.slice(1) : name;
      if (rule.automerge === false || name.startsWith("!")) names.add(literal.toLowerCase());
    }
  }
  return [...names].sort();
}

/** `automerge` for one dependency and update type: false by default, then each matching rule in order. */
export function automerges(config, dep, updateType) {
  let automerge = false;
  for (const rule of config.packageRules ?? []) {
    if ("automerge" in rule && matches(rule, dep, updateType)) automerge = rule.automerge;
  }
  return automerge;
}

/** Every failure the configuration has, as sentences; empty means it automerges what it says. */
export function evaluate(config) {
  const problems = unsupported(config);
  if (problems.length > 0) {
    return problems.map((p) => `cannot simulate: ${p}`);
  }

  const failures = [];
  const protectedDeps = neverAlone(config);
  const universe = [...new Set([...protectedDeps, ...namedAnywhere(config), UNNAMED])];

  for (const dep of protectedDeps) {
    const leaking = UPDATE_TYPES.filter((type) => automerges(config, dep, type));
    if (leaking.length > 0) {
      failures.push(`${dep} is never-alone but automerges its ${leaking.join(", ")} updates`);
    }
  }
  for (const dep of universe) {
    if (automerges(config, dep, "major")) {
      failures.push(`a major update to ${dep === UNNAMED ? "a dependency no rule names" : dep} automerges`);
    }
  }
  for (const type of ["patch", "minor"]) {
    if (!automerges(config, UNNAMED, type)) {
      failures.push(
        `positive control: a ${type} to a dependency no rule names does not automerge, so the ` +
          `weekly batch matches nothing — or this check has stopped reading the rules`,
      );
    }
  }
  (config.packageRules ?? []).forEach((rule, i) => {
    const used = universe.some((dep) => UPDATE_TYPES.some((type) => matches(rule, dep, type)));
    if (!used) failures.push(`packageRules[${i}] matches no dependency at any update type`);
  });
  return failures;
}

function namedAnywhere(config) {
  return (config.packageRules ?? []).flatMap((rule) =>
    (rule.matchDepNames ?? []).map((name) => (name.startsWith("!") ? name.slice(1) : name).toLowerCase()),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(process.cwd(), "renovate.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  const failures = evaluate(config);
  if (failures.length > 0) {
    console.error(`renovate.json does not automerge what it says it does:\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  const protectedDeps = neverAlone(config);
  console.log(
    `renovate.json: ${protectedDeps.length} never-alone dependencies automerge nothing, no major ` +
      `automerges, and an unnamed dependency's patch and minor do.`,
  );
}
