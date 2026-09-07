#!/usr/bin/env bash
#
# `Static checks`: lint, typecheck and build, run concurrently instead of one after another (#881).
#
# The job was 4 min 09 s of three serial steps — build 101 s, lint 60 s, typecheck 34 s — which made
# it the wall clock of every pull request, and of every open branch again on every merge, because
# `main`'s required checks are strict. Running the three at once hides the 94 s of lint and
# typecheck inside the 101 s of build.
#
# **Two things are load-bearing here and neither is an optimisation.**
#
# 1. `next build` and `tsc` fight over Next's generated route types. Every build rewrites
#    `<distDir>/types/routes.d.ts` — 26 KB, with a plain `fs.promises.writeFile`, not atomically —
#    partway through, and a `tsc` reading that file at the wrong moment gets a truncated one. The
#    typecheck therefore reads `.next-typecheck/types/`, a copy taken below while nothing is
#    running. `tsconfig.typecheck.json` carries the rest of that reasoning.
#
#    The tempting fix is to give the build its own `NEXT_DIST_DIR` and leave `.next` to the
#    typecheck. It is the wrong one twice over: `next typegen` bakes the dist directory into
#    `next-env.d.ts`, so the two would then fight over *that* file at the repository root, and it
#    also **appends the new directory to the tracked `tsconfig.json` and reformats it**. Both were
#    tried; this is what is left.
#
# 2. Three interleaved output streams are unreadable, so nothing is interleaved: each check writes
#    to its own file and the whole of it is printed at the end, in a fixed order, whatever order
#    they finished in. A failure is printed in full and annotated; a pass is folded into a
#    collapsed group. A red run therefore shows *less* than it did serially — the failing check's
#    output and nothing else.
#
# Usage: scripts/static-checks.sh   (also `pnpm check:static`)

set -uo pipefail

cd "$(dirname "$0")/.."

# `next typegen` writes `.next/types/` and `next-env.d.ts`. Doing it here, alone, means the build
# below finds `next-env.d.ts` already correct and leaves it alone — Next rewrites that file only
# when its content would change.
echo "==> Generating route types"
prelude_started=$SECONDS
if ! pnpm exec next typegen; then
  echo "::error title=typegen::next typegen failed"
  exit 1
fi

# The typecheck's private copy, taken before anything can be writing to it.
rm -rf .next-typecheck
mkdir -p .next-typecheck
cp -R .next/types .next-typecheck/types
# Derived, never hand-written: whatever references Next puts in `next-env.d.ts`, the typecheck sees
# the same ones, pointed at the copy. It lives *inside* `.next-typecheck/` rather than beside
# `next-env.d.ts` at the root, because TypeScript's `**/*.ts` does not descend into a dotted
# directory — which is why the stock `tsconfig.json` has to name `.next/types/**/*.ts` explicitly,
# and what keeps `pnpm typecheck` from picking this shim up and compiling both copies of the route
# types at once.
sed 's#\./\.next/types/#./types/#g' next-env.d.ts > .next-typecheck/env.d.ts
prelude=$((SECONDS - prelude_started))

names=(lint typecheck build)
commands=(
  "pnpm lint"
  "pnpm exec tsc --noEmit -p tsconfig.typecheck.json"
  "pnpm build"
)

log_dir=$(mktemp -d)
trap 'rm -rf "$log_dir"' EXIT

echo "==> Running ${names[*]} concurrently"
started=$SECONDS
pids=()
for i in "${!names[@]}"; do
  name=${names[$i]}
  command=${commands[$i]}
  (
    start=$SECONDS
    bash -c "$command" > "$log_dir/$name.log" 2>&1
    status=$?
    echo "$status" > "$log_dir/$name.status"
    echo "$((SECONDS - start))" > "$log_dir/$name.seconds"
    exit "$status"
  ) &
  pids+=("$!")
done

for pid in "${pids[@]}"; do
  wait "$pid" || true
done
elapsed=$((SECONDS - started))

# The summary comes first, so the top of the step says which check failed before any output of any
# of them. `$GITHUB_ACTIONS` is what decides whether to emit fold markers and annotations; run by
# hand this prints plainly.
failed=()
echo
echo "==> Static checks"
printf '    %-10s ok      %4ss\n' "typegen" "$prelude"
for name in "${names[@]}"; do
  status=$(cat "$log_dir/$name.status" 2>/dev/null || echo 1)
  seconds=$(cat "$log_dir/$name.seconds" 2>/dev/null || echo "?")
  if [ "$status" = "0" ]; then
    printf '    %-10s ok      %4ss\n' "$name" "$seconds"
  else
    printf '    %-10s FAILED  %4ss  (exit %s)\n' "$name" "$seconds" "$status"
    failed+=("$name")
  fi
done
printf '    %-10s         %4ss\n' "wall clock" "$((prelude + elapsed))"
echo

# Failures in full and expanded, in `names` order; passes folded away behind them.
for name in "${failed[@]}"; do
  echo "======== $name failed ========"
  cat "$log_dir/$name.log"
  echo "======== end of $name ========"
  echo
done

for name in "${names[@]}"; do
  [ -s "$log_dir/$name.status" ] && [ "$(cat "$log_dir/$name.status")" = "0" ] || continue
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::group::$name (passed)"
  cat "$log_dir/$name.log"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::endgroup::"
done

if [ ${#failed[@]} -gt 0 ]; then
  for name in "${failed[@]}"; do
    echo "::error title=$name::The $name check failed — its output is printed in full under \"======== $name failed ========\" in this step's log"
  done
  exit 1
fi
