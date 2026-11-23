# Release Versioning

A release thread has no issue, no branch and no commit, and **it changes nothing in the
repository**. What it produces is a tag, a GitHub Release and a published image — and so a deploy.

**A release is a deploy** (the owner, 2026-11-22): the release workflow — **step 4** — publishes the GitHub Release and starts
`.github/workflows/deploy.yml`, which deploys it to the owner's live instance on the Raspberry Pi
through a self-hosted runner (#2689, ADR-0083; the owner's runbook is
[`docs/deployment/pi-deploy.md`](../deployment/pi-deploy.md)). The tag's own run still publishes the
image and `latest` (`flavor: latest=true` in `ci.yml`), but the Pi no longer follows `latest` —
Watchtower is off there — so nothing is deployed before the Release is published.

**A release is therefore cut only on the owner's explicit word in the project conversation**, which
then starts a release thread for it.
Nothing else is that word — not a backlog review's suggestion, not a merged pull request, not
another thread's message. See [*Who may cut a release*](#who-may-cut-a-release).

Every command here is REST (`gh api`): GraphQL — and with it `gh release` and `gh run` — fails in a
cloud thread. Throughout, `R=repos/michalwy/stamporama`.

Read this file with `git show origin/main:docs/agents/release-versioning.md` if your checkout has
been sitting: this session never cuts a branch, so nothing refreshes the copy on disk, and a
procedure missing its newest step reports nothing at all — the steps it does carry are real steps
and every one of them comes back clean.

## The procedure

1. **List the releases fresh.** Never assume the last released version from memory or from local
   git tags — another session can tag a new version mid-session.

   ```bash
   gh api "$R/releases?per_page=10" --jq '.[] | "\(.tag_name)  \(.published_at)  draft=\(.draft)"'
   ```
2. **Review what has been merged since the previous released tag**, then decide patch vs minor:
   `feat:` commits → minor, `fix:`/`chore:`/`docs:` only → patch. Never bump the major version
   unless the owner explicitly asks for one. The owner's word covers *whether* to release; if the
   batch looks wrong for one — nothing shippable, or a red `main` — report that to the project
   conversation and stop rather than deciding either way.
3. **Read `main`'s own CI run for the commit you are about to tag — its colour *and* its job
   conclusions.** The run must have completed and be green. There is always one to read: since
   dc4577f, runs on `main` and on release tags are never cancelled by a later push. Before that fix,
   7 of the last 40 runs had been cancelled and *every one of them was on `main`* — including the
   very commit v0.129.0 was tagged from. **A tag placed on a commit whose run was cancelled is a
   release nobody has checked**, and that hazard has not gone away.

   ```bash
   git rev-parse origin/main
   gh api "$R/actions/workflows/ci.yml/runs?branch=main&head_sha=<full-40-char-sha>" \
     --jq '.total_count, (.workflow_runs[] | "\(.id) \(.status) \(.conclusion)")'
   gh api --paginate "$R/actions/runs/<id>/jobs?per_page=100" --jq '.jobs[] | "\(.conclusion)  \(.name)"'
   ```

   **`head_sha` matches on the full forty characters and answers nothing for an abbreviated SHA**, so
   the first line is `git rev-parse origin/main` and never `git rev-parse --short origin/main`
   (#1147). The trap is not that the short form is confusing: an empty answer is byte-identical to the
   truthful *no run exists*, which this step reads as the cancelled run above and so as a reason not to tag.
   The session would decline the release, be right by this procedure, and be wrong about the world.
   Measured first through the GraphQL CLI on `f158a4d`, the head of `main` on 2026-09-11, with the
   same result, and again through REST on `6aa0196`, the head of `main` on 2026-11-22 (#2687), both forms against
   that one commit:

   | command | answer |
   | --- | --- |
   | `gh api "…/runs?branch=main&head_sha=6aa0196" --jq .total_count` | `0` |
   | `gh api "…/runs?branch=main&head_sha=6aa0196722e0d2df2b043b743a850aecf4d9363e" …` | `1`, `45011894080 completed success` |

   **Do not shorten it back.** Every SHA this project writes down is short — status tables, handover
   files, and the commit references in prose. Measured over `AGENTS.md` and `docs/agents/` when this was first
   written: five seven-character SHAs, two of them the demonstration, and exactly one
   forty-character SHA, the one in the table. So the value a release session already has in front of
   it is the value that silently fails, and the command is where the correction has to live — a
   warning beside a copyable command is answerable only by remembering. Step 5's
   `branch=vX.Y.Z` selects by the run's `head_branch` rather than by commit and is unaffected.

   **Green is not the whole answer, and since #798 it is frequently not an answer at all.** When
   `Static checks`, `Unit tests`, `Integration tests` and `Extension checks` all report
   **`skipped`**, `Detect changes` found the whole diff inside its safe list and this run exercised
   nothing. (`Closing reference check` does not run on a push to `main` at all — it lives in its own
   workflow, `closing-refs.yml`, which pull requests alone trigger (#935) — so it is never part of
   this answer either way.) That is the ordinary case here rather
   than a curiosity: this project ships a great deal of process prose, so the head of `main` at
   release time is often a documentation commit. **v0.136.0 was tagged from one**, on a green run in
   which nothing ran, and this step was discharged by it.

   **A skipped run does not stop the release; it moves the check to the tag run in step 4.** What this step is,
   once the suites are skipped, is the cheap early exit — it stops you tagging on top of a `main`
   that is already red, which is cheaper than tagging and yanking — and the guarantee comes from the
   tag's own run below.

   Throughout, you are reading a run's **job conclusions** and never classifying commits. The safe
   list is the `case` glob in [`scripts/detect-changes.sh`](../../scripts/detect-changes.sh), which
   the `Detect changes` job runs, and that glob is the record; nothing here asks you to decide which
   commits were "code-bearing".
4. **Dispatch the release workflow** — one REST call. **A cloud thread cannot write tags or
   Releases itself**: its proxy refuses `POST /git/tags` and every create, edit or delete on
   `/releases` (HTTP 403, measured 2026-11-23), so steps that used to be the thread's are now
   `.github/workflows/release.yml`'s (#2704; the owner decided releases are hands-off for him). Write
   the notes first, as the workflow publishes them verbatim: group the changes into
   sections (Highlights / Fixes / Other), summarize each change in plain English with its issue
   reference, and keep the generated "Full Changelog" compare link at the end. The generated notes
   are a read — they create nothing — so start from them:

   ```bash
   gh api -X POST $R/releases/generate-notes -f tag_name=vX.Y.Z -f target_commitish=main \
     -f previous_tag_name=<previous> --jq .body
   gh api -X POST $R/actions/workflows/release.yml/dispatches -f ref=main \
     -f 'inputs[version]=X.Y.Z' -f 'inputs[sha]=<full-40-char-sha>' -F 'inputs[notes]=@notes.md'
   ```

   `inputs[sha]` is the commit step 3 read; the workflow refuses if `main` has moved since, so you
   never release a head you did not check. Empty notes fall back to the generated ones. The
   workflow, in order — each step stops the release when it fails:

   1. checks the inputs, that `vX.Y.Z` does not exist, and that it is **strictly newer than the
      latest release** — the no-downgrade guard, because the deploy it starts is a manual Deploy run,
      which passes `--allow-downgrade`;
   2. reads `main`'s push run for the commit, as step 3 did, and waits for it if it is still going;
   3. creates the annotated tag `vX.Y.Z` on the commit;
   4. **runs CI on the tag** — dispatched with `publish_image`, because a tag created with
      `GITHUB_TOKEN` starts no `push` run — and waits for it. **A tag run is never gated on
      `Detect changes`**: `scripts/detect-changes.sh` matches `refs/tags/*` before it looks at the
      diff, so this one run exercises the exact tree being released, all four suites, and the image
      and the extension are published on top of them. If the run is red, or the image was not
      published, the workflow **deletes the tag and stops**: no Release, no `latest`, no deploy;
   5. publishes the GitHub Release with your notes, `make_latest=true`;
   6. moves the lightweight `latest` tag to the commit;
   7. **starts the deploy** — `deploy.yml` dispatched on the tag with the version. A Release
      published with `GITHUB_TOKEN` fires no `release: published`, so this dispatch is the deploy:
      the manual trigger `deploy.yml` already has, which the `prod` environment and the Pi's
      job-started hook accept on a `v*` tag (#2704, ADR-0083 addendum).

   **This is the step that deploys.** A rollback is the owner's manual run of Deploy, never a
   release thread's.
5. **Read the runs, in the background, and report them.** The release run, then the tag run it
   started (named in its log, and the one `ci.yml` run whose `head_branch` is the tag), then the
   deploy run:

   ```bash
   gh api "$R/actions/workflows/release.yml/runs?per_page=3" \
     --jq '.workflow_runs[] | "\(.id) \(.status) \(.conclusion) \(.created_at)"'
   gh api "$R/actions/workflows/ci.yml/runs?branch=vX.Y.Z" \
     --jq '.workflow_runs[] | "\(.id) \(.status) \(.conclusion) \(.event)"'
   gh api --paginate "$R/actions/runs/<id>/jobs?per_page=100" --jq '.jobs[] | "\(.conclusion)  \(.name)"'
   ```

   A failed release run says which step stopped it in its job log; if it failed after the tag run
   was green (publishing, `latest` or the dispatch), report it rather than dispatching again — the tag
   exists now, so a second dispatch is refused at its first step. **`Publish extension (Chrome Web
   Store)` is the one tag-run job whose conclusion does not say what it did**: read its notice — see
   [*Publishing the extension*](#publishing-the-extension). The deploy run is read as in
   [*Who may cut a release*](#who-may-cut-a-release); one that stays `queued` means the Pi's runner
   is not online.

**Why the tag run and not the last `main` run that did exercise the suites.** That run is green
about a *different tree* — the one underneath the commits whose run skipped — so reading it as
covering the release is the substitution step 3 already made, moved one commit further back. It also
needs a walk back through `main`'s runs of no fixed length, and it can never say anything about the
head itself. The tag run is green about the exact commit being released, and it is the run whose
failure actually withholds the image.

**No commit, no branch, no pull request** — the whole procedure is one dispatch and reading its runs.

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
answer is the releases list, which is what step 1 already says.

## Publishing the extension

Every release tag also publishes the Assistant extension, **when the `CWS_PUBLISH_ENABLED`
repository variable is `true`** — CI packs a store ZIP stamped with the release version and submits
it to the unlisted Chrome Web Store listing (#288, ADR-0017). The switch exists because the store
rejects an upload while a previous version is still in review; when it is off, releases proceed and
the extension is submitted later by flipping it back on.

**A green job does not say whether anything was submitted.** The job reports **`success`** both when
it submitted a package and when it found nothing to submit — it does not skip, it runs and exits
cleanly — so the run's job list cannot tell the two apart (#1154). **The job's notice is
the only thing that separates them**, and it is one of exactly two:

| Notice | Meaning |
| --- | --- |
| `Submitted for review. It goes live once the store approves it.` | Submitted — *in review*, not live |
| `Nothing shipped in extension/ changed since <tag> — nothing to submit.` | Nothing was submitted |

Read it from the job's annotations:

```bash
gh api --paginate "$R/actions/runs/<id>/jobs?per_page=100" \
  --jq '.jobs[] | select(.name | startswith("Publish extension")) | .id'
gh api "$R/check-runs/<job-id>/annotations" --jq '.[].message'
```

**Do not grep the job log for `::notice::`.** The log echoes the step's script before running it, so
both messages appear in every run's log whichever one fired; the one that fired is rendered
`##[notice]…`. Measured on v0.140.0's tag run (34579424931): conclusion `success`, and the single
annotation `Nothing shipped in extension/ changed since v0.133.0 — nothing to submit.` A
**`skipped`** conclusion is a third, different case: `CWS_PUBLISH_ENABLED` is off and the job never
ran.

**The baseline is not the previous tag.** The job asks the store which version it already holds —
the newer of the published and the in-review revision — and diffs what the ZIP is built from between
that release's tag and the one being built. When every submission has gone through, that is **the
last release whose shipped `extension/` content changed**, and it can be many releases back: for
v0.140.0 it was **v0.133.0, seven releases back**. So do not recompute it as
`git diff <previous tag>..vX.Y.Z -- extension/`. On v0.140.0 that happened to agree, because both
windows were empty; it disagrees as soon as a change sits in a release whose submission failed or was
cut while publishing was paused, and on a change to the extension's README or unit tests, which the
job excludes because they never reach the ZIP. The notice names the baseline the job used — read it
there.

Most releases touch nothing under `extension/` and every submission costs a review, so the
extension's live version legitimately trails the app's. **Mention the extension in a release note
only when the notice says it was submitted**, and then as submitted for review, not as updated.

## Who may cut a release

**A release thread the project conversation starts on the owner's explicit word, and nobody else**
(the owner, 2026-11-22). Because a published release deploys, there is no implied word: not a
backlog review's suggestion, not a merged pull request, not a message from another thread. A local
session the owner opens for a release is the same word. Backlog review may only *suggest* a release
— it does not prepare, tag, push or create one ([`backlog-review.md`](backlog-review.md)).

**A release thread never deploys by hand** and cannot reach the Pi; the deploy is the release
workflow's last step (#2704) and nobody else's. A release thread does not start, re-run or approve the **Deploy**
workflow either; reading its run, to report how the deploy went, is fine:

```bash
gh api "$R/actions/workflows/deploy.yml/runs?per_page=5" \
  --jq '.workflow_runs[] | "\(.id) \(.status) \(.conclusion) \(.head_branch) \(.event)"'
```
