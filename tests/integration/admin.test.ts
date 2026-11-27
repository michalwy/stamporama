import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-admin-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;
delete process.env.STAMPORAMA_STORAGE_BACKEND;
delete process.env.STAMPORAMA_GCS_BUCKET;

import { prisma } from "../../src/lib/db";
import { createCollection } from "../../src/lib/collections";
import { getActiveStorage } from "../../src/lib/storage";
import {
  AdminError,
  collectionStorage,
  deleteAccountAsAdmin,
  deleteCollectionAsAdmin,
  emptyCollectionTableByTable,
  getAdminOverview,
  isAdmin,
  setRegistrationOpen,
} from "../../src/lib/admin";
import { claimFirstAdmin } from "../../src/lib/admin-access";
import {
  getRegistrationSwitch,
  INSTANCE_SETTINGS_ID,
  isRegistrationOpen,
} from "../../src/lib/registration-server";

// The administrator's panel (#2719), against a real database and a real disk: who may use it, what
// it measures, and that deleting a collection or an account takes the rows **and** the bytes.
//
// The database is shared with every file running beside this one (#2199), so every assertion is
// about this file's own accounts and collections. Two things here are instance-wide by nature — the
// one `InstanceSettings` row and "is there an administrator at all" — and each is handled where it
// is used.

const RUN = `admin-${Date.now()}`;

async function createUser(suffix: string, admin = false) {
  return prisma.user.create({
    data: {
      id: `test-user-${RUN}-${suffix}`,
      name: `Test ${suffix}`,
      email: `test-${RUN}-${suffix}@example.com`,
      emailVerified: true,
      isAdmin: admin,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function putBytes(collectionId: string, name: string, size: number) {
  await getActiveStorage().put(`${collectionId}/${name}`, Buffer.alloc(size, 1), "image/jpeg", "delivery");
}

async function filesUnder(collectionId: string): Promise<string[]> {
  return readdir(path.join(DATA_DIR, "photos", collectionId), { recursive: true }).catch(() => []);
}

function refused(code: AdminError["code"]) {
  return (error: unknown) => error instanceof AdminError && error.code === code;
}

describe("the administrator's panel", () => {
  let adminId: string;
  let collectorId: string;

  before(async () => {
    adminId = (await createUser("admin", true)).id;
    collectorId = (await createUser("collector")).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { owner: { id: { startsWith: `test-user-${RUN}` } } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: `test-user-${RUN}` } } });
    await prisma.instanceSettings.deleteMany({ where: { id: INSTANCE_SETTINGS_ID } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  describe("who is an administrator", () => {
    it("reads the flag, and an unknown account is not one", async () => {
      assert.equal(await isAdmin(adminId), true);
      assert.equal(await isAdmin(collectorId), false);
      assert.equal(await isAdmin("no-such-account"), false);
    });

    it("refuses every panel function to anyone else", async () => {
      const collection = await createCollection(collectorId, "Refusal", "EUR");
      await assert.rejects(getAdminOverview(collectorId), refused("forbidden"));
      await assert.rejects(setRegistrationOpen(collectorId, true), refused("forbidden"));
      await assert.rejects(deleteCollectionAsAdmin(collectorId, collection.id), refused("forbidden"));
      await assert.rejects(deleteAccountAsAdmin(collectorId, adminId), refused("forbidden"));
      await assert.rejects(getAdminOverview("no-such-account"), refused("forbidden"));
      // Nothing happened: the owner's own collection is still there.
      assert.ok(await prisma.collection.findUnique({ where: { id: collection.id } }));
      assert.ok(await prisma.user.findUnique({ where: { id: adminId } }));
    });

    it("does not promote a new account while an administrator exists", async () => {
      const late = await createUser("late");
      assert.equal(await claimFirstAdmin(late.id), false);
      assert.equal(await isAdmin(late.id), false);
    });

    it("promotes the first account of an instance that has none", async () => {
      // "No administrator anywhere" is a fact about the whole shared database, so it is arranged
      // inside a transaction that is rolled back, on a snapshot other files' commits cannot enter.
      const first = await createUser("first");
      const second = await createUser("second");
      class Rollback extends Error {}
      const seen: boolean[] = [];
      await assert.rejects(
        prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`UPDATE "user" SET "isAdmin" = false WHERE "isAdmin"`;
            seen.push(await claimFirstAdmin(first.id, tx));
            seen.push(await claimFirstAdmin(second.id, tx));
            throw new Rollback();
          },
          { isolationLevel: "RepeatableRead" }
        ),
        Rollback
      );
      assert.deepEqual(seen, [true, false]);
      assert.equal(await isAdmin(first.id), false, "rolled back");
      assert.equal(await isAdmin(adminId), true, "rolled back");
    });
  });

  describe("the registration switch", () => {
    it("follows the environment until it is set, then the setting, without a restart", async () => {
      const saved = process.env.STAMPORAMA_ALLOW_REGISTRATION;
      try {
        await prisma.instanceSettings.deleteMany({ where: { id: INSTANCE_SETTINGS_ID } });

        delete process.env.STAMPORAMA_ALLOW_REGISTRATION;
        assert.deepEqual(await getRegistrationSwitch(), { open: false, source: "environment", envDefault: false });
        // Accounts exist (this file's own), so the empty-instance rule does not open it.
        assert.equal(await isRegistrationOpen(), false);

        process.env.STAMPORAMA_ALLOW_REGISTRATION = "true";
        assert.deepEqual(await getRegistrationSwitch(), { open: true, source: "environment", envDefault: true });
        assert.equal(await isRegistrationOpen(), true);

        // The administrator closes it: the environment still says open and no longer decides.
        assert.deepEqual(await setRegistrationOpen(adminId, false), { open: false, source: "admin", envDefault: true });
        assert.equal(await isRegistrationOpen(), false);

        delete process.env.STAMPORAMA_ALLOW_REGISTRATION;
        assert.deepEqual(await setRegistrationOpen(adminId, true), { open: true, source: "admin", envDefault: false });
        assert.equal(await isRegistrationOpen(), true);
      } finally {
        if (saved === undefined) delete process.env.STAMPORAMA_ALLOW_REGISTRATION;
        else process.env.STAMPORAMA_ALLOW_REGISTRATION = saved;
        await prisma.instanceSettings.deleteMany({ where: { id: INSTANCE_SETTINGS_ID } });
      }
    });
  });

  describe("storage", () => {
    it("measures a collection from the disk, and not its neighbour's", async () => {
      const owner = await createUser("storage");
      const one = await createCollection(owner.id, "One", "EUR");
      const two = await createCollection(owner.id, "Two", "EUR");
      await putBytes(one.id, "photo-1/full.jpg", 1000);
      await putBytes(one.id, "photo-1/thumb.jpg", 100);
      await putBytes(one.id, "sheets/sheet-1/original.jpg", 5000);
      await putBytes(two.id, "photo-2/full.jpg", 7);

      assert.deepEqual(await collectionStorage(one.id), { bytes: 6100, objects: 3 });
      assert.deepEqual(await collectionStorage(two.id), { bytes: 7, objects: 1 });
      assert.deepEqual(await collectionStorage("nothing-stored-here"), { bytes: 0, objects: 0 });

      const overview = await getAdminOverview(adminId);
      const account = overview.accounts.find((entry) => entry.id === owner.id);
      assert.ok(account);
      assert.equal(account.email, owner.email);
      assert.deepEqual(
        account.collections.map((entry) => [entry.name, entry.storage]),
        [
          ["One", { bytes: 6100, objects: 3 }],
          ["Two", { bytes: 7, objects: 1 }],
        ]
      );
      assert.deepEqual(account.storage, { bytes: 6107, objects: 4 });
      assert.ok(overview.storage.bytes >= 6107);
      assert.ok(overview.accounts.some((entry) => entry.id === adminId && entry.isAdmin));
    });

    it("refuses an empty prefix, which would be every collection at once", async () => {
      await assert.rejects(getActiveStorage().usage(""), /prefix/);
      await assert.rejects(getActiveStorage().deletePrefix(""), /prefix/);
      await assert.rejects(getActiveStorage().deletePrefix("."), /prefix/);
    });
  });

  describe("deleting a collection", () => {
    it("takes every row and every byte of a full collection, and leaves the neighbour alone", async () => {
      const owner = await createUser("delete-collection");
      const doomed = await createCollection(owner.id, "Doomed", "EUR", { seedDemo: true });
      const kept = await createCollection(owner.id, "Kept", "EUR", { seedDemo: true });
      await putBytes(doomed.id, "photo-1/full.jpg", 300);
      await putBytes(kept.id, "photo-1/full.jpg", 300);
      assert.ok((await prisma.stamp.count({ where: { collectionId: doomed.id } })) > 0, "the demo data is there");
      const keptStamps = await prisma.stamp.count({ where: { collectionId: kept.id } });
      const keptItems = await prisma.item.count({ where: { collectionId: kept.id } });

      assert.deepEqual(await deleteCollectionAsAdmin(adminId, doomed.id), { collections: 1, bytesDeleted: true });

      assert.equal(await prisma.collection.findUnique({ where: { id: doomed.id } }), null);
      assert.equal(await prisma.stamp.count({ where: { collectionId: doomed.id } }), 0);
      assert.equal(await prisma.item.count({ where: { collectionId: doomed.id } }), 0);
      assert.equal(await prisma.platform.count({ where: { collectionId: doomed.id } }), 0);
      assert.deepEqual(await filesUnder(doomed.id), []);

      assert.equal(await prisma.stamp.count({ where: { collectionId: kept.id } }), keptStamps);
      assert.equal(await prisma.item.count({ where: { collectionId: kept.id } }), keptItems);
      assert.deepEqual(await collectionStorage(kept.id), { bytes: 300, objects: 1 });
      assert.ok(await prisma.user.findUnique({ where: { id: owner.id } }), "the account stays");
    });

    it("empties a collection table by table when the one statement is refused", async () => {
      // The fallback, driven directly: the tables refer to each other with ON DELETE RESTRICT, so
      // going through them in name order is refused on some and has to come round again.
      const owner = await createUser("table-by-table");
      const doomed = await createCollection(owner.id, "Table by table", "EUR", { seedDemo: true });
      assert.ok((await prisma.item.count({ where: { collectionId: doomed.id } })) > 0);

      const { passes, left } = await prisma.$transaction(
        (tx) => emptyCollectionTableByTable(tx, doomed.id),
        { timeout: 120_000 }
      );

      assert.ok(passes > 1, `a refused table came round again (${passes} passes)`);
      // What the collection's own row points at can only go with the collection.
      assert.deepEqual(left, ["scanning_profile"]);
      assert.equal(await prisma.stamp.count({ where: { collectionId: doomed.id } }), 0);
      assert.equal(await prisma.item.count({ where: { collectionId: doomed.id } }), 0);
      assert.equal(await prisma.issue.count({ where: { collectionId: doomed.id } }), 0);
      assert.equal(await prisma.platform.count({ where: { collectionId: doomed.id } }), 0);
      // The collection's own row is the caller's to delete, and now nothing refuses it.
      await prisma.collection.delete({ where: { id: doomed.id } });
      assert.equal(await prisma.scanningProfile.count({ where: { collectionId: doomed.id } }), 0);
    });

    it("says so when the collection is already gone", async () => {
      await assert.rejects(deleteCollectionAsAdmin(adminId, "no-such-collection"), refused("not_found"));
    });
  });

  describe("deleting an account", () => {
    it("takes the account, its collections, its sessions and its bytes", async () => {
      const owner = await createUser("delete-account");
      const first = await createCollection(owner.id, "First", "EUR", { seedDemo: true });
      const second = await createCollection(owner.id, "Second", "EUR");
      await putBytes(first.id, "photo-1/full.jpg", 10);
      await putBytes(second.id, "photo-1/full.jpg", 10);
      await prisma.session.create({
        data: {
          id: `session-${RUN}`,
          token: `token-${RUN}`,
          userId: owner.id,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      assert.deepEqual(await deleteAccountAsAdmin(adminId, owner.id), { collections: 2, bytesDeleted: true });

      assert.equal(await prisma.user.findUnique({ where: { id: owner.id } }), null);
      assert.equal(await prisma.collection.count({ where: { ownerId: owner.id } }), 0);
      assert.equal(await prisma.session.count({ where: { userId: owner.id } }), 0);
      assert.equal(await prisma.stamp.count({ where: { collectionId: first.id } }), 0);
      assert.deepEqual(await filesUnder(first.id), []);
      assert.deepEqual(await filesUnder(second.id), []);
    });

    it("refuses an administrator's own account, and one that does not exist", async () => {
      await assert.rejects(deleteAccountAsAdmin(adminId, adminId), refused("refused"));
      assert.ok(await prisma.user.findUnique({ where: { id: adminId } }));
      await assert.rejects(deleteAccountAsAdmin(adminId, "no-such-account"), refused("not_found"));
    });
  });
});
