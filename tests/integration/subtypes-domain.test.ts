import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prisma } from "../../src/lib/db";
import {
  getStampSubtypes,
  createStampSubtype,
  updateStampSubtype,
  setSubtypeActsAsVariant,
  setDefaultSubtype,
  deleteStampSubtype,
  reorderStampSubtypes,
  seedDefaultSubtypes,
  DEFAULT_STAMP_SUBTYPES,
  SubtypeInUseError,
  SubtypeIsDefaultError,
} from "../../src/lib/subtypes";
import { createCollection } from "../../src/lib/collections";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-sub-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-sub-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/** Raw collection with no seeded subtypes (bypasses createCollection). */
async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-sub-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

describe("createStampSubtype", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cs-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cs-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("appends subtypes with increasing sortOrder and never as default", async () => {
    await createStampSubtype(userId, collectionId, { name: "Colour variety", actsAsVariant: true });
    await createStampSubtype(userId, collectionId, { name: "Error", actsAsVariant: false });
    const subtypes = await getStampSubtypes(userId, collectionId);
    assert.equal(subtypes.length, 2);
    assert.equal(subtypes[0].name, "Colour variety");
    assert.equal(subtypes[0].actsAsVariant, true);
    assert.equal(subtypes[0].sortOrder, 0);
    assert.equal(subtypes[1].name, "Error");
    assert.equal(subtypes[1].actsAsVariant, false);
    assert.equal(subtypes[1].sortOrder, 1);
    assert.ok(subtypes.every((s) => !s.isDefault));
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => createStampSubtype("wrong-user", collectionId, { name: "X", actsAsVariant: true }),
      /access denied/i
    );
  });
});

describe("updateStampSubtype and setSubtypeActsAsVariant", () => {
  let userId: string;
  let collectionId: string;
  let subtypeId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`us-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `us-${ts}`)).id;
    const s = await prisma.stampSubtype.create({
      data: { collectionId, name: "Paper variety", actsAsVariant: true, isDefault: false, sortOrder: 0 },
    });
    subtypeId = s.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("renames without touching sortOrder or actsAsVariant", async () => {
    await updateStampSubtype(userId, subtypeId, { name: "Watermark variety" });
    const s = await prisma.stampSubtype.findUniqueOrThrow({ where: { id: subtypeId } });
    assert.equal(s.name, "Watermark variety");
    assert.equal(s.actsAsVariant, true);
    assert.equal(s.sortOrder, 0);
  });

  it("flips the actsAsVariant switch", async () => {
    await setSubtypeActsAsVariant(userId, subtypeId, false);
    let s = await prisma.stampSubtype.findUniqueOrThrow({ where: { id: subtypeId } });
    assert.equal(s.actsAsVariant, false);
    await setSubtypeActsAsVariant(userId, subtypeId, true);
    s = await prisma.stampSubtype.findUniqueOrThrow({ where: { id: subtypeId } });
    assert.equal(s.actsAsVariant, true);
  });

  it("throws when subtype does not belong to user", async () => {
    await assert.rejects(
      () => updateStampSubtype("wrong-user", subtypeId, { name: "X" }),
      /access denied/i
    );
  });
});

// Per-language subtype names (#338). The shared blank / delete / untouched rules are unit-tested on
// `syncEntityTranslations`; what matters here is that the subtype's own path wires them to the right
// table and that `getStampSubtypes` reads them back field-by-language.
describe("stamp subtype translations (#338)", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`tr-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `tr-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("stores per-language names on create and reads them back", async () => {
    await createStampSubtype(userId, collectionId, {
      name: "Overprint",
      actsAsVariant: false,
      translations: { pl: { name: "Nadruk" }, de: { name: "Aufdruck" } },
    });
    const [s] = await getStampSubtypes(userId, collectionId);
    assert.equal(s.name, "Overprint");
    assert.deepEqual(s.nameByLanguage, { pl: "Nadruk", de: "Aufdruck" });
  });

  it("rewrites one language and leaves the others alone", async () => {
    const [before] = await getStampSubtypes(userId, collectionId);
    await updateStampSubtype(userId, before.id, {
      name: "Overprint",
      translations: { pl: { name: "Nadrukowany" } },
    });
    const [after] = await getStampSubtypes(userId, collectionId);
    assert.deepEqual(after.nameByLanguage, { pl: "Nadrukowany", de: "Aufdruck" });
  });

  it("drops a language's row when its name is blanked", async () => {
    const [before] = await getStampSubtypes(userId, collectionId);
    await updateStampSubtype(userId, before.id, {
      name: "Overprint",
      translations: { pl: { name: "  " } },
    });
    const [after] = await getStampSubtypes(userId, collectionId);
    assert.deepEqual(after.nameByLanguage, { de: "Aufdruck" });
    assert.equal(
      await prisma.stampSubtypeTranslation.count({
        where: { stampSubtypeId: before.id, language: "pl" },
      }),
      0
    );
  });

  it("cascade-deletes translations with the subtype", async () => {
    const [s] = await getStampSubtypes(userId, collectionId);
    await deleteStampSubtype(userId, s.id);
    assert.equal(
      await prisma.stampSubtypeTranslation.count({ where: { stampSubtypeId: s.id } }),
      0
    );
  });
});

describe("setDefaultSubtype", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`sd-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `sd-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("moves the default and keeps exactly one (radio semantics)", async () => {
    const a = await prisma.stampSubtype.create({
      data: { collectionId, name: "A", actsAsVariant: true, isDefault: true, sortOrder: 0 },
    });
    const b = await prisma.stampSubtype.create({
      data: { collectionId, name: "B", actsAsVariant: true, isDefault: false, sortOrder: 1 },
    });

    await setDefaultSubtype(userId, b.id);

    const subtypes = await getStampSubtypes(userId, collectionId);
    const defaults = subtypes.filter((s) => s.isDefault);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].id, b.id);
    assert.equal(subtypes.find((s) => s.id === a.id)?.isDefault, false);
  });
});

describe("deleteStampSubtype", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`ds-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `ds-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("deletes a non-default, unused subtype", async () => {
    const s = await prisma.stampSubtype.create({
      data: { collectionId, name: "Overprint", actsAsVariant: false, isDefault: false, sortOrder: 5 },
    });
    await deleteStampSubtype(userId, s.id);
    assert.equal(await prisma.stampSubtype.findUnique({ where: { id: s.id } }), null);
  });

  it("refuses to delete the collection default", async () => {
    const s = await prisma.stampSubtype.create({
      data: { collectionId, name: "Default one", actsAsVariant: true, isDefault: true, sortOrder: 6 },
    });
    await assert.rejects(() => deleteStampSubtype(userId, s.id), SubtypeIsDefaultError);
    await prisma.stampSubtype.update({ where: { id: s.id }, data: { isDefault: false } });
    await prisma.stampSubtype.delete({ where: { id: s.id } });
  });

  it("refuses to delete a subtype assigned to a stamp", async () => {
    const s = await prisma.stampSubtype.create({
      data: { collectionId, name: "In use", actsAsVariant: true, isDefault: false, sortOrder: 7 },
    });
    const parent = await prisma.stamp.create({ data: { collectionId, name: "Parent" } });
    const child = await prisma.stamp.create({
      data: { collectionId, parentId: parent.id, subtypeId: s.id, name: "Child" },
    });
    await assert.rejects(() => deleteStampSubtype(userId, s.id), SubtypeInUseError);
    // Cleanup FK before the collection teardown.
    await prisma.stamp.delete({ where: { id: child.id } });
    await prisma.stamp.delete({ where: { id: parent.id } });
    await prisma.stampSubtype.delete({ where: { id: s.id } });
  });

  it("throws when subtype does not belong to user", async () => {
    const s = await prisma.stampSubtype.create({
      data: { collectionId, name: "Other user", actsAsVariant: true, isDefault: false, sortOrder: 8 },
    });
    await assert.rejects(() => deleteStampSubtype("wrong-user", s.id), /access denied/i);
    await prisma.stampSubtype.delete({ where: { id: s.id } });
  });
});

describe("reorderStampSubtypes", () => {
  let userId: string;
  let collectionId: string;
  let ids: string[];

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`rs-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `rs-${ts}`)).id;
    const created = await Promise.all(
      ["A", "B", "C"].map((n, i) =>
        prisma.stampSubtype.create({
          data: { collectionId, name: n, actsAsVariant: true, isDefault: i === 0, sortOrder: i },
        })
      )
    );
    ids = created.map((s) => s.id);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("rewrites sortOrder to match the given order", async () => {
    const reversed = [...ids].reverse();
    await reorderStampSubtypes(userId, collectionId, reversed);
    const subtypes = await getStampSubtypes(userId, collectionId);
    assert.deepEqual(subtypes.map((s) => s.id), reversed);
    assert.deepEqual(subtypes.map((s) => s.sortOrder), [0, 1, 2]);
  });

  it("throws when the id list does not match the collection", async () => {
    await assert.rejects(
      () => reorderStampSubtypes(userId, collectionId, [ids[0], ids[1]]),
      /does not match/i
    );
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => reorderStampSubtypes("wrong-user", collectionId, ids),
      /access denied/i
    );
  });
});

describe("seedDefaultSubtypes via createCollection", () => {
  let userId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`seed-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("seeds the default subtype set on new collections in order with one default", async () => {
    const collection = await createCollection(userId, "Seeded Subtypes", "EUR");
    const subtypes = await getStampSubtypes(userId, collection.id);
    assert.equal(subtypes.length, DEFAULT_STAMP_SUBTYPES.length);
    assert.deepEqual(
      subtypes.map((s) => s.name),
      DEFAULT_STAMP_SUBTYPES.map((s) => s.name)
    );
    assert.deepEqual(
      subtypes.map((s) => s.actsAsVariant),
      DEFAULT_STAMP_SUBTYPES.map((s) => s.actsAsVariant)
    );
    const defaults = subtypes.filter((s) => s.isDefault);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].name, "Variant");
  });

  it("seedDefaultSubtypes inserts directly for a collection", async () => {
    const collection = await createTestCollection(userId, `direct-${Date.now()}`);
    await seedDefaultSubtypes(collection.id, prisma);
    const subtypes = await getStampSubtypes(userId, collection.id);
    assert.equal(subtypes.length, DEFAULT_STAMP_SUBTYPES.length);
    assert.equal(subtypes[0].name, DEFAULT_STAMP_SUBTYPES[0].name);
  });

  it("seeds Forgery last, as a distinct entry and not the default (#1000)", async () => {
    const collection = await createCollection(userId, "Seeded Forgery", "EUR");
    const subtypes = await getStampSubtypes(userId, collection.id);
    const forgery = subtypes.filter((s) => s.name === "Forgery");
    assert.equal(forgery.length, 1);
    assert.equal(forgery[0].actsAsVariant, false, "ADR-0049 §1: a forgery is a distinct entry");
    assert.equal(forgery[0].isDefault, false);
    assert.equal(subtypes[subtypes.length - 1].name, "Forgery");
  });
});

// The `Forgery` row reaches a NEW collection through DEFAULT_STAMP_SUBTYPES above, and an
// EXISTING one through `20260911100000_forgery_subtype`. Only the first of those is
// reachable from the application, and the suite cannot see the second at all the ordinary
// way: `prisma migrate deploy` runs against a fresh database, where no collection predates
// the migration, so every collection this suite creates already carries the row.
//
// So these cases build the pre-migration state by hand — the nine rows
// `20260719100000_add_stamp_subtype` seeded, spelled out here rather than derived from
// DEFAULT_STAMP_SUBTYPES so that the reference value is not a projection of the thing under
// test — and then execute the migration file itself, bytes off disk. Each runs inside a
// transaction that is rolled back, because the statement is deliberately unscoped (it reads
// every row of `collection`) and this database is shared with whatever else is running.
const FORGERY_MIGRATION = fileURLToPath(
  new URL("../../prisma/migrations/20260911100000_forgery_subtype/migration.sql", import.meta.url)
);

/** The nine rows every collection carried before `20260911100000_forgery_subtype`. */
const PRE_FORGERY_SUBTYPES: ReadonlyArray<{ name: string; actsAsVariant: boolean; isDefault: boolean }> = [
  { name: "Variant", actsAsVariant: true, isDefault: true },
  { name: "Colour variety", actsAsVariant: true, isDefault: false },
  { name: "Perforation variety", actsAsVariant: true, isDefault: false },
  { name: "Paper variety", actsAsVariant: true, isDefault: false },
  { name: "Watermark variety", actsAsVariant: true, isDefault: false },
  { name: "Print variety", actsAsVariant: true, isDefault: false },
  { name: "Error", actsAsVariant: false, isDefault: false },
  { name: "Plate flaw", actsAsVariant: false, isDefault: false },
  { name: "Overprint", actsAsVariant: false, isDefault: false },
];

/** Thrown to roll the migration back out of the shared database once it has been read. */
class RollbackSignal extends Error {}

interface SubtypeRow {
  name: string;
  actsAsVariant: boolean;
  isDefault: boolean;
  sortOrder: number;
}

/**
 * Runs `migration.sql` verbatim, returns that collection's rows, and rolls the write back.
 *
 * The `LOCK` is scaffolding around the file rather than part of it, and it is here because
 * the statement reads **every** row of `collection` while the rest of the suite is creating
 * and deleting collections in other processes. Without it the migration's own `SELECT` can
 * read a collection that another test deletes before the `INSERT` reaches its foreign key,
 * which fails with `23503` — observed on the first run of this test. `SHARE` conflicts with
 * `ROW EXCLUSIVE`, so it holds every other writer to that table off for the ~100 ms this
 * transaction lasts, and it is taken first so nothing can be waiting on us when we ask.
 */
async function runForgeryMigration(collectionId: string): Promise<SubtypeRow[]> {
  const sql = await readFile(FORGERY_MIGRATION, "utf8");
  let rows: SubtypeRow[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('LOCK TABLE "collection" IN SHARE MODE');
        await tx.$executeRawUnsafe(sql);
        rows = await tx.stampSubtype.findMany({
          where: { collectionId },
          orderBy: { sortOrder: "asc" },
          select: { name: true, actsAsVariant: true, isDefault: true, sortOrder: true },
        });
        throw new RollbackSignal();
      },
      // The lock may have to wait behind a concurrent writer, so this is not the 5 s default.
      { timeout: 30_000, maxWait: 30_000 }
    );
  } catch (err) {
    if (!(err instanceof RollbackSignal)) throw err;
  }
  return rows;
}

describe("20260911100000_forgery_subtype", () => {
  let userId: string;

  before(async () => {
    userId = (await createTestUser(`mig-${Date.now()}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** A collection as it stood before this migration: the nine rows at sortOrder 0..8. */
  async function preMigrationCollection(suffix: string, extra: { name: string }[] = []) {
    const collection = await createTestCollection(userId, `${suffix}-${Date.now()}`);
    await prisma.stampSubtype.createMany({
      data: [
        ...PRE_FORGERY_SUBTYPES.map((s, i) => ({ collectionId: collection.id, ...s, sortOrder: i })),
        ...extra.map((s, i) => ({
          collectionId: collection.id,
          name: s.name,
          actsAsVariant: false,
          isDefault: false,
          sortOrder: PRE_FORGERY_SUBTYPES.length + i,
        })),
      ],
    });
    return collection.id;
  }

  it("appends Forgery as a distinct entry, after the nine seeded rows", async () => {
    const collectionId = await preMigrationCollection("plain");
    const rows = await runForgeryMigration(collectionId);
    const forgery = rows.filter((r) => r.name === "Forgery");
    assert.equal(forgery.length, 1, "the migration seeds exactly one Forgery row");
    assert.equal(forgery[0].actsAsVariant, false);
    assert.equal(forgery[0].isDefault, false);
    // The TypeScript path derives sortOrder from the array index, so an untouched
    // collection must land on 9 by either route.
    assert.equal(forgery[0].sortOrder, PRE_FORGERY_SUBTYPES.length);
    assert.equal(rows[rows.length - 1].name, "Forgery");
    assert.equal(rows.length, PRE_FORGERY_SUBTYPES.length + 1);
  });

  it("appends after the collector's own rows rather than at a hardcoded 9", async () => {
    // `sortOrder` carries no unique constraint, so a hardcoded 9 would not fail here — it
    // would sort among the collector's rows, silently.
    const collectionId = await preMigrationCollection("appended", [
      { name: "Reprint" },
      { name: "Essay" },
    ]);
    const rows = await runForgeryMigration(collectionId);
    assert.equal(rows[rows.length - 1].name, "Forgery");
    assert.equal(rows[rows.length - 1].sortOrder, PRE_FORGERY_SUBTYPES.length + 2);
  });

  it("leaves a collection that already has a Forgery row alone, whatever its case", async () => {
    // Nothing in the database stops a second row of the same name: the only unique index on
    // this table is the partial one on `isDefault`, and this row is not the default.
    const collectionId = await preMigrationCollection("existing");
    await prisma.stampSubtype.create({
      data: {
        collectionId,
        name: "forgery",
        // The collector's own classification, deliberately the opposite of the seeded row's.
        actsAsVariant: true,
        isDefault: false,
        sortOrder: PRE_FORGERY_SUBTYPES.length,
      },
    });
    const rows = await runForgeryMigration(collectionId);
    const named = rows.filter((r) => r.name.toLowerCase() === "forgery");
    assert.equal(named.length, 1, "no second Forgery row is created");
    assert.equal(named[0].name, "forgery");
    assert.equal(named[0].actsAsVariant, true, "the collector's own flag is not overwritten");
  });
});
