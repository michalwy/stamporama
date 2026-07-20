# ADR-0011: Photo Storage Interface

## Status

Accepted

## Context

Collectors want photos of their copies — most usefully during purchase-order intake,
when physical stamps are received and photographed as they are identified into lots
(#112). Each `Item` gets front/back reserved slots plus unlimited titled extras.
Storing image bytes raises a question the rest of the data model has not: **where do
the bytes live, and how are they served?**

The app is self-hosted (a single container plus an external Postgres). The obvious
first home for bytes is the local filesystem on a mounted volume. But the roadmap
(#138) plans a move to cloud object storage (**GCS**) for deployments that want it,
and #137 extends photos to the catalog level (`Stamp`). We do not want the GCS move to
force a data migration, rewrite every caller, or change the database schema. This ADR
fixes the storage seam now so the GCS binding is later purely additive.

## Decisions

### 1. A storage interface, filesystem-first

Photo bytes sit behind a `Storage` interface (`src/lib/storage/`) with
`put` / `get` / `delete` / `move` / `resolveUrl`. The only implementation in this issue
is `FilesystemStorage`, rooted at a configurable data directory
(`STAMPORAMA_DATA_DIR`, default `/data` in the container, `./.data` in dev). A future
`GcsStorage` is a drop-in second binding that does not touch callers.

Two seams are locked in so that GCS binding is additive, not a rewrite:

#### Seam 1 — async + streaming

Every method is `async` and works in terms of streams, never assuming an object fits
in a `Buffer`. The filesystem binding streams bytes to and from disk; the GCS binding
will stream to and from the network. No caller reads a whole image into memory.

#### Seam 2 — serving contract supports redirect, not just proxy

`resolveUrl` returns a **discriminated result**:

- `{ kind: "stream", object }` — the app must stream the bytes itself. The filesystem
  binding returns this; the collection-scoped serving route pipes the bytes through.
- `{ kind: "redirect", url }` — the app should send the client to a pre-authorized URL.
  A future GCS binding mints a short-lived **signed URL** so bytes bypass the app
  entirely.

The serving route handles both shapes. With signed URLs the collection-scoped auth
check runs when the URL is minted (short TTL), preserving the same authorization model.

### 2. Write-one, read-many

Every photo row records a `storageBackend` (`filesystem` today, defaulted). **Writes**
always target the single active/configured backend (`getActiveStorage`). **Reads**
dispatch per-photo by the recorded `storageBackend` (`getStorage`). So when GCS lands,
new photos write to GCS while existing photos keep streaming from the filesystem — no
forced migration, and photos on different backends coexist indefinitely.

### 3. Variant addressing

`sharp` produces two derivatives eagerly at upload time: a **full** copy downscaled to
2500px on the longest edge, and a **320px thumbnail**. Both are written up front (the
image is already decoded for the downscale, so the second derivative is nearly free)
which keeps the serving route a dumb byte stream. A photo/upload row persists a
`storageKey` **prefix**; the two variants hang under it as `<prefix>/{full,thumb}.<ext>`.
Permanent keys are `<collectionId>/<photoId>/…`; staging keys are `staging/<uploadId>/…`.
Changing the thumbnail dimensions later requires a one-off backfill script.

### 4. Eager, staged uploads with a change-set applied on Save

On drop, a file uploads immediately to a **staging area**: `sharp` runs, bytes are
written under a staging key, and a `PhotoUpload` row records the pending bytes — before
any `Photo` row exists. The dialog holds a pending **change-set** (staged uploads to
add, plus removals / role changes / reorders of committed photos) and applies it in one
logical action on Save: `Photo` rows are created from staged uploads (bytes moved to the
permanent key), removals/reorders applied. **Cancel** is a true discard — staged uploads
are simply left unreferenced, and no draft `Item` row is ever created.

### 5. Cleanup is explicit; nothing is orphaned

- **Byte cleanup on delete** — Prisma cascade removes `Photo` rows but not files.
  Deleting a photo deletes its `full` + `thumb` bytes; deleting an `Item` deletes all
  its photos' bytes first.
- **Orphan GC** — an hourly, idempotent in-process sweep (started from
  `instrumentation.ts` `register()`) deletes `PhotoUpload` rows older than a TTL
  (`STAMPORAMA_PHOTO_UPLOAD_TTL_HOURS`, default 3h) and their bytes. This is the only
  cleanup path for abandoned drops. No separate compose service — it reuses the app's DB
  and storage clients, so `docker-compose.prod.yml` stays untouched.

### 6. Owner-agnostic by design

The `Photo` model, storage interface, `sharp` processing, serving route, and upload UX
are built owner-agnostic so #137 can add a second owner (`stampId`) — making `Photo`
polymorphic — without reworking callers. The staging mechanism is likewise owner-agnostic
and is reused for stamp uploads.

**Realised in #137.** `Photo.itemId` became nullable and a nullable `stampId` was added, with
a DB `CHECK ((itemId IS NOT NULL) <> (stampId IS NOT NULL))` enforcing exactly one owner. The
old plain `(itemId, role)` unique was replaced by two *partial* unique indexes
(`WHERE itemId IS NOT NULL` / `WHERE stampId IS NOT NULL`) so each reserved role stays a
singleton per owner (a plain unique would let every stamp photo collide on `(NULL, ...)`).
Which slots an owner uses is a UI concern — copies use `front`/`back`, stamps use a single
`main`. The change-set apply / list / byte-cleanup logic is written once over a `PhotoOwner` and exposed
through per-owner wrappers. A copy photo can also be **promoted** to its stamp: the bytes are
duplicated to a fresh permanent key and an independent `Photo` row is created on the `Stamp`,
so the copy and stamp photos have fully independent lifecycles.

## Consequences

- Self-hosted deployments must mount a writable volume at `STAMPORAMA_DATA_DIR`
  (documented in `docker-compose.prod.yml` and the installer). Losing that volume loses
  the images; operators should back it up alongside the database.
- The upload transport is a **route handler** (`api/collections/[collectionId]/photos/…`),
  not a server action, consistent with the app's existing binary/multipart boundaries;
  `src/app/actions/` stays JSON-shaped.
- Adding GCS (#138) is a new `Storage` implementation plus a registry entry and a config
  switch for the active write backend — no schema change, no data migration, no caller
  edits.
