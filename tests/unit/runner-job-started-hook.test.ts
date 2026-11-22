import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `scripts/runner-job-started-hook.sh` is the Raspberry Pi runner's job-started hook (#2697): it
// refuses every job except `deploy.yml` on a release or a manual run from a `v*` tag or `main`.
// `scripts/check-self-hosted-runners.mjs` keeps other workflows off the Pi on `main`, but a pull
// request's run uses the pull request's own workflow files, so only the runner can stop such a job
// from running once. A hook that accepts everything looks exactly like one that works, so most of
// the cases here are refusals — and every variable missing is one of them, because it fails closed.
//
// The script is run with a clean environment, the way the runner runs it, and its exit status is
// what the runner reads.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const HOOK = path.join(repoRoot, "scripts", "runner-job-started-hook.sh");

const REPO = "michalwy/stamporama";
const DEPLOY = `${REPO}/.github/workflows/deploy.yml`;

type Env = Record<string, string | undefined>;

function run(env: Env) {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) clean[key] = value;
  }
  return spawnSync("bash", [HOOK], { env: clean as NodeJS.ProcessEnv, encoding: "utf8", timeout: 30_000 });
}

const release: Env = {
  GITHUB_REPOSITORY: REPO,
  GITHUB_WORKFLOW_REF: `${DEPLOY}@refs/tags/v1.4.0`,
  GITHUB_EVENT_NAME: "release",
};

describe("runner-job-started-hook", () => {
  const accepted: Record<string, Env> = {
    "a release from a v* tag": release,
    "a workflow_dispatch from a v* tag": { ...release, GITHUB_EVENT_NAME: "workflow_dispatch" },
    "a workflow_dispatch from main": {
      ...release,
      GITHUB_WORKFLOW_REF: `${DEPLOY}@refs/heads/main`,
      GITHUB_EVENT_NAME: "workflow_dispatch",
    },
  };

  for (const [what, env] of Object.entries(accepted)) {
    it(`accepts ${what}`, () => {
      const result = run(env);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /^Accepted by the Pi's job-started hook/);
      assert.equal(result.stdout.trim().split("\n").length, 1, "one line");
    });
  }

  const refused: Record<string, Env> = {
    "a pull_request event": { ...release, GITHUB_EVENT_NAME: "pull_request" },
    "a pull_request_target event": { ...release, GITHUB_EVENT_NAME: "pull_request_target" },
    "a push event": { ...release, GITHUB_EVENT_NAME: "push" },
    "another workflow file on main": {
      ...release,
      GITHUB_WORKFLOW_REF: `${REPO}/.github/workflows/ci.yml@refs/heads/main`,
      GITHUB_EVENT_NAME: "workflow_dispatch",
    },
    "another workflow from a v* tag": {
      ...release,
      GITHUB_WORKFLOW_REF: `${REPO}/.github/workflows/ci.yml@refs/tags/v1.4.0`,
    },
    "another workflow whose ref only contains the deploy ref": {
      ...release,
      GITHUB_WORKFLOW_REF: `${REPO}/.github/workflows/ci.yml@refs/heads/x/.github/workflows/deploy.yml@refs/heads/main`,
      GITHUB_EVENT_NAME: "workflow_dispatch",
    },
    "deploy.yml from another branch": {
      ...release,
      GITHUB_WORKFLOW_REF: `${DEPLOY}@refs/heads/claude/some-thread`,
      GITHUB_EVENT_NAME: "workflow_dispatch",
    },
    "deploy.yml from a branch whose name starts with main": {
      ...release,
      GITHUB_WORKFLOW_REF: `${DEPLOY}@refs/heads/main-x`,
      GITHUB_EVENT_NAME: "workflow_dispatch",
    },
    "deploy.yml from a pull request's merge ref": {
      ...release,
      GITHUB_WORKFLOW_REF: `${DEPLOY}@refs/pull/12/merge`,
      GITHUB_EVENT_NAME: "pull_request",
    },
    "deploy.yml from a non-v tag": { ...release, GITHUB_WORKFLOW_REF: `${DEPLOY}@refs/tags/1.4.0` },
    "deploy.yml from a branch named like a v tag": {
      ...release,
      GITHUB_WORKFLOW_REF: `${DEPLOY}@refs/heads/v1.4.0`,
    },
    "another repository": {
      GITHUB_REPOSITORY: "someone/stamporama",
      GITHUB_WORKFLOW_REF: `someone/stamporama/.github/workflows/deploy.yml@refs/tags/v1.4.0`,
      GITHUB_EVENT_NAME: "release",
    },
    "another repository running this repository's workflow ref": {
      ...release,
      GITHUB_REPOSITORY: "someone/stamporama",
    },
    "a repository name that only starts with this one": { ...release, GITHUB_REPOSITORY: `${REPO}-fork` },
    "GITHUB_REPOSITORY missing": { ...release, GITHUB_REPOSITORY: undefined },
    "GITHUB_WORKFLOW_REF missing": { ...release, GITHUB_WORKFLOW_REF: undefined },
    "GITHUB_EVENT_NAME missing": { ...release, GITHUB_EVENT_NAME: undefined },
    "GITHUB_REPOSITORY empty": { ...release, GITHUB_REPOSITORY: "" },
    "GITHUB_WORKFLOW_REF empty": { ...release, GITHUB_WORKFLOW_REF: "" },
    "GITHUB_EVENT_NAME empty": { ...release, GITHUB_EVENT_NAME: "" },
    "every variable missing": {},
  };

  for (const [what, env] of Object.entries(refused)) {
    it(`refuses ${what}`, () => {
      const result = run(env);
      assert.equal(result.status, 1, `expected a refusal, got:\n${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /^Refused by the Pi's job-started hook/);
      assert.equal(result.stdout.trim().split("\n").length, 1, "one line");
    });
  }
});
