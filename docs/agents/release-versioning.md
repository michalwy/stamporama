# Release Versioning

Cutting a release is its own kind of session: no issue, no branch, and **it changes nothing in the
repository** — see `collaboration.md`. What it produces is a tag, a GitHub Release and a published
image.

## The procedure

1. **Run `gh release list` fresh.** Never assume the last released version from memory or from local
   git tags — another session can tag a new version mid-session.
2. **Review what has been merged since the previous released tag**, then decide patch vs minor:
   `feat:` commits → minor, `fix:`/`chore:`/`docs:` only → patch. Never bump the major version
   unless the user explicitly asks for one. If a release does not seem warranted, ask the user for
   confirmation before deciding either way.
3. **Read `main`'s own CI run for the commit you are about to tag, and wait for it to be green.**
   There is always a run to read now: since dc4577f, runs on `main` and on release tags are never
   cancelled by a later push. Before that fix, 7 of the last 40 runs had been cancelled and *every
   one of them was on `main`* — including the very commit v0.129.0 was tagged from. A tag placed on
   a commit whose run was cancelled is a release nobody has checked.
4. **Tag the merged commit on `main`** and push the tag.
5. **Create the GitHub Release** (`gh release create vX.Y.Z --title vX.Y.Z`). Always write a proper,
   human-readable description instead of relying on bare `--generate-notes` output: group the
   changes into sections (Highlights / Fixes / Other), summarize each change in plain English with
   its issue reference, and keep the auto-generated "Full Changelog" compare link at the end.
6. **Move the `latest` tag to the same commit and force-push it:**
   `git tag -f latest vX.Y.Z && git push origin latest --force`.

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
pull request and four CI jobs per release, at several releases a day — and it is what used to make
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
