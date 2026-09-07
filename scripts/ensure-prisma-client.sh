#!/usr/bin/env bash
#
# Generate the Prisma client if it is missing or out of date (#862).
#
# `src/generated/prisma/` is gitignored and generated, so nothing in git ever creates it. #791 made
# `pnpm install` create it, via a root `postinstall`, and that fixed the fresh-*clone* case. It does
# not fix the fresh-*worktree* case, which is the one nearly every session here is in:
#
#   * a spawned worktree arrives with `node_modules` already populated — the harness copies it from
#     the main checkout rather than installing (verified across twelve worktrees created together on
#     2026-09-07: all twelve had `node_modules`, none had a client, and the copied symlinks carried
#     the source checkout's mtimes, so no install had run in them);
#   * the generated client lives *outside* `node_modules` — Prisma 7's generator writes to
#     `output = "../src/generated/prisma"` — so copying `node_modules` does not bring it along;
#   * so whether the session's own `pnpm install` repairs that is decided by something unrelated to
#     the client: if the copied `node_modules` already matches `pnpm-lock.yaml`, pnpm prints
#     "Already up to date", **skips every lifecycle script including the postinstall**, and the tree
#     has no client at all.
#
# That last branch is not hypothetical and is not self-correcting. It is masked today only because
# the main checkout happens to be behind the lockfile, which makes the copy stale and forces a real
# install; a routine `pnpm install` there arms it again for every worktree spawned afterwards.
#
# A lifecycle script cannot close this, because the failing case is defined by lifecycle scripts not
# running. So the guarantee moves to the commands that actually need a client — which is what CI has
# always done, with an explicit `pnpm prisma:generate` step in every job that needs one.
#
# The mtime comparison is what keeps that cheap enough to run unconditionally: generating costs
# ~0.5 s and this check costs nothing, so the common case pays nothing. It also covers a case the
# postinstall never did — rebasing onto a `main` that carries a new migration rewrites
# `prisma/schema.prisma`, leaving a client that is *stale rather than missing*, which compiles and
# whose tests pass against a schema the branch no longer declares.
#
# Deliberately not wired into `pnpm build` or `pnpm lint`: `scripts/static-checks.sh` runs those
# concurrently with the typecheck, and a `prisma generate` rewriting `src/generated/prisma/` while
# `tsc` reads it is the same race that file already documents for Next's route types. That script
# calls this one from its serial prelude instead.

set -euo pipefail

cd "$(dirname "$0")/.."

schema=prisma/schema.prisma
lockfile=pnpm-lock.yaml
# `client.ts` rather than the directory: the directory exists as soon as generation starts.
marker=src/generated/prisma/client.ts

# Same guard, and for the same reason, as the root `postinstall` (#791): the Dockerfile's `deps`
# stage has no `prisma/` to generate from.
[ -f "$schema" ] || exit 0

if [ ! -f "$marker" ]; then
  reason="no generated client"
elif [ "$schema" -nt "$marker" ]; then
  reason="$schema is newer than the generated client"
elif [ -f "$lockfile" ] && [ "$lockfile" -nt "$marker" ]; then
  reason="$lockfile is newer than the generated client"
else
  exit 0
fi

echo "==> Generating Prisma client ($reason)"
exec pnpm exec prisma generate
