# Upgrading the local Postgres major version

Applies to the **dev and e2e containers only**. Production uses an external database
(`DATABASE_URL`) and is not affected by these steps — upgrading it is the operator's own
procedure.

## Why a version bump breaks the dev stack

Bumping the `postgres:` tag in `docker-compose.yml` does not upgrade the data. Two things bite
at once:

1. **The cluster files stay on the old major version.** A `db_data` volume initialised by
   Postgres 16 cannot be read by Postgres 18. Postgres never upgrades a data directory in place
   on startup.
2. **Postgres 18+ moved the data directory.** These images now store the cluster in
   `/var/lib/postgresql/<major>/docker` rather than `/var/lib/postgresql/data`, so the compose
   mount points at the parent `/var/lib/postgresql`. See
   [docker-library/postgres#1259](https://github.com/docker-library/postgres/pull/1259).

The failure modes differ, and the quiet one is the dangerous one. With the old mount path the
container refuses to start and says so. With the *new* mount path against an *old* volume,
Postgres finds nothing in `18/docker` and initialises a **fresh, empty cluster** beside the old
files — the app comes up looking wiped rather than broken.

`pg_upgrade --link` is not available in place: it needs binaries for both majors in one image,
and the official images ship only one. Dump and restore instead.

## Procedure

Replace `16` with the major version you are leaving and `20260731` with today's date.

**1. Dump the old cluster** using an image matching its version:

```bash
docker compose down && docker run -d --name pgdump -v stamporama_db_data:/var/lib/postgresql/data postgres:16-alpine
```

```bash
mkdir -p .data/backups && docker exec pgdump pg_dumpall -U stamporama --clean --if-exists > .data/backups/pg16-predump-20260731.sql
```

Confirm the dump is complete before going further — one marker per database:

```bash
grep -c 'PostgreSQL database dump complete' .data/backups/pg16-predump-20260731.sql
```

Note a row count too, as a restore check:

```bash
docker exec pgdump psql -U stamporama -d stamporama -Atc 'select count(*) from stamp'
```

**2. Keep a byte-for-byte copy of the volume** as a second safety net, then drop the temporary
container:

```bash
docker volume create stamporama_db_data_pg16_backup && docker run --rm -v stamporama_db_data:/from -v stamporama_db_data_pg16_backup:/to alpine sh -c 'cd /from && cp -a . /to' && docker rm -f pgdump
```

**3. Recreate the volume and start the new major:**

```bash
docker volume rm stamporama_db_data && docker compose up -d db
```

**4. Restore:**

```bash
docker exec -i stamporama-db-1 psql -U stamporama -d postgres -q < .data/backups/pg16-predump-20260731.sql
```

`ERROR: current user cannot be dropped` is expected and harmless — the dump tries to recreate
the role it is connected as.

**5. Verify** the row count matches step 1 and that migrations are intact:

```bash
docker exec stamporama-db-1 psql -U stamporama -d stamporama -Atc 'select count(*) from stamp'
```

```bash
docker exec stamporama-db-1 psql -U stamporama -d stamporama -Atc 'select count(*) from _prisma_migrations where finished_at is null'
```

Once the stack has run happily for a while, reclaim the backup volume with
`docker volume rm stamporama_db_data_pg16_backup`.

## The e2e container

`docker-compose.e2e.yml` has no persistent volume — its cluster is a tmpfs and is thrown away
between runs, so it needs no migration. Its `tmpfs:` path must still track the image's data
directory (`/var/lib/postgresql` for 18+). If the two drift apart the tests still pass, but the
cluster silently lands on the container's writable layer and loses the in-memory speed the
mount exists for. Check with:

```bash
docker exec stamporama-e2e-db-1 df -h /var/lib/postgresql/18/docker
```
