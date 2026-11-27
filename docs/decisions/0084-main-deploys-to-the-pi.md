# ADR-0084: The Pi Follows `main`, Not Releases

## Status

Accepted. Decided by the owner on 2026-11-27 and recorded in #2712: *"Zmieńmy mój deployment na Pi.
W tej chwili to jest brane z release, a chciałbym żeby był cały czas deployowany main."* Amends
[ADR-0083](0083-release-deploys-to-the-pi.md) in what starts a deploy; the runner, its job-started
hook, the `prod` environment, `scripts/deploy.sh`'s steps and the public-repository caution are
unchanged.

## Context

Since ADR-0083 a published release deploys the owner's Raspberry Pi: `release.yml` dispatched
`deploy.yml` on the new tag (#2704). A change merged to `main` therefore waited for the owner's word
on a release before he could see it on his own instance. The owner wants the instance to run `main`
continuously.

## Decision

1. **Every push to `main` whose CI is green deploys.** On such a push `ci.yml`'s image jobs — which
   `needs:` all four suites — publish a multi-arch image tagged `main` and `main-<short sha>`,
   versioned `main-<short sha>`, and a last job, *Deploy main to the Pi*, dispatches `deploy.yml` on
   `main` with that version and `automatic=true`. A push that `Detect changes` calls
   documentation-only skips the suites, so it builds and deploys nothing.
2. **`deploy.yml` has one trigger: `workflow_dispatch`.** `release: published` goes. A dispatch is
   what an event caused by `GITHUB_TOKEN` can start, and it is the run shape the Pi's job-started
   hook already accepts (`deploy.yml` from `main`, `workflow_dispatch`), so nothing on the Pi is
   reinstalled. A manual run, with `automatic` off, stays the redeploy and the rollback.
3. **A release no longer deploys.** `release.yml` stops after `latest`. `latest` and the semver tags
   stay release-only: other self-hosters update with `scripts/update.sh` and follow releases.
4. **The no-downgrade guard compares `main` builds by commit time.** Runs on `main` are never
   cancelled, so one can finish after a newer one's deploy. Each image carries its commit's time as
   the label `org.stamporama.commit-time`; `scripts/deploy.sh` skips an automatic deploy whose image
   is older than the running `main` build. A release and a `main` build are not compared.
5. **The UI shows a `main` build as `main-<short sha>`**, without the `v` a release gets.

## Consequences

- **A merge is a deploy.** The thread that merges reads `main`'s run and the Deploy run it starts;
  a failed deploy is reported like a red `main`. Threads still never deploy by hand.
- Every application change to `main` builds both architectures' images (about the cost of a release
  build) and leaves a `main-<sha>` image in the package; old ones may need pruning later.
- Migrations reach the live instance at merge time, not release time. The pre-deploy dump and the
  rollback are unchanged.
- Releases are still cut only on the owner's word: they are what every other installation runs.
