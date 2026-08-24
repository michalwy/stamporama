import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { setColnectListMapping } from "../../src/lib/colnect-list-sync";
import { importColnectListSnapshot } from "../../src/lib/colnect-list-snapshot";
import {
  COLNECT_ADOPT_PASS_SIZE,
  ColnectAdoptError,
  applyColnectAdoption,
  applyColnectAdoptionForRow,
  previewColnectAdoption,
} from "../../src/lib/colnect-list-adopt";

// **Adopting a Colnect wish list into wants (#688).**
//
// What only a database can answer: that a row resolves by `Stamp.colnectId` first and by the
// Assistant's matcher second; that the matcher runs **dry** and leaves no Colnect ID behind; that a
// row resolving to nothing is *counted* rather than dropped or guessed at; that the grade is read
// through the collection's own condition mapping and dropped where two conditions claim it; and
// that a pass is capped while still reporting the whole bucket.

const WISH_LT = 4;
const SWAP_LT = 3;

interface Fixtures {
  userId: string;
  collectionId: string;
  areaId: string;
  vendorId: string;
  mnhId: string;
  usedId: string;
  ctoId: string;
}

let f: Fixtures;

/** One row of a made-up Wish export, in the shape the reader reads. */
interface Row {
  colnectId: string;
  name?: string;
  catalogCodes?: string;
  condition?: string;
}

function exportFile(rows: Row[]): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const stamp = "2026-08-22 10:00:00 GMT+0";
  const lines = [
    `"Stamps on Colnect","List exported on ${stamp}"`,
    `"Launched by collector: ","A Collector [collector]"`,
    `"Collector profile on Colnect at: ",https://colnect.com/en/collectors/collector/collector`,
    `"This list contains ${rows.length} Stamps"`,
    `"For the updated list on Colnect visit: ",https://colnect.com/en/stamps/list/wish/collector`,
    "",
    `Name,Country,"Catalog Codes",Link,List,Quantity,Condition,"Public Note"`,
  ];
  for (const row of rows) {
    lines.push(
      [
        cell(row.name ?? `Colnect ${row.colnectId}`),
        cell("Poland"),
        cell(row.catalogCodes ?? ""),
        `https://colnect.com/stamps/stamp/${row.colnectId}`,
        cell("Wish"),
        cell("[1]"),
        cell(`[${row.condition ?? ""}]`),
        cell(""),
      ].join(",")
    );
  }
  lines.push(`"END of Colnect list launched on ${stamp}"`);
  return lines.join("\n");
}

async function stamp(
  name: string,
  over: { colnectId?: string | null; catalogNumber?: string } = {}
): Promise<string> {
  const created = await prisma.stamp.create({
    data: {
      collectionId: f.collectionId,
      name,
      colnectId: over.colnectId ?? null,
      stampAreaLinks: { create: [{ collectionAreaId: f.areaId, isPrimary: true }] },
      ...(over.catalogNumber
        ? {
            catalogNumbers: {
              create: [{ catalogVendorId: f.vendorId, number: over.catalogNumber }],
            },
          }
        : {}),
    },
  });
  return created.id;
}

async function load(rows: Row[]): Promise<void> {
  await importColnectListSnapshot(f.userId, f.collectionId, {
    lt: WISH_LT,
    fileName: "wish.csv",
    text: exportFile(rows),
  });
}

before(async () => {
  const ts = Date.now();
  const userId = `test-user-colnect-adopt-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User colnect-adopt-${ts}`,
      email: `test-colnect-adopt-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-colnect-adopt-${ts}`,
      name: `Collection colnect-adopt-${ts}`,
      baseCurrency: "EUR",
      ownerId: userId,
    },
  });
  const area = await prisma.collectionArea.create({
    data: { collectionId: collection.id, name: "Poland" },
  });
  const vendor = await prisma.catalogVendor.create({
    data: { collectionId: collection.id, name: "Michel", abbreviation: "Mi" },
  });
  // Michel numbers in Poland carry the "PL" prefix, which is part of the matcher's strict full key.
  await prisma.collectionAreaVendor.create({
    data: { collectionAreaId: area.id, catalogVendorId: vendor.id, areaPrefix: "PL" },
  });
  const mnh = await prisma.stampCondition.create({
    data: {
      collectionId: collection.id,
      name: "Mint never hinged",
      abbreviation: "MNH",
      sortOrder: 0,
    },
  });
  const used = await prisma.stampCondition.create({
    data: { collectionId: collection.id, name: "Used", abbreviation: "U", sortOrder: 1 },
  });
  const cto = await prisma.stampCondition.create({
    data: {
      collectionId: collection.id,
      name: "Cancelled to order",
      abbreviation: "CTO",
      sortOrder: 2,
    },
  });
  await prisma.colnectConditionMapping.create({
    data: { collectionId: collection.id, stampConditionId: mnh.id, colnectValue: "1" },
  });
  await prisma.colnectConditionMapping.create({
    data: { collectionId: collection.id, stampConditionId: used.id, colnectValue: "4" },
  });

  f = {
    userId,
    collectionId: collection.id,
    areaId: area.id,
    vendorId: vendor.id,
    mnhId: mnh.id,
    usedId: used.id,
    ctoId: cto.id,
  };

  await setColnectListMapping(f.userId, f.collectionId, WISH_LT, {
    source: "wants_open",
    sourceOfTruth: "colnect",
    enabled: true,
  });
  await setColnectListMapping(f.userId, f.collectionId, SWAP_LT, {
    source: "items_for_trade",
    sourceOfTruth: "local",
    enabled: true,
  });
});

after(async () => {
  await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
  await prisma.user.deleteMany({ where: { id: f.userId } });
});

beforeEach(async () => {
  await prisma.want.deleteMany({ where: { collectionId: f.collectionId } });
  await prisma.stamp.deleteMany({ where: { collectionId: f.collectionId } });
});

describe("Adopting a wish list into wants (#688)", () => {
  it("adopts by Colnect ID, reading the grade through the collection's own mapping", async () => {
    const known = await stamp("Known here", { colnectId: "3001" });
    await load([{ colnectId: "3001", condition: "U" }]);

    const preview = await previewColnectAdoption(f.userId, f.collectionId, WISH_LT);
    assert.equal(preview.adoptable, 1);
    assert.equal(preview.withCondition, 1);
    assert.equal(preview.created, 0, "a preview writes nothing");
    assert.equal(await prisma.want.count({ where: { collectionId: f.collectionId } }), 0);

    const run = await applyColnectAdoption(f.userId, f.collectionId, WISH_LT);
    assert.equal(run.created, 1);
    const want = await prisma.want.findFirst({
      where: { collectionId: f.collectionId, stampId: known },
      select: { closedAt: true, priority: true, conditions: { select: { conditionId: true } } },
    });
    assert.equal(want?.closedAt, null);
    assert.equal(want?.priority, 1, "the default urgency; the list states none");
    assert.deepEqual(want?.conditions.map((c) => c.conditionId), [f.usedId]);
  });

  it("takes no condition where the row states no grade", async () => {
    await stamp("No grade stated", { colnectId: "3002" });
    await load([{ colnectId: "3002", condition: "" }]);

    const run = await applyColnectAdoption(f.userId, f.collectionId, WISH_LT);
    assert.equal(run.created, 1);
    assert.equal(run.withCondition, 0);
    assert.equal(await prisma.wantCondition.count(), 0, "a want that accepts anything says so");
  });

  it("takes no condition where two of this collection's conditions claim one Colnect grade", async () => {
    await stamp("Ambiguous grade", { colnectId: "3003" });
    await load([{ colnectId: "3003", condition: "MNH" }]);
    await prisma.colnectConditionMapping.create({
      data: { collectionId: f.collectionId, stampConditionId: f.ctoId, colnectValue: "1" },
    });
    try {
      const run = await applyColnectAdoption(f.userId, f.collectionId, WISH_LT);
      assert.equal(run.created, 1);
      assert.equal(run.withCondition, 0, "no single answer, so none is invented");
      assert.equal(await prisma.wantCondition.count(), 0);
    } finally {
      await prisma.colnectConditionMapping.deleteMany({
        where: { collectionId: f.collectionId, stampConditionId: f.ctoId },
      });
    }
  });

  it("resolves through the matcher when no Colnect ID is stored, and writes none", async () => {
    const byNumber = await stamp("Known by number", { catalogNumber: "200" });
    await load([{ colnectId: "3004", catalogCodes: "Mi:PL 200" }]);

    const run = await applyColnectAdoption(f.userId, f.collectionId, WISH_LT);
    assert.equal(run.created, 1, "the catalog number found it");
    assert.equal(
      (await prisma.stamp.findUnique({ where: { id: byNumber }, select: { colnectId: true } }))
        ?.colnectId,
      null,
      "the matcher ran dry — learning an ID is a deliberate act, not a side effect of an import"
    );
    assert.equal(
      await prisma.want.count({ where: { collectionId: f.collectionId, stampId: byNumber } }),
      1
    );
  });

  it("counts a row that resolves to nothing rather than dropping or guessing at it", async () => {
    await load([
      { colnectId: "3005", catalogCodes: "Mi:PL 999" },
      { colnectId: "3006", catalogCodes: "" },
    ]);

    const preview = await previewColnectAdoption(f.userId, f.collectionId, WISH_LT);
    assert.equal(preview.passRows, 2);
    assert.equal(preview.adoptable, 0);
    assert.equal(preview.unresolved, 2, "the honest output on a list this size");

    const run = await applyColnectAdoption(f.userId, f.collectionId, WISH_LT);
    assert.equal(run.created, 0);
    assert.equal(await prisma.want.count({ where: { collectionId: f.collectionId } }), 0);
  });

  it("steps over a stamp already wanted under another ID, and counts it", async () => {
    // The row reaches the bucket because *this* Colnect id names nothing here — the stamp it
    // resolves to by number is wanted already, under no Colnect id of its own. A stamp whose own id
    // is on the export and whose want is open is simply in step, and never gets this far.
    const wanted = await stamp("Wanted under another ID", { catalogNumber: "210" });
    await prisma.want.create({ data: { collectionId: f.collectionId, stampId: wanted } });
    // A closed want is not a reason to skip: the collector closed it, and the wish is back.
    const reopened = await stamp("Wanted once", { colnectId: "3008" });
    await prisma.want.create({
      data: { collectionId: f.collectionId, stampId: reopened, closedAt: new Date() },
    });
    await load([{ colnectId: "3007", catalogCodes: "Mi:PL 210" }, { colnectId: "3008" }]);

    const run = await applyColnectAdoption(f.userId, f.collectionId, WISH_LT);
    assert.equal(run.alreadyWanted, 1);
    assert.equal(run.created, 1, "only the one whose want was closed");
    assert.equal(
      await prisma.want.count({ where: { collectionId: f.collectionId, stampId: wanted } }),
      1,
      "no second want beside the one already being looked for"
    );
  });

  it("is idempotent: a second pass over the same export writes nothing more", async () => {
    await stamp("Wanted twice over", { colnectId: "3009" });
    await load([{ colnectId: "3009" }]);

    assert.equal((await applyColnectAdoption(f.userId, f.collectionId, WISH_LT)).created, 1);
    const second = await applyColnectAdoption(f.userId, f.collectionId, WISH_LT);
    assert.equal(second.created, 0);
    assert.equal(second.bucketRows, 0, "the row left the bucket the moment the want appeared");
  });

  it("caps a pass while still reporting the whole bucket", async () => {
    const rows: Row[] = [];
    for (let i = 0; i < COLNECT_ADOPT_PASS_SIZE + 5; i += 1) {
      rows.push({ colnectId: `4${String(i).padStart(4, "0")}` });
    }
    await load(rows);

    const preview = await previewColnectAdoption(f.userId, f.collectionId, WISH_LT);
    assert.equal(preview.bucketRows, rows.length, "the report's own count of what is left");
    assert.equal(preview.passRows, COLNECT_ADOPT_PASS_SIZE, "and what this pass looked at");
  });

  it("narrows to the report's own filters, so a run acts on what the screen shows", async () => {
    await stamp("Filtered in", { colnectId: "3010" });
    await load([{ colnectId: "3010" }]);

    const none = await previewColnectAdoption(f.userId, f.collectionId, WISH_LT, {
      countries: ["Andorra"],
    });
    assert.equal(none.bucketRows, 0);
    assert.equal(none.passRows, 0);

    const some = await previewColnectAdoption(f.userId, f.collectionId, WISH_LT, {
      countries: ["Poland"],
    });
    assert.equal(some.adoptable, 1);
  });
});

describe("Adopting one row from its own menu (#688)", () => {
  it("writes the one want, grade and all", async () => {
    const known = await stamp("One at a time", { colnectId: "3101" });
    await load([{ colnectId: "3101", condition: "MNH" }]);

    const result = await applyColnectAdoptionForRow(f.userId, f.collectionId, WISH_LT, "3101");
    assert.equal(result.created, 1);
    const conditions = await prisma.wantCondition.findMany({
      where: { want: { stampId: known } },
      select: { conditionId: true },
    });
    assert.deepEqual(conditions.map((c) => c.conditionId), [f.mnhId]);
  });

  it("refuses a row that resolves to no stamp, and says where an ID is learned", async () => {
    await load([{ colnectId: "3102" }]);
    await assert.rejects(
      () => applyColnectAdoptionForRow(f.userId, f.collectionId, WISH_LT, "3102"),
      ColnectAdoptError
    );
  });

  it("refuses an item that is not on the export at all", async () => {
    await load([{ colnectId: "3103" }]);
    await assert.rejects(
      () => applyColnectAdoptionForRow(f.userId, f.collectionId, WISH_LT, "9999"),
      ColnectAdoptError
    );
  });
});

describe("What an adoption refuses (#688)", () => {
  it("refuses a list this side keeps in step", async () => {
    await assert.rejects(
      () => previewColnectAdoption(f.userId, f.collectionId, SWAP_LT),
      ColnectAdoptError
    );
  });

  it("refuses a list that is not set up for sync", async () => {
    await assert.rejects(
      () => previewColnectAdoption(f.userId, f.collectionId, 2),
      ColnectAdoptError
    );
  });
});
