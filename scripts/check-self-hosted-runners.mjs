#!/usr/bin/env node
/**
 * Does any workflow other than the deploy workflow reach a self-hosted runner? (#2689)
 *
 *     node scripts/check-self-hosted-runners.mjs [repo-root]   # exit 1 when one does
 *
 * This repository is public and the Raspberry Pi that runs the owner's instance has a self-hosted
 * runner registered on it. A job on that runner executes whatever the triggering commit says, on
 * the machine that holds the production `.env` and reaches the production database — so a workflow
 * a fork's pull request can start must never be able to land there. The owner's rule (2026-11-22):
 * **no workflow other than `deploy.yml` may use a self-hosted runner**, and CI fails when one names
 * `self-hosted`. `deploy.yml` itself is pinned by `tests/unit/deploy-workflow.test.ts`: release and
 * manual triggers only, never `pull_request`, `pull_request_target` or `workflow_call`.
 *
 * **Two checks, because the owner's one has a hole.** A self-hosted runner carries the label
 * `self-hosted` automatically, but a job does not have to ask for it: `runs-on: [pi]` matches the
 * Pi's runner just as well. So besides refusing the word, every `runs-on:` in another workflow must
 * resolve to a **GitHub-hosted** label (`ubuntu-…`, `windows-…`, `macos-…`), either written out or
 * through `${{ matrix.<key> }}` whose every `<key>:` value in that file is one. Anything else — a
 * list, a `group:`, a `vars.` expression, a label this script does not recognise — is a failure.
 * The check **fails closed**: it reads lines rather than YAML (no dependency, no install), so a
 * shape it does not understand is reported, never guessed at. Extending the allowed shapes is a
 * change to this file, which is what a reviewer will see.
 *
 * Run by `tests/unit/self-hosted-runners.test.ts`, inside the required `Unit tests` check; that
 * job runs on any change under `.github/` because `scripts/detect-changes.sh` never safe-lists it.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The one workflow allowed onto a self-hosted runner. */
export const DEPLOY_WORKFLOW = "deploy.yml";

const GITHUB_HOSTED = /^(ubuntu|windows|macos)-[A-Za-z0-9.-]+$/;
const MATRIX_REF = /^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/;

function unquote(value) {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/** The value after `key:` on a line, without a trailing comment; `null` when the line is not that key. */
function valueOf(line, key) {
  const match = line.match(new RegExp(`^\\s*(?:-\\s+)?${key}:(.*)$`));
  if (!match) return null;
  return unquote(match[1].replace(/\s+#.*$/, ""));
}

/** Every problem in one workflow's text. */
export function problemsIn(name, text) {
  if (name === DEPLOY_WORKFLOW) return [];
  const problems = [];
  const lines = text.split("\n");

  lines.forEach((line, i) => {
    if (/self-hosted/i.test(line)) {
      problems.push(`${name}:${i + 1}: names "self-hosted" - only ${DEPLOY_WORKFLOW} may.`);
    }
  });

  lines.forEach((line, i) => {
    const value = valueOf(line, "runs-on");
    if (value === null) return;
    const where = `${name}:${i + 1}`;
    if (GITHUB_HOSTED.test(value)) return;
    const matrix = value.match(MATRIX_REF);
    if (!matrix) {
      problems.push(
        `${where}: runs-on "${value}" is not a GitHub-hosted label - only ${DEPLOY_WORKFLOW} may use another runner.`,
      );
      return;
    }
    const key = matrix[1];
    const values = lines.map((l) => valueOf(l, key)).filter((v) => v !== null);
    if (values.length === 0) {
      problems.push(`${where}: runs-on reads matrix.${key}, and no "${key}:" value was found to check.`);
    }
    for (const v of values) {
      if (!GITHUB_HOSTED.test(v)) {
        problems.push(`${where}: runs-on reads matrix.${key}, and "${key}: ${v}" is not a GitHub-hosted label.`);
      }
    }
  });

  return problems;
}

/** Every problem across `<root>/.github/workflows`. */
export function check(root) {
  const dir = path.join(root, ".github", "workflows");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();
  return files.flatMap((f) => problemsIn(f, readFileSync(path.join(dir, f), "utf8")));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? ".");
  const problems = check(root);
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    console.error(
      `\n${problems.length} problem(s). A self-hosted runner here is the owner's Raspberry Pi; see docs/deployment/pi-deploy.md.`,
    );
    process.exit(1);
  }
  console.log(`No workflow but ${DEPLOY_WORKFLOW} can reach a self-hosted runner.`);
}
