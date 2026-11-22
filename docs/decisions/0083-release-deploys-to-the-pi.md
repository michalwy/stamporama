# ADR-0083: A Published Release Deploys to the Pi Through a Self-Hosted Runner

## Status

Accepted. Decided by the owner on 2026-11-22 and recorded in #2689 (triggers, runner, environment,
the public-repository caution, the order of the steps, configuration staying on the Pi); built there.
Follows #2687, which made a published release a deploy. Replaces Watchtower **on the owner's
instance only**. Extended on 2026-11-22 by #2690, which removes Watchtower for every other
self-hoster too — see [*Other self-hosters*](#other-self-hosters-2026-11-22-2690) below.

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

## Other self-hosters (2026-11-22, #2690)

The deploy above is the owner's alone: it runs on his self-hosted runner, which no other workflow
may reach, and the owner ruled out using it for anyone else. Everyone else who self-hosts was still
offered Watchtower — the `autoupdate` profile in `docker-compose.prod.yml`, a menu in
`scripts/install.sh`, a line in `README.md`. The owner left the choice between removing that option
and replacing it to the thread, as an infrastructure decision rather than a product one.

### Decision

**Watchtower is removed, and `scripts/update.sh` is the documented update path** — run by hand, or
from the host's cron or a systemd timer, which `README.md` (*Updating*) shows. Nothing new is
shipped to run it.

1. **`docker-compose.prod.yml` has no `watchtower` service and no
   `com.centurylinklabs.watchtower.enable` label.** The label goes too: it only ever meant "a
   Watchtower may update me", and without it a Watchtower left running — this installation's or one
   kept for other applications in label mode — no longer touches the app.
2. **An `.env` that still says `COMPOSE_PROFILES=autoupdate` keeps starting.** Compose accepts a
   profile no service uses, so `docker compose up -d` brings the app up as before. The one thing it
   cannot do is stop the old Watchtower container, which compose then reports as an orphan; it can no
   longer update the app (point 1), but it keeps polling. So **`scripts/update.sh` and
   `scripts/install.sh` retire it**: they drop `autoupdate` from `COMPOSE_PROFILES`, keeping any other
   profile, and remove the installation's own Watchtower container — found by its compose project and
   service labels, so nobody else's is touched. Not `--remove-orphans`, which would also remove any
   container an operator added to the project by hand.
3. **`scripts/install.sh` asks no update question** and points at `update.sh` in its summary;
   `.env.prod.example` no longer carries `STAMPORAMA_UPDATE_INTERVAL` or
   `STAMPORAMA_DOCKER_API_VERSION`, and an existing `.env` that has them is unaffected.
4. **`update.sh` keeps following `.env`'s `TAG`**: `latest` moves with each release, a pinned version
   stays put. That is the self-hoster's switch between "update me" and "leave me alone".

### Why not replace it with something automatic

- **A maintained Watchtower fork** carries the same weaknesses that made the owner leave it: it polls,
  holds the Docker socket, takes no backup before the migrations run and has no health gate — and it
  is one more third party with root-equivalent access to every self-hoster's host.
- **An installer-made cron job or systemd timer** would have `install.sh` write outside its
  directory, as root, in a way that differs between distributions — and make an unattended update,
  with its migrations and no backup, the default rather than a choice. The documented recipe is one
  step for those who want it, and the warning to back up first sits beside it.
- **Porting `scripts/deploy.sh`** (backup, health gate, rollback) to other self-hosters would be the
  real improvement, but it is built around the owner's runner and his external database, and making
  it general is its own piece of work — a backlog idea, not this issue.

### Consequences

- **Self-hosters who had automatic updates no longer get them** until they schedule `update.sh`.
  The installer and the first `update.sh` run say so.
- **Nothing cleans old images any more** (Watchtower's `WATCHTOWER_CLEANUP` did); `docker image
  prune` is the self-hoster's, as for any other Compose application.
- **The app container is recreated once** by the first `up -d` with the new compose file, because
  its labels changed.
- `scripts/deploy.sh` keeps refusing while `autoupdate` is set or a Watchtower container runs; both
  checks still describe a real conflict and cost nothing.

## 2026-11-22: the runner refuses every job but the deploy (#2697)

Decided in #2697, a follow-up to the review of #2696, which found that decision 2 does less than it
says. `scripts/check-self-hosted-runners.mjs` keeps every workflow but `deploy.yml` off a
self-hosted runner **on `main`**, but it cannot stop one from **running**: a `pull_request` run uses
the workflow files from the pull request's own head, so a pull request that adds
`runs-on: [self-hosted, pi, stamporama]` to `ci.yml` gets that job onto the Pi once, in the same run
where the check goes red. Fork pull requests wait for approval; a pull request from a branch of this
repository — every agent thread's is one — does not.

So the Pi itself refuses. **The runner's job-started hook**,
[`scripts/runner-job-started-hook.sh`](../../scripts/runner-job-started-hook.sh), set through
`ACTIONS_RUNNER_HOOK_JOB_STARTED` in the runner's `.env`, runs before every job and exits non-zero —
which fails the job before any step — unless **all** of these hold:

- `GITHUB_REPOSITORY` is `michalwy/stamporama`;
- `GITHUB_WORKFLOW_REF` is `michalwy/stamporama/.github/workflows/deploy.yml@refs/tags/v…` or
  `…/deploy.yml@refs/heads/main`, compared as an exact prefix so that a ref which only *contains*
  that text does not pass;
- `GITHUB_EVENT_NAME` is `release` or `workflow_dispatch`.

It **fails closed** — a missing or empty variable is a refusal — and prints one line saying why,
naming only what the public log already shows. The runbook installs it, root-owned and outside the
runner's directory, **before** the runner is registered, and says how to add it to a runner that is
already registered and how to check that it is active. `tests/unit/runner-job-started-hook.test.ts`
runs it over the accepted and refused cases in the required `Unit tests` check; a real runner on the
Pi calling it is the owner's check, in the runbook.

The CI check stays: it keeps such a workflow off `main`, where every later run would use it; the
hook is what stops it running on the Pi. Fork approval stays as well. Nothing
about the deploy's triggers or credentials changed.
