#!/usr/bin/env node
/**
 * The branch-protection drift check: does `.github/rulesets/main.json` still describe what GitHub
 * enforces on `main`?
 *
 *     node scripts/check-ruleset.mjs                              # compare, exit 1 on drift
 *     node scripts/check-ruleset.mjs --allow-unverifiable=<field> # ...declaring a known blind spot
 *     node scripts/check-ruleset.mjs --write                      # rewrite the artifact from GitHub
 *
 * `.github/rulesets/README.md` is the reasoning and this file defers to it. Three things from it
 * are repeated here because getting them wrong is how the control quietly stops being one:
 *
 * **The artifact is the intent; GitHub is the current state.** When this is red the question is
 * which side is wrong, and the answer is usually the platform. Running `--write` to make the file
 * agree with whatever the API returned converts the control into a mirror, which is green by
 * construction and can no longer report anything. `--write` is for the commit that follows a
 * *deliberate* ruleset change and for nothing else.
 *
 * **Red is correct while a ruleset change is in flight.** The ruleset moves by an API call and the
 * artifact moves by a pull request, and those two acts cannot be simultaneous.
 *
 * **This is never a required status context** (#946). The event it exists to catch — an unprompted
 * platform write — belongs to no branch and no pull request, so a pull-request-triggered check
 * cannot see it whatever its status; and as a required context the legitimately-red window above
 * would freeze every unrelated merge in the repository, with `bypass_actors` empty and nobody able
 * to escape it.
 *
 * Authentication is `gh`, which every other GitHub procedure here already uses. The repository
 * comes from `GITHUB_REPOSITORY` when it is set — Actions sets it — and from `gh repo view`
 * otherwise, so the workflow needs no arguments.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SNAPSHOT = path.join(process.cwd(), ".github", "rulesets", "main.json");

/**
 * **The normalisation contract is `.github/rulesets/README.md`'s, not this script's**, and the two
 * have to agree byte for byte or `--write` churns the artifact on a ruleset nobody changed. The
 * README derives the file with a `jq` pipeline; `tests/unit/ruleset-drift.test.ts` pins that the
 * code below reproduces the committed file exactly, which is the only way the claim stays true.
 *
 * Fields that describe *this fetch* rather than the gate, deleted at the top level only — which is
 * what the README's `del(.id, .node_id, ...)` does. `id`, `node_id`, `created_at` and `updated_at`
 * change when nothing about the protection has; `_links` is a rendering of `id`; `source` is the
 * repository's own name, while `source_type` is kept because "defined on this repository rather
 * than inherited from an organisation" is part of what is being asserted.
 *
 * `current_user_can_bypass` is the one that has to go: it answers *may the caller bypass this*, so
 * it is a property of the token and not of the ruleset. Kept, this check would pass for the owner
 * and fail under `GITHUB_TOKEN` — a check that disagrees with itself depending on who ran it
 * teaches people to ignore it.
 *
 * **`id` is stripped on purpose and the README argues it at length**: a ruleset deleted and
 * recreated with identical rules would go stale for a change that is not drift, and the obvious
 * repair — writing the new number into the file — is the "edit the artifact to match GitHub"
 * failure arriving dressed as housekeeping. The ruleset is resolved by target, never by a stored
 * id.
 */
const VOLATILE_FIELDS = [
  "id",
  "node_id",
  "created_at",
  "updated_at",
  "_links",
  "source",
  "current_user_can_bypass"
];

/**
 * Object keys sorted at every level (`jq -S`), so the file does not churn when GitHub changes the
 * order it serialises fields in.
 *
 * **Arrays are left in the order the API returned them, except the two the README names** —
 * `rules` by `type`, and a `required_status_checks` list by `context`. This is a deliberate
 * departure from the sibling implementation in `darkroom`, which sorts every array by the
 * canonical JSON of its elements. That rule is defensible in itself and it is not this
 * repository's: sorting the `rules` array by element JSON puts the two rules carrying
 * `parameters` first, which is a different order from the committed artifact's, so adopting it
 * here would rewrite `.github/rulesets/main.json` for no reason at all. Ordering never affects the
 * *comparison* — `differences()` below pairs array elements by identity, not by position — so the
 * only thing at stake is the bytes `--write` produces.
 */
function normalise(value) {
  if (Array.isArray(value)) return value.map(normalise);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = normalise(value[key]);
  return out;
}

function byKey(name) {
  return (a, b) => (String(a?.[name]) < String(b?.[name]) ? -1 : String(a?.[name]) > String(b?.[name]) ? 1 : 0);
}

function canonical(ruleset) {
  const stripped = { ...ruleset };
  for (const field of VOLATILE_FIELDS) delete stripped[field];
  const out = normalise(stripped);
  if (Array.isArray(out.rules)) {
    out.rules = [...out.rules].sort(byKey("type"));
    for (const rule of out.rules) {
      const contexts = rule?.parameters?.required_status_checks;
      if (Array.isArray(contexts)) rule.parameters.required_status_checks = [...contexts].sort(byKey("context"));
    }
  }
  return out;
}

/**
 * **The allowlist of fields that may be declared unverifiable. Adding to it widens a security
 * boundary rather than configuring a tool.**
 *
 * These are fields GitHub *omits* rather than refuses when the caller may not read them. Measured
 * on this repository on 2026-09-08: an owner token returns `"bypass_actors": []`, the Actions
 * workflow token returns no such key, and every other field is identical.
 *
 * **The bound is an enumeration and not "any key of the envelope"**, because the envelope also
 * contains `rules`: `--allow-unverifiable=rules` would exclude every required context, linear
 * history and the allowed merge methods in one word and pass, wearing the appearance of a
 * reviewed concession — the exact failure this design closes everywhere else, reached through its
 * own escape hatch. `source_type` and `target` are in the envelope too and are not here; neither
 * should be until something is observed to redact them. A field joins this list when a caller has
 * been seen unable to read it, never because the flag happened to accept the string
 * (dev-agent `decisions/0005`).
 */
const REDACTABLE_FIELDS = ["bypass_actors"];

const TOKEN_ADVICE =
  "    Locally: `gh auth login` as a user who administers the repository.\n" +
  "    In Actions: the workflow token is not enough. Set RULESET_READ_TOKEN to a fine-grained\n" +
  "    token with Administration: read on this repository. Creating it is the owner's action.";

function fail(message) {
  console.error(`Ruleset check failed: ${message}`);
  process.exit(1);
}

/**
 * `--allow-unverifiable=a,b` declares, in the repository and in a diff, what a run is knowingly
 * not checking. An unknown name is an error rather than a no-op: a declaration that silently does
 * nothing is worse than one that is refused, because the reader believes a gap is covered when it
 * is not even recognised.
 */
function declaredUnverifiable(argv) {
  const flag = argv.find((arg) => arg.startsWith("--allow-unverifiable"));
  if (!flag) return [];
  const value = flag.includes("=") ? flag.slice(flag.indexOf("=") + 1) : "";
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  const unknown = names.filter((name) => !REDACTABLE_FIELDS.includes(name));
  if (unknown.length > 0) {
    fail(
      `--allow-unverifiable cannot exclude ${unknown.join(", ")}.\n\n` +
        `    Only fields the platform has been observed to redact may be declared, and that list\n` +
        `    is: ${REDACTABLE_FIELDS.join(", ")}. Adding to it widens a security boundary — it is a\n` +
        `    change to this script, made deliberately and in a diff, after seeing a caller actually\n` +
        `    unable to read the field. It is not a command-line option.`
    );
  }
  return names;
}

/**
 * Which of the artifact's top-level fields the response does not contain at all.
 *
 * **Only the envelope's own keys, and this is the line that keeps the rule honest.** GitHub does
 * not stop returning `enforcement` because somebody changed it — an envelope key that is missing
 * is a key this token may not read. Everywhere deeper, absence is content: a rule removed from
 * `rules`, a context dropped from the required list. Those are drift and are reported as drift.
 */
function unseenFields(stored, live) {
  return Object.keys(stored).filter((key) => !(key in live));
}

function serialise(ruleset) {
  return `${JSON.stringify(canonical(ruleset), null, 2)}\n`;
}

function gh(args) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const detail = (error.stderr || error.message || "").toString().trim();
    fail(`\`gh ${args.join(" ")}\` failed.\n\n${detail}`);
  }
}

function repository() {
  return (
    process.env.GITHUB_REPOSITORY ||
    gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim()
  );
}

/**
 * The ruleset is found by target, so its id never has to live in the artifact — and so that both
 * ways this can be wrong are caught: posting the creation command twice leaves two rulesets on
 * `main`, and deleting it leaves none. A check that fetched a known id would call the first green.
 *
 * **Every branch ruleset counts, not only one whose condition names the default branch.** What
 * applies to a branch is the union of every ruleset matching it, so a second one added as
 * `refs/heads/*` would govern `main` without ever saying its name. This is where the script is
 * deliberately stricter than the `jq` pipeline in `.github/rulesets/README.md`, whose
 * `map(select(.conditions.ref_name.include == ["~DEFAULT_BRANCH"]))` would filter such a ruleset
 * out and then find exactly one survivor — going quiet at precisely the moment the gate grew.
 * dev-agent's own checker had that bug and `rules/R-007` now says a second ruleset is drift rather
 * than an ambiguity to resolve.
 *
 * The list endpoint answers with envelopes only — no `rules` and no `conditions` — so the body has
 * to be fetched by id before anything can be compared.
 */
function fetchLiveRuleset(repo) {
  const defaultBranch = gh(["api", `repos/${repo}`, "--jq", ".default_branch"]).trim();
  const listed = JSON.parse(gh(["api", `repos/${repo}/rulesets`])).filter(
    (ruleset) => ruleset.target === "branch"
  );

  if (listed.length === 0) {
    fail(
      `${repo} has no branch ruleset.\n\n` +
        `    ${defaultBranch} is unprotected: it can be force-pushed, deleted, and merged into\n` +
        `    without a pull request. That is the finding — report it, and see\n` +
        `    .github/rulesets/README.md before putting anything back.`
    );
  }
  if (listed.length > 1) {
    const names = listed.map((ruleset) => `${ruleset.name} (#${ruleset.id})`).join(", ");
    fail(
      `${repo} has ${listed.length} branch rulesets: ${names}.\n\n` +
        `    What applies to a branch is the union of all of them, so a second one governs \`main\`\n` +
        `    whether or not it names it. Delete the duplicate, or extend this check, before\n` +
        `    comparing.`
    );
  }

  const ruleset = JSON.parse(gh(["api", `repos/${repo}/rulesets/${listed[0].id}`]));

  const include = ruleset.conditions?.ref_name?.include ?? [];
  const governsDefaultBranch =
    include.includes("~DEFAULT_BRANCH") ||
    include.includes("~ALL") ||
    include.includes(`refs/heads/${defaultBranch}`);
  if (!governsDefaultBranch) {
    fail(
      `the only branch ruleset on ${repo} does not govern ${defaultBranch}.\n\n` +
        `    Its condition includes ${JSON.stringify(include)}. Whatever it protects, the default\n` +
        `    branch is not it.`
    );
  }

  return ruleset;
}

/**
 * A field-by-field diff, not a line diff. The failure this exists to catch is one parameter inside
 * one rule changing value, and `rules[pull_request].parameters.require_extra_approval_…` is
 * something a person can act on in a way that two blocks of near-identical JSON are not.
 *
 * Array elements are paired by identity — a rule's `type`, a status check's `context` — rather
 * than by position: dropping one required check shifts every element after it, and a positional
 * diff would report four renames and a deletion for what is one check going missing.
 */
function identity(element, index) {
  if (element !== null && typeof element === "object" && !Array.isArray(element)) {
    for (const key of ["type", "context"]) {
      if (typeof element[key] === "string") return element[key];
    }
  }
  if (typeof element === "string") return element;
  return `${index}:${JSON.stringify(element)}`;
}

function differences(expected, actual, at = "") {
  const here = (key) => (at ? `${at}.${key}` : key);

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const index = (array) => new Map(array.map((element, i) => [identity(element, i), element]));
    const inFile = index(expected);
    const onGitHub = index(actual);
    const found = [];
    for (const key of [...new Set([...inFile.keys(), ...onGitHub.keys()])].sort()) {
      const where = `${at}[${key}]`;
      if (!onGitHub.has(key)) found.push({ at: where, file: inFile.get(key), github: undefined });
      else if (!inFile.has(key)) found.push({ at: where, file: undefined, github: onGitHub.get(key) });
      else found.push(...differences(inFile.get(key), onGitHub.get(key), where));
    }
    return found;
  }

  const bothObjects =
    expected !== null &&
    actual !== null &&
    typeof expected === "object" &&
    typeof actual === "object" &&
    !Array.isArray(expected) &&
    !Array.isArray(actual);

  if (bothObjects) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    return keys.flatMap((key) => differences(expected[key], actual[key], here(key)));
  }

  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
  return [{ at: at || "<root>", file: expected, github: actual }];
}

function show(value) {
  return value === undefined ? "(absent)" : JSON.stringify(value);
}

/**
 * Workflow annotations, and only under Actions — run by hand this prints plainly, the same
 * arrangement `scripts/static-checks.sh` uses.
 *
 * **The two levels are not decoration.** A declared, absent field is a state somebody has already
 * agreed to live with, so it gets a `notice`: named on every run, costing nothing. A declaration
 * that is no longer needed gets a `warning`, because it asks for an action — and because the
 * alternative channels are both wrong. Failing would turn the check red immediately after somebody
 * did the right thing by adding the token; printing it only to stdout puts the signal in the log of
 * a green run, which is the one place nobody looks (dev-agent `rules/R-004`, `decisions/0005`).
 */
function annotate(level, title, message) {
  if (!process.env.GITHUB_ACTIONS) return;
  console.log(`::${level} title=${title}::${message.replace(/\n/g, " ")}`);
}

/**
 * Three outcomes, never two (dev-agent `rules/R-004`), and the third is where the care goes:
 *
 *   - present on both sides and equal → **pass**, and the run names what it verified rather than
 *     leaving coverage in an exit code nobody reads.
 *   - present on both sides and unequal → **drift**. Exit 1, named field by field.
 *   - absent from the response entirely → **could not see**. Exit 1 — *unless* the field was
 *     declared with `--allow-unverifiable`, which is the amendment `decisions/0005` makes.
 *
 * **Why a declaration may pass at all**, since the instinct is that it should not: a scheduled
 * check's entire delivery mechanism is the mail GitHub sends on failure, so a job red every day
 * for a known, permanent, one-action-fixes-it gap makes real drift arrive in the same envelope as
 * that gap. A check that is always red does not merely get ignored — it makes red ambiguous, which
 * kills the primary instrument to protect a secondary one. The declaration is what keeps this from
 * being a downgraded warning: it is written in the repository, reviewed in a diff, printed on every
 * run, and **anything undeclared still fails**, so a blind spot cannot grow silently.
 */
const write = process.argv.includes("--write");
const declared = declaredUnverifiable(process.argv);
const repo = repository();
const live = canonical(fetchLiveRuleset(repo));

if (write) {
  // A snapshot written by a token that cannot see everything is an incomplete artifact that looks
  // complete. **The declaration deliberately does not reach here**: not checking a field is a
  // documented concession, recording a ruleset without it is not (`decisions/0005`).
  const blind = REDACTABLE_FIELDS.filter((field) => !(field in live));
  if (blind.length > 0) {
    fail(
      `this token cannot read ${blind.join(", ")} on ${repo}, so it cannot write the artifact.\n\n` +
        `    The ruleset came back without ${blind.length > 1 ? "those keys" : "that key"}, which\n` +
        `    GitHub does when the caller may not read them. Writing now would record an artifact\n` +
        `    missing the most security-relevant field in the gate while looking complete.\n\n` +
        TOKEN_ADVICE
    );
  }
  writeFileSync(SNAPSHOT, serialise(live));
  console.log(
    `Wrote .github/rulesets/main.json from ${repo}.\n` +
      `Do this only after changing the ruleset on purpose — see .github/rulesets/README.md.`
  );
  process.exit(0);
}

let stored;
try {
  stored = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
} catch (error) {
  fail(`cannot read .github/rulesets/main.json — ${error.message}`);
}

const unseen = unseenFields(stored, live);

// **This is not what refuses `--allow-unverifiable=rules`** — `declaredUnverifiable` above is, at
// parse time, before this line runs. Saying otherwise would describe a job already done, which is
// how a correct check gets deleted by somebody being careful.
//
// What this catches is the case the parse-time check structurally cannot reach: **the platform
// withholds a field nobody passed on the flag.** Nothing was typed, so there is nothing to reject
// there — and this is the line that makes "if GitHub redacts a second field tomorrow, the job goes
// red" true, which is the claim the whole design rests on.
//
// The separate message is the other half of its job. Without it a newly-redacted field would fall
// through to the `undeclared` branch below, whose message tells the reader to declare it — and the
// parse-time check would then refuse that declaration, sending them to a locked door.
const undeclarable = unseen.filter((field) => !REDACTABLE_FIELDS.includes(field));
if (undeclarable.length > 0) {
  fail(
    `could not see ${undeclarable.join(", ")} on ${repo}, and ` +
      `${undeclarable.length > 1 ? "those are not fields" : "that is not a field"}\n` +
      `    this check will exclude.\n\n` +
      `    The response omitted ${undeclarable.length > 1 ? "them" : "it"} entirely. Only fields\n` +
      `    the platform has been observed to redact may be declared unverifiable, and today that\n` +
      `    list is: ${REDACTABLE_FIELDS.join(", ")}. Anything else missing is either drift this\n` +
      `    comparison cannot express or a change in what GitHub returns — both worth a person.\n\n` +
      TOKEN_ADVICE
  );
}

const undeclared = unseen.filter((field) => !declared.includes(field));
if (undeclared.length > 0) {
  fail(
    `could not see ${undeclared.join(", ")} on ${repo}.\n\n` +
      `    The ruleset came back without ${undeclared.length > 1 ? "those keys" : "that key"} at\n` +
      `    all — a 200 with fields omitted, not a refusal. **Absent is not empty.** Comparing\n` +
      `    anyway would report a difference that is not drift; defaulting to empty would turn a\n` +
      `    blind spot into a confident negative — "no bypass actors", asserted by something\n` +
      `    structurally unable to see any. Neither is a verdict worth having, so this is not a\n` +
      `    pass.\n\n` +
      TOKEN_ADVICE +
      `\n\n    If running without that token is deliberate, declare it where a reader can see it:\n` +
      `    --allow-unverifiable=${undeclared.join(",")}. The run then checks everything else and\n` +
      `    names what it did not check. See .github/rulesets/README.md.`
  );
}

// Compare only what both sides can speak about. A declared field is dropped from the stored side
// too, so its absence is reported as unchecked rather than as a difference.
const comparable = { ...stored };
for (const field of unseen) delete comparable[field];

const drift = differences(comparable, live);
if (drift.length > 0) {
  console.error(`Ruleset check failed: .github/rulesets/main.json does not match ${repo}.\n`);
  for (const { at, file, github } of drift) {
    console.error(`  - ${at}\n      file:   ${show(file)}\n      GitHub: ${show(github)}\n`);
  }
  if (unseen.length > 0) {
    console.error(`Not checked, by declaration: ${unseen.join(", ")}.\n`);
  }
  console.error(
    "The file is the intended gate; GitHub is what is enforced. Decide which one is wrong before\n" +
      "changing either. If the ruleset was changed on purpose, run this with --write and commit\n" +
      "that in a pull request. If it was not, that is the finding — report it, do not absorb it.\n" +
      "The full reasoning is in .github/rulesets/README.md."
  );
  annotate("error", "ruleset drift", `${drift.length} field(s) differ from ${repo}.`);
  process.exit(1);
}

// A concession should not outlive its reason, so a declaration that is no longer true says so —
// on the run summary rather than only in the log of a green run.
const nowVisible = declared.filter((field) => field in live);
if (nowVisible.length > 0) {
  const message =
    `This token can read ${nowVisible.join(", ")}, so --allow-unverifiable=${nowVisible.join(",")} ` +
    `is no longer needed and was compared normally. Drop it from .github/workflows/ruleset-drift.yml.`;
  console.log(message);
  annotate("warning", "stale declaration", message);
}

// Never the bare word "passed" when something was excluded, and never a bare "passed" when nothing
// was: coverage belongs in the output, not in the exit code, where a reader cannot see it.
if (unseen.length > 0) {
  const message =
    `Ruleset check passed with ${unseen.length} field(s) NOT VERIFIED: ${unseen.join(", ")}.`;
  console.log(
    `${message}\n\n` +
      `Everything else in .github/rulesets/main.json matches ${repo}. The unverified field(s) were\n` +
      `omitted from the API response because this token may not read them, and were declared with\n` +
      `--allow-unverifiable, so this run makes no claim about them at all.\n\n` +
      TOKEN_ADVICE
  );
  annotate("notice", "ruleset drift", message);
  process.exit(0);
}

console.log(
  `Ruleset check passed: .github/rulesets/main.json matches ${repo}.\n` +
    `Verified all ${Object.keys(stored).length} recorded fields, ` +
    `including ${REDACTABLE_FIELDS.join(", ")}.`
);
