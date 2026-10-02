#!/usr/bin/env bash
#
# `Detect changes`: decide whether a change touches anything the application is built from (#798).
# It writes `code=true` or `code=false` to `$GITHUB_OUTPUT`, and the four application suites in
# `.github/workflows/ci.yml` are gated on that answer. Why the gate is shaped the way it is lives in
# the comment above that job; what is here is the decision itself.
#
# **It is a script so that something can run it** (#983). It used to be a `run:` block inside the
# workflow, where nothing exercised it: the one check on its patterns was eleven sample paths tried
# by hand in a scratch shell, once. `tests/unit/detect-changes.test.ts` now runs this file with a
# stubbed `gh` over the paths that matter in both directions, and fails when the safe list below is
# wrong.
#
# Inputs, all from the workflow's environment: `GITHUB_REF`, `GITHUB_OUTPUT`, `EVENT_NAME`,
# `REPOSITORY`, `BEFORE`, `AFTER`, `PR_NUMBER`, and `GH_TOKEN` for `gh`.
#
# Usage: bash scripts/detect-changes.sh   (from the `Detect changes` job, never by hand)

set -euo pipefail

everything() {
  echo "$1"
  echo "code=true" >> "$GITHUB_OUTPUT"
  exit 0
}

# **What this list means, and it is not "documentation".** A path belongs here when no job in the
# CI workflow can say anything about a change to it. `*.md`, `docs/*` and `.claude/*` qualify
# because nothing builds from them; `renovate.json` qualifies because it is consumed by Renovate's
# service on GitHub rather than by anything the four gated jobs build, typecheck or exercise, so
# none of them has a finding to report about a change to it (#970, decided by the user on
# 2026-09-08). **The membership is untouched by what follows and is not being reopened** — the
# conclusion is the same one, on a premise that had to be corrected.
#
# **This comment used to ground that on `nothing in this repository reads it at all`, and since
# 2026-09-10 that is false.** `tests/unit/renovate-never-alone.test.ts` reads it, to check that its
# two never-alone lists correspond (#1116). The stronger sentence is quoted rather than deleted
# because it was true when it was written and will go on arriving in anything copied from it. **It
# changes nothing here**, and the test itself is why: being inside this list is exactly what makes
# `Unit tests` skip on a `renovate.json`-only pull request, so that test is a backstop rather than
# a gate and its own comment says so. A job that cannot run on the change has no finding to report
# about it.
#
# **A path added here is a path no job in the CI workflow can report a finding about.** A pull
# request whose whole diff is inside the list merges on four skipped checks, so the only thing
# standing between it and `main` is a person reading it. `renovate.json` was added deliberately,
# with that consequence put to the user (#906) — it covers the automerge boundary and the
# never-alone list — so it is a decision, not an oversight; do not "correct" it back. Anything added
# here in future carries the same cost, and needs a case in `tests/unit/detect-changes.test.ts`.
#
# The patterns are shell `case` globs, where `*` crosses a `/` — so `docs/*` covers
# `docs/agents/albums.md` and `*.md` covers `extension/README.md`. `renovate.json` is a single
# filename on purpose: `*.json` would sweep in `package.json` and `tsconfig.json`, which is the
# opposite of what was decided.
in_safe_list() {
  case "$1" in
    *.md|docs/*|.claude/*|renovate.json) return 0 ;;
  esac
  return 1
}

# **The list must never cover the files that decide it.** The test above runs under `Unit tests`,
# which is one of the jobs this script can skip — so a pattern wide enough to swallow this script
# or the workflow (`scripts/*`, `*.sh`, `.github/*`) would skip the very test that would have
# caught it, on the pull request that introduced it. This job is gated on nothing, so the check is
# made here as well, and a list that fails it runs everything — whereupon the test runs and fails.
for canary in scripts/detect-changes.sh .github/workflows/ci.yml; do
  if in_safe_list "$canary"; then
    everything "The safe list matches $canary, which decides it - running the full suite."
  fi
done

# A release builds everything, with no cleverness and no exceptions.
case "$GITHUB_REF" in
  refs/tags/*) everything "Tag build - running the full suite." ;;
esac

# A rename reports the new path as `filename` and the old one as `previous_filename`. Both are
# consulted: moving `src/lib/thing.ts` to `docs/thing.md` changes the application, and only the
# second field says so.
case "$EVENT_NAME" in
  pull_request)
    if ! files=$(gh api --paginate "repos/$REPOSITORY/pulls/$PR_NUMBER/files" \
          --jq '.[] | .filename, (.previous_filename // empty)'); then
      everything "Could not list the pull request's files - running the full suite."
    fi
    ;;
  push)
    if [ -z "$BEFORE" ] || [ "$BEFORE" = "0000000000000000000000000000000000000000" ]; then
      everything "No previous commit to compare against - running the full suite."
    fi
    if ! files=$(gh api "repos/$REPOSITORY/compare/$BEFORE...$AFTER" \
          --jq '.files[]? | .filename, (.previous_filename // empty)'); then
      everything "Could not compare $BEFORE...$AFTER - running the full suite."
    fi
    ;;
  *)
    everything "Event $EVENT_NAME carries no diff - running the full suite."
    ;;
esac

if [ -z "$files" ]; then
  everything "No changed files reported - running the full suite."
fi

echo "Changed files:"
printf '%s\n' "$files" | sed 's/^/  /'

# The question is whether the whole diff stays inside the list, not whether part of it does: one
# file outside runs everything.
while IFS= read -r file; do
  [ -n "$file" ] || continue
  in_safe_list "$file" && continue
  everything "$file is outside the safe list - running the full suite."
done <<EOF
$files
EOF

echo "code=false" >> "$GITHUB_OUTPUT"
echo "Nothing here that a CI job can speak to - the application suite is skipped."
