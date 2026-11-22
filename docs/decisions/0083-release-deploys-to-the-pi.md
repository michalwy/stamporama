# ADR-0083: A Published Release Deploys to the Pi Through a Self-Hosted Runner

## Status

Accepted. Decided by the owner on 2026-11-22 and recorded in #2689 (triggers, runner, environment,
the public-repository caution, the order of the steps, configuration staying on the Pi); built there.
Follows #2687, which made a published release a deploy. Replaces Watchtower **on the owner's
instance only** — other self-hosters keep it until the follow-up issue (#2690) deals with them.

## Context

The owner's live instance runs `docker-compose.prod.yml` on a Raspberry Pi, and until now
Watchtower (`containrrr/watchtower`, the `autoupdate` profile) polled GHCR and restarted the app on
any new `latest`. That had three problems:

- **Watchtower is unmaintained** — its repository was archived in December 2025.
- **Nothing happened before or after the swap**: no backup before migrations ran, no check that the
  new container came up, no way back but by hand.
- **Nothing recorded what was deployed when.** A deploy was a side effect of a tag, visible only on
  the Pi.

Since #2687 a published GitHub Release *is* a deploy, and the release procedure publishes it only
after the tag's own CI run is green and the image is in GHCR. The deploy should hang off that event
and be visible in GitHub Actions.

The Pi is on a home network: GitHub cannot reach it, but it can reach GitHub. That is the shape of a
**self-hosted runner** — it polls for jobs, so nothing is exposed — and the owner already runs one on
the Pi. The repository is **public**, which is the danger: a self-hosted runner executes whatever the
job's commit says, on the machine that holds the production `.env` and reaches the production
database. GitHub's own guidance is not to use self-hosted runners with public repositories for
exactly this reason, because a fork's pull request can run a workflow.

## Decision

1. **`.github/workflows/deploy.yml` runs on `release: published` and `workflow_dispatch` with a
   version input — and nothing else.** Never `pull_request` or `pull_request_target` (nor
   `workflow_call`, which would let another workflow borrow it). The job checks
   `github.repository == 'michalwy/stamporama'`, runs on `[self-hosted, pi, stamporama]` in the
   `prod` environment, in a concurrency group that **queues rather than cancels**, with a timeout.
   `tests/unit/deploy-workflow.test.ts` pins every one of these.
2. **No other workflow may reach a self-hosted runner, and CI enforces it.**
   `scripts/check-self-hosted-runners.mjs`, run by `tests/unit/self-hosted-runners.test.ts` inside
   the required `Unit tests` check, fails when another workflow names `self-hosted` — the owner's
   rule — **and** when another workflow's `runs-on` is anything but a GitHub-hosted label. The second
   half closes a hole in the first: a job need not ask for `self-hosted` to land on a self-hosted
   runner, `runs-on: [pi]` is enough. It reads lines rather than YAML and **fails closed** on any
   shape it does not recognise. Beside it, the repository setting *Require approval for all external
   contributors* stays on, and agents never approve a fork's workflow run.
3. **`scripts/deploy.sh` does the deploy, in the owner's order:**
   1. pull the release image **by digest** — the tag is resolved once and only the digest is used
      after that, and the image's own `STAMPORAMA_VERSION` must match the release;
   2. the **no-downgrade guard** — when the running version is newer, skip and *succeed*; a manual
      run passes `--allow-downgrade`, which is how a rollback is made;
   3. a **pre-deploy `pg_dump`** of the external database, custom format, into a backup directory on
      the Pi, keeping the newest 14 by default;
   4. `docker compose up -d` — migrations still run at container start, as they always have;
   5. wait for the container's **health check**, and on failure **roll back to the previous image**
      (by its digest) and fail the job. **Migrations are not rolled back**; the dump is how the
      database goes back, by hand, following the runbook.
4. **The installation is the configuration.** The script works in the existing installation
   directory with its own `.env` and compose file list; it never rebuilds `.env` from GitHub secrets.
   The one key it writes is `TAG` — `X.Y.Z@sha256:…`, after a container came up healthy — so a later
   hand-run `docker compose up -d` starts the same image rather than whatever `latest` is by then.
   The compose file's `ghcr.io/michalwy/stamporama:${TAG}` accepts a tag followed by a digest, so
   `docker-compose.prod.yml` did not change.
5. **The compose project name is checked, not assumed.** It decides the name of the photo volume
   (`<project>_stamporama-data`); a deploy under another name would start the app on an empty photo
   store. The script finds the installation's running app by the directory compose ran it from and
   refuses when its project differs from the one this deploy would use.
6. **The output is public, so it says little.** Actions logs of a public repository can be read by
   anyone. The script prints versions, digests and dump file names, never `.env`, the database
   address, paths on the Pi or the application's logs; `pg_dump`'s own messages go to a file in the
   backup directory.

## Consequences

- A deploy is a run in the Actions tab with a summary of what happened: deployed, already running,
  skipped as a downgrade, or rolled back.
- **A rollback is a manual run with an older version.** The guard lets it through, and it takes a
  dump first like any other deploy. Its database still carries the newer release's migrations;
  whether the older code copes is the owner's call, and restoring the dump is the other way.
- **Watchtower must be off on the Pi.** Two updaters would fight over the container, so the script
  refuses to run while `COMPOSE_PROFILES` contains `autoupdate`.
- **The Pi keeps two app images**, the running one and the one a rollback would use; the script
  removes the repository's other unused images after a successful deploy, which Watchtower's
  `WATCHTOWER_CLEANUP` used to do.
- **Dumps accumulate on the Pi's disk**, 14 by default (`STAMPORAMA_BACKUP_KEEP`). They hold the
  whole collection, so they live in a `0700` directory; copying them off the Pi is the owner's
  existing backup, not this workflow.
- **`pg_dump` comes from `postgres:18-alpine`** (`STAMPORAMA_PG_CLIENT_IMAGE`), whose major must be
  at least the server's; a newer server makes the dump — and so the deploy — fail before anything
  changed.
- A release published while the runner is offline waits in the queue (GitHub gives up after 24
  hours); the deploy happens when the Pi is back.

## Alternatives considered

- **Keep Watchtower, or a maintained fork of it.** Still polls, still has no backup, health gate or
  record; the event that should trigger a deploy is the Release, and only Actions sees it.
- **SSH from a GitHub-hosted runner into the Pi.** Needs the Pi reachable from the internet, or a
  tunnel, and an SSH key in GitHub secrets that can do anything on the Pi. The self-hosted runner
  reaches out instead and holds no credential GitHub could leak.
- **Rebuild `.env` from GitHub secrets on every deploy.** Would move the marketplace credentials,
  `STAMPORAMA_SECRET_KEY` and everything `scripts/install.sh` manages into GitHub, and make two
  places to edit them. Declined by the owner.
- **A YAML parser for the workflow check.** One more dependency for a check that only needs to read
  `runs-on` lines; reading lines and failing closed on anything unusual is enough, and a new shape is
  a visible edit to the script.
