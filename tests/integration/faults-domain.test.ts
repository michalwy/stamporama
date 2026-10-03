import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prisma } from "../../src/lib/db";
import {
  DEFAULT_FAULTS,
  FaultInUseError,
  FaultNameTakenError,
  createFault,
  deleteFault,
  getFaults,
  listFaults,
  reorderFaults,
  setItemFaultEntries,
  setItemFaults,
  updateFault,
} from "../../src/lib/faults";
import { createCollection } from "../../src/lib/collections";
import { countItems, getItemListItem } from "../../src/lib/items";
import { bulkUpdateLotItems, createLot, intakeStamps } from "../../src/lib/lots";
import { createPurchase, setPurchaseStatus } from "../../src/lib/purchases";
import { NO_FAULTS } from "../../src/lib/fault-filter";

// The fault dictionary and a copy's faults (#1557).
//
// Pinned here is what the schema cannot say: that the seed reaches new collections and, through the
// migration, existing ones, in the same order; that a fault in use is **refused** on delete with the
// count, although the database cascades at both ends (a RESTRICT would make a collection with faulted
// copies undeletable — the last case checks that it is not); that the dialog *replaces* a copy's set
// while the bulk pass adds and removes; and that the filter reads *any of these* and *no faults*.

const ts = Date.now();

async function createUser(suffix: string): Promise<string> {
  const id = `test-user-faults-${suffix}-${ts}`;
  await prisma.user.create({
    data: {
      id,
      name: "Faults",
      email: `test-faults-${suffix}-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return id;
}

async function dropUser(userId: string): Promise<void> {
  await prisma.collection.deleteMany({ where: { ownerId: userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("the fault dictionary (#1557)", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    userId = await createUser("dict");
    collectionId = (await createCollection(userId, `Faults dict ${ts}`, "EUR")).id;
  });

  after(() => dropUser(userId));

  it("seeds a new collection with the common faults, in order", async () => {
    const faults = await getFaults(userId, collectionId);
    assert.deepEqual(
      faults.map((f) => f.name),
      [...DEFAULT_FAULTS]
    );
    assert.deepEqual(
      faults.map((f) => f.sortOrder),
      DEFAULT_FAULTS.map((_, i) => i)
    );
    assert.ok(faults.every((f) => f.copyCount === 0 && Object.keys(f.nameByLanguage).length === 0));
  });

  it("creates at the end, with translations, and refuses a duplicate name", async () => {
    await createFault(userId, collectionId, {
      name: "Rounded corner",
      translations: { pl: { name: "Zaokrąglony róg" }, de: { name: null } },
    });
    const faults = await getFaults(userId, collectionId);
    const added = faults.at(-1)!;
    assert.equal(added.name, "Rounded corner");
    assert.equal(added.sortOrder, DEFAULT_FAULTS.length);
    assert.deepEqual(added.nameByLanguage, { pl: "Zaokrąglony róg" });
    await assert.rejects(createFault(userId, collectionId, { name: "Crease" }), FaultNameTakenError);
    await assert.rejects(
      updateFault(userId, added.id, { name: "Stain" }),
      FaultNameTakenError
    );
  });

  it("renames, reorders and deletes an unused fault", async () => {
    const before = await listFaults(userId, collectionId);
    const stain = before.find((f) => f.name === "Stain")!;
    await updateFault(userId, stain.id, { name: "Foxing", translations: { pl: { name: "Plama" } } });
    const reversed = [...before].reverse().map((f) => f.id);
    await reorderFaults(userId, collectionId, reversed);
    assert.deepEqual(
      (await listFaults(userId, collectionId)).map((f) => f.id),
      reversed
    );
    await deleteFault(userId, stain.id);
    assert.ok(!(await listFaults(userId, collectionId)).some((f) => f.id === stain.id));
  });
});

describe("faults on copies (#1557)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let thinId: string;
  let creaseId: string;
  let tearId: string;
  let foreignFaultId: string;

  async function addCopies(count: number): Promise<string[]> {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    await setPurchaseStatus(userId, purchase.id, "arrived");
    const lotId = await createLot(userId, purchase.id, 10);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const [copy] = await intakeStamps(userId, { lotId }, { stampId, conditionId });
      ids.push(copy.itemId);
    }
    return ids;
  }

  async function faultNamesOn(itemId: string): Promise<string[]> {
    return (await getItemListItem(userId, itemId)).faults.map((f) => f.name);
  }

  before(async () => {
    userId = await createUser("copies");
    collectionId = (await createCollection(userId, `Faults copies ${ts}`, "EUR")).id;
    conditionId = (await prisma.stampCondition.findFirstOrThrow({ where: { collectionId } })).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Numeral 5f" } })).id;
    const faults = await listFaults(userId, collectionId);
    thinId = faults.find((f) => f.name === "Thin")!.id;
    creaseId = faults.find((f) => f.name === "Crease")!.id;
    tearId = faults.find((f) => f.name === "Tear")!.id;
    const other = await createCollection(userId, `Faults other ${ts}`, "EUR");
    foreignFaultId = (await listFaults(userId, other.id))[0]!.id;
  });

  after(() => dropUser(userId));

  it("replaces a copy's set from the dialog, in the dictionary's order, creating a typed new one", async () => {
    const [copy] = await addCopies(1);
    await setItemFaultEntries(userId, copy!, [
      { id: tearId, name: "Tear" },
      { id: null, name: "thin" },
      { id: null, name: "Pinhole" },
      { id: foreignFaultId, name: "" },
    ]);
    assert.deepEqual(await faultNamesOn(copy!), ["Thin", "Tear", "Pinhole"]);
    const pinhole = (await getFaults(userId, collectionId)).find((f) => f.name === "Pinhole")!;
    assert.equal(pinhole.sortOrder, DEFAULT_FAULTS.length);
    assert.equal(pinhole.copyCount, 1);

    await setItemFaults(userId, copy!, [creaseId]);
    assert.deepEqual(await faultNamesOn(copy!), ["Crease"]);
    await setItemFaults(userId, copy!, []);
    assert.deepEqual(await faultNamesOn(copy!), []);
  });

  it("adds and removes named faults in bulk, leaving the others alone", async () => {
    const ids = await addCopies(3);
    await setItemFaults(userId, ids[0]!, [creaseId]);
    await bulkUpdateLotItems(userId, ids, { addFaultIds: [thinId, foreignFaultId] });
    assert.deepEqual(await faultNamesOn(ids[0]!), ["Thin", "Crease"]);
    assert.deepEqual(await faultNamesOn(ids[2]!), ["Thin"]);
    await bulkUpdateLotItems(userId, ids, { removeFaultIds: [thinId] });
    assert.deepEqual(await faultNamesOn(ids[0]!), ["Crease"]);
    assert.deepEqual(await faultNamesOn(ids[1]!), []);
  });

  it("filters the Copies list by any of the chosen faults, and by no faults", async () => {
    const [a, b, ab, none] = await addCopies(4);
    await setItemFaults(userId, a!, [thinId]);
    await setItemFaults(userId, b!, [tearId]);
    await setItemFaults(userId, ab!, [thinId, tearId]);
    const scope = { ids: [a!, b!, ab!, none!] };
    const count = (faultIds: string[]) => countItems(userId, collectionId, { ...scope, faultIds });
    assert.equal(await count([]), 4);
    assert.equal(await count([thinId]), 2);
    assert.equal(await count([thinId, tearId]), 3);
    assert.equal(await count([creaseId]), 0);
    assert.equal(await count([NO_FAULTS]), 1);
    assert.equal(await count([NO_FAULTS, tearId]), 3);
  });

  it("refuses to delete a fault in use, naming the count, and deletes it once taken off", async () => {
    const ids = await addCopies(2);
    await bulkUpdateLotItems(userId, ids, { addFaultIds: [creaseId] });
    const inUse = (await getFaults(userId, collectionId)).find((f) => f.id === creaseId)!;
    await assert.rejects(deleteFault(userId, creaseId), (err: unknown) => {
      assert.ok(err instanceof FaultInUseError);
      assert.equal(err.copyCount, inUse.copyCount);
      return true;
    });
    assert.deepEqual(await faultNamesOn(ids[0]!), ["Crease"]);
    await prisma.itemFault.deleteMany({ where: { faultId: creaseId } });
    await deleteFault(userId, creaseId);
    assert.ok(!(await listFaults(userId, collectionId)).some((f) => f.id === creaseId));
  });

  it("does not stop a collection with faulted copies from being deleted", async () => {
    const other = await createCollection(userId, `Faults gone ${ts}`, "EUR");
    const otherStamp = await prisma.stamp.create({ data: { collectionId: other.id, name: "X" } });
    const otherCondition = await prisma.stampCondition.findFirstOrThrow({
      where: { collectionId: other.id },
    });
    const item = await prisma.item.create({
      data: {
        collectionId: other.id,
        itemNo: 1,
        stampId: otherStamp.id,
        conditionId: otherCondition.id,
        stamps: { create: { stampId: otherStamp.id, quantity: 1, sortOrder: 0 } },
      },
    });
    const fault = (await listFaults(userId, other.id))[0]!;
    await setItemFaults(userId, item.id, [fault.id]);
    await prisma.collection.delete({ where: { id: other.id } });
    assert.equal(await prisma.fault.count({ where: { collectionId: other.id } }), 0);
  });
});

// The migration seeds every existing collection with what `seedDefaultFaults` writes into a new one.
// Its statement is unscoped — it ran once over every collection — and every collection this database
// holds already carries the faults, so it is executed here with `"collection"` narrowed to one row
// that has none, the VALUES list and the cross join exactly as written, inside a transaction that is
// rolled back.
const MIGRATION = fileURLToPath(
  new URL("../../prisma/migrations/20261003190000_copy_faults/migration.sql", import.meta.url)
);

class RollbackSignal extends Error {}

describe("20261003190000_copy_faults seed", () => {
  let userId: string;

  before(async () => {
    userId = await createUser("migration");
  });

  after(() => dropUser(userId));

  it("seeds the same faults, in the same order, as a new collection gets", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    const insert = sql.slice(sql.indexOf('INSERT INTO "fault"'));
    assert.ok(insert.startsWith("INSERT"), "the migration's seed statement was not found");
    assert.ok(insert.includes('FROM "collection" c'), "the seed no longer reads the collections");
    const collection = await prisma.collection.create({
      data: { slug: `col-faults-mig-${ts}`, name: "Faults mig", baseCurrency: "EUR", ownerId: userId },
    });
    const scoped = insert.replace(
      'FROM "collection" c',
      `FROM (SELECT * FROM "collection" WHERE "id" = '${collection.id}') c`
    );
    let rows: { name: string; sortOrder: number }[] = [];
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(scoped);
          rows = await tx.fault.findMany({
            where: { collectionId: collection.id },
            orderBy: { sortOrder: "asc" },
            select: { name: true, sortOrder: true },
          });
          throw new RollbackSignal();
        },
        { timeout: 30_000 }
      );
    } catch (err) {
      if (!(err instanceof RollbackSignal)) throw err;
    }
    assert.deepEqual(
      rows,
      DEFAULT_FAULTS.map((name, sortOrder) => ({ name, sortOrder }))
    );
  });
});
