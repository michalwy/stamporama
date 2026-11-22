#!/usr/bin/env bash
#
# Wait for a pull request's required checks to finish, then print ONE line (#2700).
#
# A thread used to poll CI by hand, one `gh api …/check-runs` every minute or so, and every poll was
# a model turn. This script does the polling itself, prints nothing while it waits, and ends with a
# single result line, so the wait costs one tool call. Run it in the background (Claude Code's Bash
# `run_in_background`) or with a long timeout; CI takes several minutes.
#
#   scripts/ci/wait-for-checks.sh <PR>
#
# Exit status and the one line:
#   0  green    <sha> — every required check is success, or skipped on a run where `Detect changes`
#                       succeeded (its safe list, #798)
#   1  red      <sha> — a required check failed, was cancelled or timed out; it names each with its URL.
#                       It exits on the first red result rather than waiting for the rest.
#   2  timeout  <sha> — still pending after WAIT_TIMEOUT seconds; it names what is pending.
#   3  error          — bad usage, or `gh api` failed (GraphQL is never used: REST only, so it works in
#                       a cloud thread).
#
# The required checks are read from `.github/rulesets/main.json`, the checked-in record of `main`'s
# ruleset (`Ruleset drift` keeps it equal to the live one). The head is re-read on every poll, so a
# push during the wait is followed rather than reported against the old head. A check run listed
# twice (a re-run) counts by its latest `started_at`.
#
# Environment: GH_REPO_PATH (default michalwy/stamporama), WAIT_INTERVAL (seconds between polls,
# default 30), WAIT_TIMEOUT (default 1800), RULESET (default .github/rulesets/main.json).

set -uo pipefail

pr=${1:-}
if ! [[ "$pr" =~ ^[0-9]+$ ]]; then
  echo "error usage: scripts/ci/wait-for-checks.sh <PR number>"
  exit 3
fi

repo=${GH_REPO_PATH:-michalwy/stamporama}
interval=${WAIT_INTERVAL:-30}
limit=${WAIT_TIMEOUT:-1800}
root="$(cd "$(dirname "$0")/../.." && pwd)"
ruleset=${RULESET:-$root/.github/rulesets/main.json}

if ! required=$(node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const names = r.rules.filter((x) => x.type === "required_status_checks")
    .flatMap((x) => x.parameters.required_status_checks.map((c) => c.context));
  if (!names.length) process.exit(1);
  console.log(names.join("\n"));
' "$ruleset" 2>/dev/null); then
  echo "error cannot read the required checks from $ruleset"
  exit 3
fi
mapfile -t names <<< "$required"

started=$SECONDS
sha=""
while :; do
  if ! sha=$(gh api "repos/$repo/pulls/$pr" --jq .head.sha 2>/dev/null) || [ -z "$sha" ]; then
    echo "error gh api could not read pull request #$pr in $repo"
    exit 3
  fi
  # name<TAB>status<TAB>conclusion<TAB>started_at<TAB>url, newest last after the sort.
  if ! runs=$(gh api --paginate "repos/$repo/commits/$sha/check-runs?per_page=100" \
      --jq '.check_runs[] | [.name, .status, (.conclusion // "none"), (.started_at // "9999"), .html_url] | @tsv' \
      2>/dev/null); then
    echo "error gh api could not read the check runs of $sha"
    exit 3
  fi
  runs=$(printf '%s\n' "$runs" | sort -t $'\t' -k4,4)

  latest() { printf '%s\n' "$runs" | awk -F '\t' -v n="$1" '$1 == n { line = $0 } END { print line }'; }

  detect=$(latest "Detect changes" | cut -f3)
  ok=() bad=() pending=()
  for name in "${names[@]}"; do
    line=$(latest "$name")
    if [ -z "$line" ]; then pending+=("$name=missing"); continue; fi
    status=$(cut -f2 <<< "$line")
    conclusion=$(cut -f3 <<< "$line")
    url=$(cut -f5 <<< "$line")
    if [ "$status" != "completed" ]; then pending+=("$name=$status"); continue; fi
    case "$conclusion" in
      success) ok+=("$name") ;;
      skipped)
        if [ "$detect" = "success" ]; then ok+=("$name(skipped)"); else bad+=("$name=skipped-without-Detect-changes $url"); fi ;;
      *) bad+=("$name=$conclusion $url") ;;
    esac
  done

  if [ ${#bad[@]} -gt 0 ]; then
    echo "red $sha PR #$pr: $(IFS=';'; echo "${bad[*]}")"
    exit 1
  fi
  if [ ${#pending[@]} -eq 0 ]; then
    echo "green $sha PR #$pr: ${ok[*]}"
    exit 0
  fi
  if [ $((SECONDS - started)) -ge "$limit" ]; then
    echo "timeout $sha PR #$pr after ${limit}s, pending: ${pending[*]}"
    exit 2
  fi
  sleep "$interval"
done
