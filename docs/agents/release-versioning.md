# Release Versioning

Cutting a release is its own kind of session: no issue, no branch, and **it changes nothing in the
repository** — see `collaboration.md`. What it produces is a tag, a GitHub Release and a published
image.

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
   gh run list --branch main --commit <sha> --workflow ci.yml --json databaseId,conclusion
   gh run view <id> --json jobs --jq '.jobs[] | "\(.conclusion)  \(.name)"'
   ```

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

## The wake-up drill is not this session's

AGENTS.md opens an assignment with the wake-up drill — `git fetch origin main`, cut
`task/<issue>-<slug>` from `origin/main`, `pnpm install`, then `pnpm prisma:generate` — and says
*unconditionally*. **That word is about a session with an issue, and a release session has none**:
the drill's second step cuts a branch named after one. Only the fetch survives, and it survives on
its own merit rather than by inheritance — you need `main`'s actual head to know what you are
tagging, which is the discipline step 1 already states about the version.

**`pnpm install` and `pnpm prisma:generate` are the two steps that word was written for, and neither
can mislead a release session.** #862 is about a Prisma client that is stale rather than missing,
which compiles and whose tests pass against a schema the branch no longer declares — a failure that
needs a local build or a local suite to happen in. **A release session runs neither.** Every check
it reads is a run on GitHub against a fresh checkout: `main`'s at step 3 and the tag's at step 5.
There is nothing local here for a stale client to be stale against.

**The drill's *read each step's own exit status* clause does not reach this session either, and the
reason is structural rather than a judgement that it does not matter** (#1066). That clause is about
a `&&` chain ending in a pipe reporting the pipe's status; a release session runs the fetch and
nothing else, so it has one command, nothing to chain it to, and a status that is its own. Run it
alone anyway — you need `main`'s actual head to know what you are tagging, which is step 1's
discipline — and the failure shape the clause names cannot arise here.

**So read this file and `collaboration.md` with `git show origin/main:<path>`, at the moment you are
assigned and before step 1.** That follows from the paragraphs above rather than adding to them: the
step this session does not run is the **cut**, and the cut is the whole of what a task session's
reading depends on. `AGENTS.md` puts the fetch and the branch cut before any process file is read,
because after the cut the worktree **is** `origin/main` and every file in it is current by
construction (#1060; `collaboration.md`, *A pooled worker reads nothing until it is assigned*). A
release session runs the fetch and stops there, and **the fetch moves `origin/main` without moving a
single file it can open** — so its worktree is as old as the pool for the whole of its life, and the
explicit read is its only answer rather than a fallback for what it forgot to do.

**And nothing has to remember to tell you so.** `CLAUDE.md` says to read `AGENTS.md` with
`git show origin/main:AGENTS.md` until a branch has been cut, and `AGENTS.md`'s wake-up-drill bullet
names this section for the release narrowing — so a session arriving here has already read one file
the explicit way and is being told to go on doing it, rather than meeting the instruction for the
first time inside the procedure it governs.

**The gap is sharper here than the one that ordering was written for.** A task session that read its
worktree first held a file some hours old and then cut a branch that corrected it, for free and
without being told. Nothing corrects this one. And what it is reading is a **procedure** rather than
a rule about how to work: this file took 102 added lines on 2026-09-10, the largest single move of
any process file that day, two hours before the session that noticed this was assigned. A release
session on the stale copy would tag on a step that had been replaced, and everything it then ran
would come back clean — the steps it did read are real steps, and a procedure missing its newest one
reports nothing at all (#1067).

**Step 1 does not get the same sentence beside it, and that is a decision rather than an oversight.**
It guards the same failure about a different fact — never trust a remembered version — and that
parallel is worth having, which is why the section above already draws it twice. What step 1 must not
become is a second statement of *this* rule: **a rule about which copy to read cannot have its record
inside the thing being read**, because a session that has reached step 1 has finished reading, and a
warning placed there arrives after the moment it governs. That is why `AGENTS.md` rather than
`collaboration.md` is the record of the ordering for a task session, and it applies here unchanged.
The two facts are not answered alike either: the released version has a one-command answer that is
correct whenever it is run, which is why naming the command is all step 1 has to do — **which copy of
a procedure you are holding has no command that answers it**, and is settled before step 1 is
reached.

This is stated in this file rather than in AGENTS.md because `collaboration.md` gives this file the
release procedure end to end.

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

In a backlog-review session, only *suggest* a release — do not prepare, tag, push or create it.
Release preparation is handled by a separate session, spawned fresh each time (`collaboration.md`).
