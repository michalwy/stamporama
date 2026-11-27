# The administrator's panel

`/admin` (#2719): the instance as a whole — accounts, collections, storage, deletion, the
registration switch. Read this before touching `src/lib/admin*.ts`, `src/app/admin/` or
`Storage.usage` / `Storage.deletePrefix`.

- **An administrator is `user.isAdmin`, and there are exactly two ways to become one.** The migration
  (`20261127190000_admin_panel`) gave the flag to the **oldest account** of an existing instance; the
  **first account of an instance that has no administrator** gets it when it is created
  (`claimFirstAdmin`, one `UPDATE … WHERE NOT EXISTS`, called from Better Auth's
  `databaseHooks.user.create.after` in `auth.ts`). The panel does not grant or revoke the flag; a
  self-hoster who needs to move it does so in SQL. Better Auth neither reads nor writes the column.
- **Authorization is in `src/lib/`, not in the page.** Every function in `admin.ts` that reads or
  changes anything takes the acting account's id and calls `assertAdmin` first. The page answers a
  non-administrator with `notFound()` and the server actions (`actions/admin.ts`) resolve their own
  session — a server action is a public endpoint whatever screen calls it. `admin-access.ts` is the
  small module `auth.ts`, the collections page and (since #2720) `route-auth.ts` import, so asking
  *is this an administrator* does not pull in the storage layer.
- **The panel shows that a collection exists and how large it is, never what is in it.** It links
  into nobody's collection and reads no collection data beyond name, slug and dates.
- **Storage is measured from the backend, not summed from `sizeBytes` columns.** `Storage.usage(prefix)`
  walks everything under `<collectionId>/` — photos with both derivatives, scan sheets, ornaments,
  album pictures, attachments — on every binding `getConfiguredStorages()` names (the filesystem
  always; GCS when it is the active backend or a bucket is configured), because writes go to one
  backend and reads follow each object's recorded one. **A prefix is a whole path segment** and an
  empty one is refused: it would be every collection at once. Staging uploads (`staging/…`) belong to
  no collection and are not counted. The figures are read when the page is opened; nothing is cached.
- **Deleting a collection is one `DELETE` that PostgreSQL may refuse, so there is a second way.**
  Every table carrying `collectionId` cascades from `collection`, but the tables also refer to each
  other, seventy-odd times with `ON DELETE RESTRICT`, and a `RESTRICT` is checked the moment the
  referenced row goes — in an order nobody chose. `deleteCollectionRows` tries the one statement in
  a savepoint; if it is refused, `emptyCollectionTableByTable` empties the tables one by one, each in
  a savepoint, coming round again with the refused ones (the list is read from `pg_constraint`, so a
  new table is covered without touching this), and then deletes the collection's row.
  `scanning_profile` is always left for that last statement: the collection's own row points at its
  default profile. If the last statement is still refused, the transaction rolls back and nothing is
  deleted. Demo data goes through the one statement; the fallback is driven directly in
  `tests/integration/admin.test.ts`.
- **Rows first, bytes after the commit.** Bytes cannot be rolled back, so `deletePrefix` runs only
  once nothing refers to them. If it fails the rows are still gone, the action's answer says so
  (`bytesDeleted: false`) and the log names the collection whose prefix was left.
- **This is an administrator's action in the app, not a migration** (the owner, 2026-11-27, #2719):
  the *destructive migration* guardrail is about `prisma/migrations/`, and this adds none.
- **An administrator cannot delete their own account from the panel** — it would leave nobody able
  to open it.
- **The registration switch** is `instance_settings.registrationOpen` (one row, id `instance`): null
  until used, and then it overrides `STAMPORAMA_ALLOW_REGISTRATION` → [`platform-auth.md`](platform-auth.md).
- **In the integration suite, two facts are instance-wide** and the shared database (#2199) makes
  them everybody's: the one `instance_settings` row, which only `admin.test.ts` writes and removes,
  and "no administrator exists", which that file arranges inside a `RepeatableRead` transaction it
  rolls back. A new test that needs an administrator creates its own account with `isAdmin: true`.
