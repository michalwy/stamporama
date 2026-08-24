import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { setColnectListMapping } from "../../src/lib/colnect-list-sync";
import { importColnectListSnapshot } from "../../src/lib/colnect-list-snapshot";
import { listColnectReportRows, setColnectReportIgnored } from "../../src/lib/colnect-list-report";
import {
  COLNECT_APPLY_MAX_SNAPSHOT_AGE_DAYS,
  ColnectApplyError,
  getColnectApplyWorklist,
  markColnectApplied,
} from "../../src/lib/colnect-list-apply";

// **What the Assistant is handed to carry out on Colnect (#689; ADR-0042).**
//
// What only a database can answer: that the worklist is exactly the two membership buckets and
// nothing else; that the direction follows the mapping's own `sourceOfTruth`; that a row already put
// away is not carried out again; that a **stale export loses its removals and keeps its additions**,
// which is the whole asymmetry of the guard; and that marking a batch applied hides those rows the
// way marking one by hand does.

const SWAP_LT = 3;
const WISH_LT = 4;

interface Fixtures {
  userId: string;
  collectionId: string;
  areaId: string;
  mnhId: string;
}

let f: Fixtures;
let itemNo = 0;

interface Row {
  colnectId: string;
  listName?: string;
}

function exportFile(rows: Row[], listName: string, stamp: string): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [
    `"Stamps on Colnect","List exported on ${stamp}"`,
    `"Launched by collector: ","A Collector [collector]"`,
    `"Collector profile on Colnect at: ",https://colnect.com/en/collectors/collector/collector`,
    `"This list contains ${rows.length} Stamps"`,
    `"For the updated list on Colnect visit: ",https://colnect.com/en/stamps/list/swap/collector`,
    "",
    `Name,Country,"Catalog Codes",Link,List,Quantity,Condition,"Public Note"`,
  ];
  for (const row of rows) {
    lines.push(
      [
        cell(`Colnect ${row.colnectId}`),
        cell("Poland"),
        cell(""),
        `https://colnect.com/stamps/stamp/${row.colnectId}`,
        cell(row.listName ?? listName),
        cell("[1]"),
        cell("[MNH]"),
        cell(""),
      ].join(",")
    );
  }
  lines.push(`"END of Colnect list launched on ${stamp}"`);
  return lines.join("\n");
}

async function stamp(colnectId: string, name: string): Promise<string> {
  const created = await prisma.stamp.create({
    data: {
      collectionId: f.collectionId,
      name,
      colnectId,
      stampAreaLinks: { create: [{ collectionAreaId: f.areaId, isPrimary: true }] },
    },
  });
  return created.id;
}

async function copy(stampId: string, forTrade = true): Promise<void> {
  itemNo += 1;
  await prisma.item.create({
    data: {
      collectionId: f.collectionId,
      itemNo,
      stampId,
      conditionId: f.mnhId,
      inCollection: true,
      forTrade,
      deliveryState: "delivered",
    },
  });
}

/** Load an export whose preamble states `exportedAt`, so the age guard has something to read. */
async function load(lt: number, rows: Row[], exportedAt: string): Promise<void> {
  const listName = lt === SWAP_LT ? "Swap" : "Wish";
  await importColnectListSnapshot(f.userId, f.collectionId, {
    lt,
    fileName: `${listName.toLowerCase()}.csv`,
    text: exportFile(rows, listName, exportedAt),
  });
}

before(async () => {
  const ts = Date.now();
  const userId = `test-user-colnect-apply-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User colnect-apply-${ts}`,
      email: `test-colnect-apply-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-colnect-apply-${ts}`,
      name: `Collection colnect-apply-${ts}`,
      baseCurrency: "EUR",
      ownerId: userId,
    },
  });
  const area = await prisma.collectionArea.create({
    data: { collectionId: collection.id, name: "Poland" },
  });
  const mnh = await prisma.stampCondition.create({
    data: {
      collectionId: collection.id,
      name: "Mint never hinged",
      abbreviation: "MNH",
      sortOrder: 0,
    },
  });

  f = { userId, collectionId: collection.id, areaId: area.id, mnhId: mnh.id };

  await setColnectListMapping(f.userId, f.collectionId, SWAP_LT, {
    source: "items_for_trade",
    sourceOfTruth: "local",
    enabled: true,
  });
  await setColnectListMapping(f.userId, f.collectionId, WISH_LT, {
    source: "wants_open",
    sourceOfTruth: "colnect",
    enabled: true,
  });
});

after(async () => {
  await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
  await prisma.user.deleteMany({ where: { id: f.userId } });
});

beforeEach(async () => {
  await prisma.item.deleteMany({ where: { collectionId: f.collectionId } });
  await prisma.want.deleteMany({ where: { collectionId: f.collectionId } });
  await prisma.stamp.deleteMany({ where: { collectionId: f.collectionId } });
});

const FRESH = "2026-08-22 10:00:00 GMT+0";
const NOW = new Date("2026-08-23T10:00:00Z");

describe("The worklist handed to the Assistant (#689)", () => {
  it("adds what is missing there and removes what this side no longer holds", async () => {
    const held = await stamp("5001", "For trade here");
    await copy(held);
    // On the list, no longer for trade here: the Swap mapping says this side wins.
    const gone = await stamp("5002", "Sold last week");
    await copy(gone, false);
    // In step, and therefore not a difference at all.
    const both = await stamp("5003", "In step");
    await copy(both);

    await load(SWAP_LT, [{ colnectId: "5002" }, { colnectId: "5003" }], FRESH);

    const worklist = await getColnectApplyWorklist(f.userId, f.collectionId, SWAP_LT, {}, NOW);
    assert.equal(worklist.additions, 1);
    assert.equal(worklist.removals, 1);
    assert.deepEqual(
      worklist.items.map((item) => [item.colnectId, item.direction]).sort(),
      [
        ["5001", "+"],
        ["5002", "-"],
      ].sort()
    );
    assert.equal(worklist.items.find((i) => i.colnectId === "5001")?.kind, "only-local");
    assert.equal(
      worklist.items.some((i) => i.colnectId === "5003"),
      false,
      "an item in step is not a difference"
    );
    assert.equal(held !== gone && both !== held, true);
  });

  it("proposes no removal where Colnect is the side that wins", async () => {
    // A Wish row only Colnect has is one to adopt here (#688), not one to take off the list there.
    await stamp("5101", "Wanted there");
    await load(WISH_LT, [{ colnectId: "5101" }], FRESH);

    const worklist = await getColnectApplyWorklist(f.userId, f.collectionId, WISH_LT, {}, NOW);
    assert.equal(worklist.removals, 0);
    assert.deepEqual(worklist.items, []);
  });

  it("leaves out quantity and grade — membership only", async () => {
    const wrongCount = await stamp("5201", "Wrong count");
    await copy(wrongCount);
    await load(SWAP_LT, [{ colnectId: "5201" }, { colnectId: "5201" }], FRESH);

    // Two rows for one item: the snapshot sums them, so Colnect says two and this side says one.
    const page = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT);
    assert.equal(page.rows.find((r) => r.key === "5201")?.bucket, "quantity");

    const worklist = await getColnectApplyWorklist(f.userId, f.collectionId, SWAP_LT, {}, NOW);
    assert.deepEqual(worklist.items, [], "a count is not something this run knows how to fix");
  });

  it("does not carry out a difference that has been put away", async () => {
    const held = await stamp("5301", "Accepted divergence");
    await copy(held);
    await load(SWAP_LT, [], FRESH);
    assert.equal(
      (await getColnectApplyWorklist(f.userId, f.collectionId, SWAP_LT, {}, NOW)).additions,
      1
    );

    await setColnectReportIgnored(f.userId, f.collectionId, SWAP_LT, "5301", "only-local", true);
    const worklist = await getColnectApplyWorklist(f.userId, f.collectionId, SWAP_LT, {}, NOW);
    assert.deepEqual(worklist.items, [], "a run carries out what the screen shows");
  });

  it("narrows to the report's own filters", async () => {
    const held = await stamp("5401", "Poland");
    await copy(held);
    await load(SWAP_LT, [], FRESH);

    assert.equal(
      (
        await getColnectApplyWorklist(
          f.userId,
          f.collectionId,
          SWAP_LT,
          { countries: ["Andorra"] },
          NOW
        )
      ).additions,
      0
    );
    assert.equal(
      (
        await getColnectApplyWorklist(
          f.userId,
          f.collectionId,
          SWAP_LT,
          { countries: ["Poland"] },
          NOW
        )
      ).additions,
      1
    );
  });
});

describe("A stale export loses its removals and keeps its additions (#689)", () => {
  it("refuses the removals and says why", async () => {
    const held = await stamp("5501", "Still for trade");
    await copy(held);
    const gone = await stamp("5502", "Not for trade any more");
    await copy(gone, false);
    await load(SWAP_LT, [{ colnectId: "5502" }], FRESH);

    const stale = new Date(NOW);
    stale.setDate(stale.getDate() + COLNECT_APPLY_MAX_SNAPSHOT_AGE_DAYS + 1);
    const worklist = await getColnectApplyWorklist(f.userId, f.collectionId, SWAP_LT, {}, stale);

    assert.equal(worklist.removalsAllowed, false);
    assert.equal(worklist.removals, 0);
    assert.equal(
      worklist.additions,
      1,
      "an addition is taken on the strength of this side, which was read this second"
    );
    assert.deepEqual(worklist.items.map((i) => i.colnectId), ["5501"]);
    assert.match(worklist.removalsRefused ?? "", /fresh export/);
  });

  it("counts the age from Colnect's own timestamp, not from when the file was loaded", async () => {
    await load(SWAP_LT, [], "2026-05-01 09:00:00 GMT+0");
    const worklist = await getColnectApplyWorklist(f.userId, f.collectionId, SWAP_LT, {}, NOW);
    assert.equal(
      worklist.removalsAllowed,
      false,
      "a file exported in May and loaded a minute ago is three months old"
    );
    assert.ok(worklist.snapshot.ageDays > 100);
  });
});

describe("Marking what the run applied (#689)", () => {
  it("hides those rows the way marking one by hand does", async () => {
    const held = await stamp("5601", "Applied on Colnect");
    await copy(held);
    const other = await stamp("5602", "Not yet");
    await copy(other);
    await load(SWAP_LT, [], FRESH);

    const result = await markColnectApplied(f.userId, f.collectionId, SWAP_LT, [
      { colnectId: "5601", kind: "only-local" },
    ]);
    assert.equal(result.marked, 1);

    const page = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT);
    assert.deepEqual(page.rows.map((r) => r.key), ["5602"]);

    const withHidden = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT, {
      includeHidden: true,
    });
    assert.equal(withHidden.rows.find((r) => r.key === "5601")?.done, true);
  });

  it("steps over a mark it cannot file rather than losing the batch", async () => {
    const held = await stamp("5701", "Good mark");
    await copy(held);
    await load(SWAP_LT, [], FRESH);

    const result = await markColnectApplied(f.userId, f.collectionId, SWAP_LT, [
      { colnectId: "", kind: "only-local" },
      { colnectId: "5701", kind: "not-a-bucket" },
      { colnectId: "5701", kind: "only-local" },
    ]);
    assert.equal(result.marked, 1, "the run had already written to Colnect; one bad neighbour must not undo that");
  });
});

describe("What a worklist refuses (#689)", () => {
  it("refuses a list that is not set up for sync", async () => {
    await assert.rejects(
      () => getColnectApplyWorklist(f.userId, f.collectionId, 2, {}, NOW),
      ColnectApplyError
    );
  });

  it("refuses a list with no import to compare against", async () => {
    await setColnectListMapping(f.userId, f.collectionId, 5, {
      source: "items_for_sale",
      sourceOfTruth: "local",
      enabled: true,
    });
    await assert.rejects(
      () => getColnectApplyWorklist(f.userId, f.collectionId, 5, {}, NOW),
      ColnectApplyError
    );
  });
});
