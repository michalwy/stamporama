#!/usr/bin/env bash
#
# The job-started hook of the Raspberry Pi's self-hosted runner (#2697, ADR-0083): **the Pi runs
# the deploy and nothing else.**
#
# The runner calls this before any step of every job it picks up, because its `.env` sets
# `ACTIONS_RUNNER_HOOK_JOB_STARTED` to an installed copy of this file
# (`docs/deployment/pi-deploy.md`). A non-zero exit fails the job before a single step runs.
#
# Why it exists: `scripts/check-self-hosted-runners.mjs` keeps every workflow but `deploy.yml` off
# self-hosted runners **on `main`**, but a `pull_request` run uses the workflow files from the pull
# request's own head. A pull request from a branch of this repository — every agent thread's is
# one — or an approved fork pull request can add `runs-on: [self-hosted, pi, stamporama]` to
# `ci.yml`, and that job would run on the Pi once, in the same run where the check goes red. The
# check cannot stop that; only the runner can.
#
# The rule (decided in #2697): the job runs only when **all** of these hold —
#
#   - `GITHUB_REPOSITORY` is `michalwy/stamporama`;
#   - `GITHUB_WORKFLOW_REF` is `michalwy/stamporama/.github/workflows/deploy.yml@refs/tags/v…`
#     or `michalwy/stamporama/.github/workflows/deploy.yml@refs/heads/main`;
#   - `GITHUB_EVENT_NAME` is `release` or `workflow_dispatch`.
#
# **It fails closed**: a missing or empty variable is a refusal. It prints one line either way. The
# line lands in the job's log, which is public, so it names only what GitHub already shows — the
# repository, the workflow ref and the event — and nothing about the Pi.
#
# Tested by `tests/unit/runner-job-started-hook.test.ts`, which runs this file with each case's
# environment and reads its exit status.

set -u

readonly REPOSITORY="michalwy/stamporama"
readonly WORKFLOW="${REPOSITORY}/.github/workflows/deploy.yml"

refuse() {
  echo "Refused by the Pi's job-started hook (#2697): $1. This runner only runs ${WORKFLOW} on a release or a manual run from a v* tag or main."
  exit 1
}

repository="${GITHUB_REPOSITORY:-}"
workflow_ref="${GITHUB_WORKFLOW_REF:-}"
event="${GITHUB_EVENT_NAME:-}"

[ -n "$repository" ] || refuse "GITHUB_REPOSITORY is not set"
[ -n "$workflow_ref" ] || refuse "GITHUB_WORKFLOW_REF is not set"
[ -n "$event" ] || refuse "GITHUB_EVENT_NAME is not set"

[ "$repository" = "$REPOSITORY" ] || refuse "repository ${repository} is not ${REPOSITORY}"

# The workflow path is compared as an exact prefix, up to and including the `@`, so another file
# whose ref merely *contains* `deploy.yml@refs/heads/main` (a branch may be named that) never matches.
case "$workflow_ref" in
  "${WORKFLOW}@refs/heads/main") ;;
  "${WORKFLOW}@refs/tags/v"*) ;;
  *) refuse "workflow ${workflow_ref} is not deploy.yml from a v* tag or main" ;;
esac

case "$event" in
  release | workflow_dispatch) ;;
  *) refuse "event ${event} is not release or workflow_dispatch" ;;
esac

echo "Accepted by the Pi's job-started hook (#2697): ${workflow_ref} on ${event}."
exit 0
