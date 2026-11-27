import "server-only";
import { prisma, type DbTransaction } from "./db";
import { AdminError, assertAdmin } from "./admin-access";
import { getConfiguredStorages } from "./storage";
import {
  isAdminEmail,
  nextDeletionPass,
  sumStorage,
  type CollectionTable,
  type StorageFigure,
} from "./admin-rules";
import {
  getRegistrationSwitch,
  INSTANCE_SETTINGS_ID,
  type RegistrationSwitch,
} from "./registration-server";

// The administrator's panel (#2719): who may open it, what it lists, and the three things it does —
// delete a collection, delete an account, and switch registration. `docs/agents/admin.md` carries
// the reasoning.
//
// **Every function here that reads or changes somebody else's data takes the acting account's id
// and checks it first.** The page and the server actions check too, because that is where a
// redirect belongs, but the rule is here: authorization is server-side and never in a caller.
// Who an administrator is lives in `admin-access.ts`, which `auth.ts` can import without the
// storage layer coming with it.

export { AdminError, assertAdmin, isAdmin } from "./admin-access";

// ── What the panel lists ────────────────────────────────────────────────────────────────────

export interface AdminCollection {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
}

export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  createdAt: Date;
  collections: AdminCollection[];
}

/**
 * Who has an account and which collections — from the database only, so the panel draws at once.
 * The storage figures are measured separately (`getAdminStorage`, #2731).
 */
export interface AdminOverview {
  accounts: AdminAccount[];
  registration: RegistrationSwitch;
}

/** What the instance's collections hold in storage, per collection, per account and in total. */
export interface AdminStorage {
  collections: Record<string, StorageFigure>;
  /** The sum of each account's collections. */
  accounts: Record<string, StorageFigure>;
  /** Every collection on the instance, added up. */
  total: StorageFigure;
}

/**
 * What one collection holds in storage: everything under its prefix, on every backend that may hold
 * bytes. Measured from the backend rather than summed from `sizeBytes` columns — those record one
 * derivative of a photo and not its thumbnail, and a figure about disk should be about disk. A
 * backend that cannot be read counts as nothing rather than failing the whole panel.
 */
export async function collectionStorage(collectionId: string): Promise<StorageFigure> {
  const figures = await Promise.all(
    getConfiguredStorages().map((storage) =>
      storage.usage(collectionId).catch((error) => {
        console.error(`[admin] could not measure ${collectionId} on ${storage.backend}`, error);
        return { bytes: 0, objects: 0 };
      })
    )
  );
  return sumStorage(figures);
}

/** Every account with its collections, oldest account first. Reads the database only. */
export async function getAdminOverview(adminId: string): Promise<AdminOverview> {
  await assertAdmin(adminId);
  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      collections: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, slug: true, name: true, createdAt: true },
      },
    },
  });

  return {
    accounts: users.map((user) => ({ ...user, isAdmin: isAdminEmail(user.email, process.env.ADMIN_EMAILS) })),
    registration: await getRegistrationSwitch(),
  };
}

/**
 * Measure every collection's storage, all collections at once (#2731). Measuring walks every stored
 * file, so it is the slow half of the panel: the page draws the overview first and these figures
 * arrive after it. A collection created or deleted between the two readings is simply absent from
 * one of them.
 */
export async function getAdminStorage(adminId: string): Promise<AdminStorage> {
  await assertAdmin(adminId);
  const users = await prisma.user.findMany({
    select: { id: true, collections: { select: { id: true } } },
  });
  const figures = await Promise.all(
    users.map(async (user) => {
      const perCollection = await Promise.all(
        user.collections.map(async (collection) => [collection.id, await collectionStorage(collection.id)] as const)
      );
      return { userId: user.id, perCollection };
    })
  );

  const collections: Record<string, StorageFigure> = {};
  const accounts: Record<string, StorageFigure> = {};
  for (const { userId, perCollection } of figures) {
    for (const [id, figure] of perCollection) collections[id] = figure;
    accounts[userId] = sumStorage(perCollection.map(([, figure]) => figure));
  }
  return { collections, accounts, total: sumStorage(Object.values(accounts)) };
}

// ── Registration ────────────────────────────────────────────────────────────────────────────

/**
 * Open or close registration of new accounts. From the first call on, this setting decides and
 * `STAMPORAMA_ALLOW_REGISTRATION` is only what stood before it (#2713).
 */
export async function setRegistrationOpen(adminId: string, open: boolean): Promise<RegistrationSwitch> {
  await assertAdmin(adminId);
  await prisma.instanceSettings.upsert({
    where: { id: INSTANCE_SETTINGS_ID },
    create: { id: INSTANCE_SETTINGS_ID, registrationOpen: open },
    update: { registrationOpen: open },
  });
  return getRegistrationSwitch();
}

// ── Deleting ────────────────────────────────────────────────────────────────────────────────

/** Long enough for a large collection; the default five seconds is not. */
const DELETE_TRANSACTION_TIMEOUT_MS = 10 * 60 * 1000;

/** Run one statement inside a savepoint: true when it went through, false when it was refused. */
async function attempt(tx: DbTransaction, run: () => Promise<unknown>): Promise<boolean> {
  await tx.$executeRawUnsafe("SAVEPOINT admin_delete");
  try {
    await run();
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT admin_delete");
    return true;
  } catch {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT admin_delete");
    return false;
  }
}

/** Every table with a cascading foreign key to `collection`, read from the database itself. */
async function collectionTables(tx: DbTransaction): Promise<CollectionTable[]> {
  return tx.$queryRaw<CollectionTable[]>`
    SELECT cl.relname AS "table", att.attname AS "column"
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = '"collection"'::regclass
      AND con.confdeltype = 'c'
      AND array_length(con.conkey, 1) = 1
    ORDER BY cl.relname, att.attname`;
}

/**
 * Delete one collection's rows, all of them, in one transaction.
 *
 * Every table that carries a `collectionId` cascades from `collection`, so in principle this is one
 * `DELETE`. In practice the tables also refer to **each other**, seventy-odd times with
 * `ON DELETE RESTRICT`, and PostgreSQL checks a `RESTRICT` the moment the referenced row goes — so
 * a cascade that reaches a stamp before it has reached the copies of it is refused, in an order
 * nobody chose. So: try the one statement, and if it is refused, empty the collection **table by
 * table**, each in a savepoint, going round again with the tables that were refused until none is
 * left. A table whose rows are still referenced is refused on one pass and goes through on a later
 * one, once what referred to it is gone. The list of tables is read from the database's own
 * constraints, so a table added next month is covered without anyone remembering this function.
 * When a pass gets nowhere the one statement is tried again, and if it is still refused the whole
 * transaction rolls back and nothing is deleted.
 */
async function deleteCollectionRows(tx: DbTransaction, collectionId: string): Promise<void> {
  const whole = () => tx.$executeRaw`DELETE FROM "collection" WHERE "id" = ${collectionId}`;
  if (await attempt(tx, whole)) return;
  const { left } = await emptyCollectionTableByTable(tx, collectionId);
  if (await attempt(tx, whole)) return;
  throw new AdminError(
    "refused",
    `The collection could not be deleted${left.length > 0 ? `: ${left.join(", ")} could not be emptied` : ""}. Nothing was deleted.`
  );
}

/**
 * The second half of the above, on its own so a test can drive it directly: empty every table that
 * hangs off this collection, going round until a pass gets nowhere. Returns how many passes it took
 * and the tables it had to leave — which is not yet a failure: the collection's own row points at
 * rows of its own (its default scanning profile), so that table can only go with the collection,
 * in the statement the caller runs last.
 */
export async function emptyCollectionTableByTable(
  tx: DbTransaction,
  collectionId: string
): Promise<{ passes: number; left: string[] }> {
  let remaining: readonly CollectionTable[] = await collectionTables(tx);
  let passes = 0;
  while (remaining.length > 0) {
    passes += 1;
    const refused: CollectionTable[] = [];
    for (const entry of remaining) {
      // Identifiers come from `pg_constraint`, never from a caller; the value is a parameter.
      const statement = `DELETE FROM "${entry.table}" WHERE "${entry.column}" = $1`;
      if (!(await attempt(tx, () => tx.$executeRawUnsafe(statement, collectionId)))) refused.push(entry);
    }
    const pass = nextDeletionPass(remaining, refused);
    remaining = pass.retry;
    if (pass.stuck) break;
  }
  return { passes, left: remaining.map((entry) => entry.table) };
}

/** Delete a collection's bytes from every backend. Reports instead of throwing: the rows are gone. */
async function deleteCollectionBytes(collectionId: string): Promise<boolean> {
  let clean = true;
  for (const storage of getConfiguredStorages()) {
    try {
      await storage.deletePrefix(collectionId);
    } catch (error) {
      clean = false;
      console.error(`[admin] could not delete the bytes of ${collectionId} on ${storage.backend}`, error);
    }
  }
  return clean;
}

export interface AdminDeletion {
  /** How many collections went. */
  collections: number;
  /** False when some stored bytes could not be removed; the rows are gone either way, and the log
   *  names the collection whose prefix is left behind. */
  bytesDeleted: boolean;
}

/**
 * Delete a collection entirely — its rows, then its stored bytes.
 *
 * Rows first, bytes after the transaction has committed: bytes cannot be rolled back, so they go
 * only once nothing refers to them. If the bytes cannot be removed the rows are still gone and the
 * answer says so.
 */
export async function deleteCollectionAsAdmin(adminId: string, collectionId: string): Promise<AdminDeletion> {
  await assertAdmin(adminId);
  const collection = await prisma.collection.findUnique({ where: { id: collectionId }, select: { id: true } });
  if (!collection) throw new AdminError("not_found", "That collection no longer exists.");

  await prisma.$transaction((tx) => deleteCollectionRows(tx, collectionId), {
    timeout: DELETE_TRANSACTION_TIMEOUT_MS,
  });
  return { collections: 1, bytesDeleted: await deleteCollectionBytes(collectionId) };
}

/**
 * Delete an account entirely: every collection it owns, as above, and then the account with its
 * sessions, sign-in methods, tokens and connected apps. **An administrator cannot delete their own
 * account here** — the panel would be left with nobody able to open it.
 */
export async function deleteAccountAsAdmin(adminId: string, userId: string): Promise<AdminDeletion> {
  await assertAdmin(adminId);
  if (adminId === userId) {
    throw new AdminError("refused", "You cannot delete your own account from the admin panel.");
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, collections: { select: { id: true } } },
  });
  if (!user) throw new AdminError("not_found", "That account no longer exists.");

  const collectionIds = user.collections.map((collection) => collection.id);
  await prisma.$transaction(
    async (tx) => {
      for (const collectionId of collectionIds) await deleteCollectionRows(tx, collectionId);
      await tx.user.delete({ where: { id: userId } });
    },
    { timeout: DELETE_TRANSACTION_TIMEOUT_MS }
  );

  let bytesDeleted = true;
  for (const collectionId of collectionIds) {
    if (!(await deleteCollectionBytes(collectionId))) bytesDeleted = false;
  }
  return { collections: collectionIds.length, bytesDeleted };
}
