# Deploying releases to the Raspberry Pi

The owner's live instance is deployed by GitHub Actions: **publishing a GitHub Release deploys it**
(#2689, [ADR-0083](../decisions/0083-release-deploys-to-the-pi.md)). The workflow is
[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml); it runs on a self-hosted runner
on the Pi and calls [`scripts/deploy.sh`](../../scripts/deploy.sh) in the existing installation
directory. Nothing here applies to other self-hosters, who install with `scripts/install.sh` and
update with `scripts/update.sh` (README, *Updating*; Watchtower is gone since #2690).

This is the owner's runbook. **No agent thread can reach the Pi**; every step below is done by the
owner, on the Pi or in the repository's settings.

## What a deploy does

1. **Pulls the release image by digest.** `ghcr.io/michalwy/stamporama:X.Y.Z` is resolved once, and
   from then on only `…@sha256:…` is used. The image must say it is `X.Y.Z` (`STAMPORAMA_VERSION`).
2. **Refuses a downgrade.** When the running version is newer than the release, it does nothing and
   **succeeds** — unless the run was started by hand, which is how a rollback is made.
3. **Dumps the database** with `pg_dump` (custom format) into the backup directory, keeping the
   newest 14 dumps. A failed dump stops the deploy before anything changed.
4. **Runs `docker compose up -d`** in the installation directory, with its own `.env` and compose
   files. Migrations run at container start, as they always have.
5. **Waits for the container's health check** (10 minutes at most). On failure it **rolls back to the
   previous image** and the run fails. **Migrations are not rolled back** — see
   [Restoring a dump](#restoring-a-dump).

After a healthy start it writes `TAG="X.Y.Z@sha256:…"` into `.env` — the only key it ever writes — so
that a `docker compose up -d` you run by hand later starts the same image. It also removes the
repository's unused app images, keeping the running one and the one a rollback would use.

The run's summary in the Actions tab says which of these happened: *Deployed*, *Already running*,
*Skipped* (a downgrade), *Rolled back* or *Failed*.

**The run's log is public**, like every Actions log of a public repository. The script never prints
`.env`, the database address, paths on the Pi or the application's logs; when something fails it
says where on the Pi to look.

## One-time setup

### 1. A runner for this repository on the Pi

The Pi already runs a runner for another repository; this is a **second runner instance**, in its own
directory, registered to `michalwy/stamporama` only.

1. On GitHub: **Settings → Actions → Runners → New self-hosted runner**, Linux, ARM64. Keep the page
   open for its download URL and registration token.
2. On the Pi, as the user the runner will run as:

   ```bash
   mkdir ~/actions-runner-stamporama && cd ~/actions-runner-stamporama
   # download and unpack the archive exactly as the GitHub page shows, then:
   ./config.sh --url https://github.com/michalwy/stamporama --token <token from the page> \
     --name pi-stamporama --labels pi,stamporama --work _work --unattended
   sudo ./svc.sh install "$USER"
   sudo ./svc.sh start
   ```

   `self-hosted`, `Linux` and `ARM64` are added automatically, so the runner carries
   `self-hosted,pi,stamporama` — the labels `deploy.yml` asks for.
3. That user must be able to run `docker` without `sudo` (`sudo usermod -aG docker "$USER"`, then
   restart the service) and to **read and write** the installation directory and its `.env`.
4. The runner's environment must **not** set `COMPOSE_PROJECT_NAME` or `COMPOSE_FILE`; the deploy
   takes both from the installation, and refuses when the project name would differ.

The runner shows as *Idle* under **Settings → Actions → Runners** when it is ready.

### 2. The `prod` environment

**Settings → Environments → New environment**, named `prod`:

- **Deployment branches and tags → Selected branches and tags**: add the branch `main` and the tag
  pattern `v*`. A published release runs on its tag; a manual run on `main`. Nothing else can use
  the environment.
- **Environment variables**:

  | Variable | Required | Value |
  | --- | --- | --- |
  | `STAMPORAMA_DIR` | yes | Absolute path of the installation directory on the Pi — the one holding `.env` and `docker-compose.prod.yml` |
  | `STAMPORAMA_BACKUP_DIR` | no | Where dumps go; default `<STAMPORAMA_DIR>/backups` |
  | `STAMPORAMA_BACKUP_KEEP` | no | How many dumps are kept; default `14` |

No secret is needed: the configuration stays in the installation's `.env`, and the image on GHCR is
public. (If the package is ever made private, run `docker login ghcr.io` once on the Pi as the
runner's user.)

### 3. Fork pull requests need approval

**Settings → Actions → General → Approval for running fork pull request workflows from
contributors**: choose **Require approval for all external contributors**. Agents never approve a
fork's workflow run.

Why it matters even though only `deploy.yml` may use the Pi's runner: a self-hosted runner runs
whatever the job's commit says, and this repository is public. CI enforces the other half —
`scripts/check-self-hosted-runners.mjs`, run in the required `Unit tests` check, fails when any
workflow other than `deploy.yml` could reach a self-hosted runner.

### 4. Turn Watchtower off — just before the first deploy

Watchtower and this workflow would fight over the container, so `scripts/deploy.sh` refuses to run
while Watchtower is switched on for the installation. Turn it off **before the tag of the first
release made after this setup is pushed** — the tag's own CI run moves `latest`, and Watchtower
would deploy that before the Release does.

In the installation directory:

```bash
sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=""/' .env
project="$(docker compose config | sed -n 's/^name: *//p')"
docker rm -f $(docker ps -aq --filter "label=com.docker.compose.project=$project" \
  --filter label=com.docker.compose.service=watchtower)
docker compose ps -a    # only the app is left
```

(The container is found by its labels because a compose file from #2690 on has no `watchtower`
service for `docker compose rm` to name. `docker rm` complaining that it needs an argument means
there was no Watchtower container left.)

Both lines are needed: clearing the profile alone leaves the running Watchtower container in place,
and the deploy refuses while it runs. Since #2690 the app container no longer carries the
`com.centurylinklabs.watchtower.enable` label, so a Watchtower kept elsewhere on the Pi for other
applications leaves it alone in label mode — but one that watches *all* containers would still
update it, so make sure none does. Do not schedule `scripts/update.sh` on the Pi either: this
workflow is its updater.

## The first deploy, and how to check it

The first deploy is the next release: the release procedure
([`release-versioning.md`](../agents/release-versioning.md)) publishes a GitHub Release, and that
starts **Deploy** in the Actions tab. To try the setup before then, start a manual run with the
version that is already running — it pulls, finds the same image, writes `TAG` into `.env` and
reports *Already running* without touching the container.

Then check:

1. **Actions → Deploy**: the run is green and its summary says *Deployed* with the version.
2. On the Pi, in the installation directory:

   ```bash
   docker compose ps                    # app: running (healthy), image …:X.Y.Z@sha256:…
   grep '^TAG=' .env                    # TAG="X.Y.Z@sha256:…"
   ls -l backups/                       # stamporama-<UTC time>-before-X.Y.Z.dump
   docker run --rm -i postgres:18-alpine pg_restore --list < backups/<that file> | head
   docker volume ls | grep stamporama-data   # the same photo volume as before, no new one
   ```

3. In the app, the version shown in the sidebar is `X.Y.Z`, and photos still load.

## Rolling back

**Actions → Deploy → Run workflow**, branch `main`, and the version to go back to. A manual run is
allowed past the no-downgrade guard; it takes a dump first like any other deploy.

The older release then runs on a database that **still has the newer release's migrations**. Most
migrations only add things and an older release ignores them; when one changed or removed something
the older code needs, restore the dump taken before the bad release instead (next section).

When a release fails its health check the deploy rolls back to the previous image **by itself**, and
the run fails so it is seen; the same caveat about migrations applies.

## Restoring a dump

A dump is named after the release it was taken **before**: `stamporama-…-before-1.4.0.dump` holds the
database as the previous release left it. Restore it, then run that previous release.

In the installation directory:

```bash
docker compose stop app

# The connection string is DATABASE_URL from .env without Prisma's own parameters
# (?schema=…, &connection_limit=…), which psql does not accept.
PGURL='postgresql://<user>:<password>@<host>:<port>/<database>'
# Where the database is reached from: the shared network when COMPOSE_FILE includes
# docker-compose.network.yml (STAMPORAMA_DB_NETWORK, default "stamporama"), otherwise "host".
NET=stamporama

# 1. Empty the schema (this is the step that throws away what the newer release migrated).
docker run --rm -e PGURL="$PGURL" --network "$NET" postgres:18-alpine \
  sh -c 'psql -v ON_ERROR_STOP=1 --single-transaction --dbname="$PGURL" -c "DROP SCHEMA public CASCADE" -c "CREATE SCHEMA public"'

# 2. Restore the dump into it.
docker run --rm -i -e PGURL="$PGURL" --network "$NET" postgres:18-alpine \
  sh -c 'pg_restore --no-owner --single-transaction --exit-on-error --dbname="$PGURL"' \
  < backups/stamporama-<time>-before-<bad version>.dump
```

Then **Actions → Deploy → Run workflow** with the release that ran before the bad one. (Starting the
app first with `docker compose start app` would start the newer image again, and it would migrate the
restored database straight back.)

Both commands were run against a throwaway installation in #2689. Photos are not in the dump; they
live in the `stamporama-data` volume (or in Google Cloud Storage) and a deploy does not touch them.

## When a run goes wrong

| What the run says | What it means | What to do |
| --- | --- | --- |
| Queued, never starts | The Pi's runner is offline | Start it (`sudo ./svc.sh start` in its directory). A queued job waits up to 24 hours. |
| *Watchtower is still switched on* / *still running* | Step 4 of the setup was not done | Do it, then re-run the job. |
| *Compose project mismatch* | The deploy would have used another project name — and an empty photo volume | Check `STAMPORAMA_DIR` and that the runner's environment sets no `COMPOSE_PROJECT_NAME`. Nothing was changed. |
| *pg_dump failed* | The database was unreachable, or its major is newer than the client's | Read `last-dump-error.log` in the backup directory. Nothing was deployed. |
| *Skipped* | A release older than the running one was published | Nothing to do; a manual run deploys it if that was meant. |
| *Rolled back* | The release did not become healthy; the previous image runs again | Read `docker compose logs app` on the Pi. Decide whether to restore the dump. |
| *Failed* after a failed health check | The rollback did not become healthy either, or there was nothing to roll back to | The instance is down. Read the logs, restore the dump, and deploy a release that worked. |

## Settings the script reads

Set in the `prod` environment's variables (above), or in the shell when running
`scripts/deploy.sh` by hand on the Pi:

| Variable | Default | Meaning |
| --- | --- | --- |
| `STAMPORAMA_DIR` | — (required) | The installation directory |
| `STAMPORAMA_BACKUP_DIR` | `$STAMPORAMA_DIR/backups` | Where dumps go (created `0700`) |
| `STAMPORAMA_BACKUP_KEEP` | `14` | Dumps kept |
| `STAMPORAMA_PG_CLIENT_IMAGE` | `postgres:18-alpine` | Image providing `pg_dump`; its major must be at least the server's |
| `STAMPORAMA_HEALTH_TIMEOUT` | `600` | Seconds to wait for a healthy container |
| `STAMPORAMA_IMAGE` | `ghcr.io/michalwy/stamporama` | Image repository (the compose file names the same one) |

By hand: `STAMPORAMA_DIR=$PWD bash scripts/deploy.sh --version X.Y.Z [--allow-downgrade]`.
