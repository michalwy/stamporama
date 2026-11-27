# The administrator's panel

`/admin` (#2719): the instance as a whole — accounts, collections, storage, deletion, the
registration switch. Read this before touching `src/lib/admin*.ts`, `src/app/admin/` or
`Storage.usage` / `Storage.deletePrefix`.

- **An administrator is an account whose email is listed in `ADMIN_EMAILS`** (#2729, the owner,
  2026-11-27: "W darkroom albo project 101 wskazujemy chyba w env adres email admina" — named in the
  configuration, as in his other projects). Comma-separated, each entry trimmed and lower-cased
  (`parseAdminEmails` / `isAdminEmail` in `admin-rules.ts`, unit-tested); the account's email is
  compared the same way. **Unset or empty is nobody.** Being the first or the oldest account means
  nothing: first-account auto-admin (`claimFirstAdmin`, #2719) is gone. `emailVerified` is not
  required — the instance never verifies an address, so every account's is `false`; emails are
  unique, and registration is closed by default (#2713), so the listed address belongs to whoever
  holds that account. `isAdmin()` reads the variable on every call, nothing is cached. The panel
  does not grant or revoke administrators. **`user.isAdmin` is no longer read or written**; the
  column stays only because dropping it would be a destructive migration. On the owner's Pi the
  variable comes from the `prod` environment with each deploy
  ([`platform-deployment.md`](platform-deployment.md)).
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
  **They are measured apart from the list** (#2731): measuring walks every stored file and took
  seconds on the owner's Pi with one account and three collections, while the page waited for it
  before drawing anything. `getAdminOverview` reads the database only; `getAdminStorage` measures
  every collection at once and the page passes it **un-awaited** to `AdminPanel`, which shows
  *measuring…* until the streamed promise settles. The filesystem walk stats a directory's entries
  concurrently, and the GCS listing asks for `items(name,size)` only.
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
- **In the integration suite, one fact is instance-wide** and the shared database (#2199) makes it
  everybody's: the one `instance_settings` row, which only `admin.test.ts` writes and removes.
  Administrators are per process: a test file that needs one sets `process.env.ADMIN_EMAILS` to its
  own account's email before it asks (each file runs in its own process).
- **The panel also lists the feedback reports** (#2720) under the accounts — `FeedbackSection`, the newest 200 with status chips, a report opening in a two-column dialog with its context and the three fields an administrator sets. The rules are in [`feedback.md`](feedback.md).
