# Release Versioning

A release-manager session has no issue, no branch and no commit, and **it changes nothing in the
repository**. What it produces is a tag, a GitHub Release and a published image.

Read this file with `git show origin/main:docs/agents/release-versioning.md` if your worktree has
been sitting: this session never cuts a branch, so nothing refreshes the copy on disk, and a
procedure missing its newest step reports nothing at all — the steps it does carry are real steps
and every one of them comes back clean.

## The procedure

1. **Run `gh release list` fresh.** Never assume the last released version from memory or from
   local git tags — another session can tag a new version mid-session.
2. **Review what has been merged since the previous released tag**, then decide patch vs minor:
   `feat:` commits → minor, `fix:`/`chore:`/`docs:` only → patch. Never bump the major version
   unless the user explicitly asks for one. If a release does not seem warranted, ask the user for
   confirmation before deciding either way.
3. **Read `main`'s own CI run for the commit you are about to tag — its colour *and* its job
   conclusions.** The run must have completed and be green. There is always one to read: since
   dc4577f, runs on `main` and on release tags are never cancelled by a later push. Before that fix,
   7 of the last 40 runs had been cancelled and *every one of them was on `main`* — including the
   very commit v0.129.0 was tagged from. **A tag placed on a commit whose run was cancelled is a
   release nobody has checked**, and that hazard has not gone away.

   ```bash
   git rev-parse origin/main
   gh run list --branch main --commit <full-40-char-sha> --workflow ci.yml --json databaseId,conclusion
   gh run view <id> --json jobs --jq '.jobs[] | "\(.conclusion)  \(.name)"'
   ```

   **`--commit` matches on the full forty characters and answers `[]` for an abbreviated SHA**, so
   the first line is `git rev-parse origin/main` and never `git rev-parse --short origin/main`
   (#1147). The trap is not that the short form is confusing: `[]` is byte-identical to the truthful
   *no run exists*, which this step reads as the cancelled run above and so as a reason not to tag.
   The session would decline the release, be right by this procedure, and be wrong about the world.
   Measured on `f158a4d`, the head of `main` on 2026-09-11, both forms against that one commit:

   | command | answer |
   | --- | --- |
   | `gh run list --branch main --commit f158a4d …` | `[]` |
   | `gh run list --branch main --commit f158a4de37e2092c539a0b772611756625b06213 …` | `[{"conclusion":"success","databaseId":34609362324}]` |

   **Do not shorten it back.** Every SHA this project writes down is short — status tables, handover
   files, and the commit references in prose. Measured over `AGENTS.md` and `docs/agents/` on this
   branch: five seven-character SHAs, two of them the demonstration above, and exactly one
   forty-character SHA, the one in the table. So the value a release session already has in front of
   it is the value that silently fails, and the command is where the correction has to live — a
   warning beside a copyable command is answerable only by remembering. Step 5's
   `gh run list --branch vX.Y.Z` selects by branch rather than by commit and is unaffected.

   **Green is not the whole answer, and since #798 it is frequently not an answer at all.** When
   `Static checks`, `Unit tests`, `Integration tests` and `Extension checks` all report
   **`skipped`**, `Detect changes` found the whole diff inside its safe list and this run exercised
   nothing. (`Closing reference check` is skipped on every push to `main` — it runs only on a pull
   request — so it is never part of this answer either way.) That is the ordinary case here rather
   than a curiosity: this project ships a great deal of process prose, so the head of `main` at
   release time is often a documentation commit. **v0.136.0 was tagged from one**, on a green run in
   which nothing ran, and this step was discharged by it.

   **A skipped run does not stop the release; it moves the check to step 5.** What this step is,
   once the suites are skipped, is the cheap early exit — it stops you tagging on top of a `main`
   that is already red, which is cheaper than tagging and yanking — and the guarantee comes from the
   tag's own run below.

   Throughout, you are reading a run's **job conclusions** and never classifying commits. The safe
   list is the `case` glob in the `Detect changes` job in
   [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) and that glob is the record; nothing
   here asks you to decide which commits were "code-bearing".
4. **Tag the merged commit on `main`** and push the tag.
5. **Wait for the tag's own run and read it. This is the run that checks the release.** Pushing
   the tag starts a run on the tagged commit, and **a tag build is never gated on
   `Detect changes`** — the first `case` in that job matches `refs/tags/*` and runs everything,
   whatever the diff. So this one run exercises the exact tree being released, all four suites, and
   the image and the extension are published on top of them. The tag run is the one whose
   `headBranch` is the tag:

   ```bash
   gh run list --branch vX.Y.Z --json databaseId,status,conclusion
   gh run view <id> --json jobs --jq '.jobs[] | "\(.conclusion)  \(.name)"'
   ```

   **It runs after the tag exists, so it cannot gate the tag — it gates everything after it**, which
   is steps 6 and 7 and is the whole of what anybody consumes. A tag carrying no Release and no
   `latest` is not reachable: `docker-compose.prod.yml` and `scripts/install.sh` pull
   `${TAG:-latest}`. And **nothing a release publishes survives a red suite** — the publish jobs
   wait on the four suites, `Publish container image` transitively, through `Build image` — so a red
   run publishes **nothing at all** and the tag is inert by construction rather than by anybody's
   diligence. The edges are the `needs:` lists in
   [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) and that is the record; this
   sentence summarises them, as does the one in
   [`docs/architecture/overview.md`](../architecture/overview.md). If it is red, **do not create the
   Release and do not move `latest`**: delete the tag (`git push origin :refs/tags/vX.Y.Z` — the
   only ruleset in this repository targets the branch `main`, so tags are deletable), fix through
   the ordinary pull request flow, and cut again from the new head.

   **The waiting is not new; reading the result is.** Where the head is a documentation commit, step
   3 used to answer in seconds and this waits out the full suite — but the image a release publishes
   has always come out of this run, so a release was never actually finished before it. What changes
   is that somebody reads it before the Release and `latest` assert that it passed.
6. **Create the GitHub Release** (`gh release create vX.Y.Z --title vX.Y.Z`). Always write a
   proper, human-readable description instead of relying on bare `--generate-notes` output: group
   the changes into sections (Highlights / Fixes / Other), summarize each change in plain English
   with its issue reference, and keep the auto-generated "Full Changelog" compare link at the end.
7. **Move the `latest` tag to the same commit and force-push it:**
   `git tag -f latest vX.Y.Z && git push origin latest --force`.

**Why the tag run and not the last `main` run that did exercise the suites.** That run is green
about a *different tree* — the one underneath the commits whose run skipped — so reading it as
covering the release is the substitution step 3 already made, moved one commit further back. It also
needs a walk back through `main`'s runs of no fixed length, and it can never say anything about the
head itself. The tag run is green about the exact commit being released, and it is the run whose
failure actually withholds the image.

**No commit, no branch, no pull request** — the whole procedure is tags and a Release.

## There is no version bump commit

The `chore: bump version to X.Y.Z` commit that used to open a release has been **dropped**.
`package.json`'s `version` is `0.0.0` and stays there: an honest "this number means nothing" marker,
so that a frozen `0.129.0` cannot be mistaken for the current release.

**Nothing in this repository reads it.** This was checked exhaustively, not assumed — the list is
here so that a later reader does not reintroduce the bump as an oversight:

- `getAppVersion()` in `src/lib/version.ts` reads only `process.env.STAMPORAMA_VERSION`, falling
  back to `"dev"`.
- The Dockerfile takes that as a build arg (`ARG STAMPORAMA_VERSION=dev`), and CI passes
  `${{ steps.meta.outputs.version }}` from `docker/metadata-action`'s `type=semver` — i.e. **derived
  from the git tag**.
- The extension's version comes from the tag too: `pnpm assistant:zip --version "${GITHUB_REF_NAME#v}"`,
  stamped into the manifest by `extension/pack.mjs`.
- `docker-compose.prod.yml` and `scripts/install.sh` pull the image by tag (`${TAG:-latest}`).
- The package is `"private": true` and is never published.

So the bump was ceremony even before `main` was protected. Under a protected `main` it would cost a
pull request and five CI jobs per release, at several releases a day — and it is what used to make
"a release session changes nothing else" aspirational rather than true.

**The git tag is the version.** If you find yourself wanting a number written down somewhere, the
answer is `gh release list`, which is what step 1 already says.

## Publishing the extension

Every release tag also publishes the Assistant extension, **when the `CWS_PUBLISH_ENABLED`
repository variable is `true`** — CI packs a store ZIP stamped with the release version and submits
it to the unlisted Chrome Web Store listing (#288, ADR-0017). The switch exists because the store
rejects an upload while a previous version is still in review; when it is off, releases proceed and
the extension is submitted later by flipping it back on.

A green job means *submitted for review*, not live, so a release note should not promise the
extension is already updated — and it may equally mean **nothing was submitted**: the job asks the
store which version it already holds (published or in review) and skips when `extension/` has not
changed since that release's tag, because most releases touch nothing there and every submission
costs a review. So the extension's live version legitimately trails the app's; only mention it in a
release note when the job actually submitted something.

## Who may cut a release

A session the user opens for it, and nobody else. A backlog-review session may only *suggest* a
release — it does not prepare, tag, push or create one ([`backlog-review.md`](backlog-review.md)).
