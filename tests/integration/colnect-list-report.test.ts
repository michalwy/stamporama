import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../../src/lib/db";
import { setColnectListMapping } from "../../src/lib/colnect-list-sync";
import {
  ColnectListImportError,
  importColnectListSnapshot,
  previewColnectListFile,
} from "../../src/lib/colnect-list-snapshot";
import {
  getColnectReportCountries,
  getColnectReportCounts,
  getColnectReportLists,
  listColnectReportRows,
  setColnectReportDone,
  setColnectReportIgnored,
} from "../../src/lib/colnect-list-report";

// **Loading an export (#685) and reading the difference off it (#686).**
//
// What only a database can answer, and so what is checked here: that a file lands against the list
// it names itself without being asked; that a re-import replaces the snapshot rather than filing a
// second answer; that each of the five buckets holds what it says it does — including the two that
// have to stay *silent*, an item in step and an item whose local copies disagree on a grade; that
// the per-list columns are read for the list being imported rather than for the row's first group;
// and that a "done" claim dies with the export it was made against while an accepted divergence
// outlives it.
//
// The buckets are checked against a file built here rather than a real export, because a bucket is
// a relationship between two sides and the fixture exports carry only one. The import's own
// arithmetic — rows read, the declared count, rows carrying no `Link` — is checked against the real
// file, so what the reader promises and what this stores cannot drift.

const REAL_EXPORT = readFileSync(
  join(process.cwd(), "tests/fixtures/colnect/own-wish-list.csv"),
  "utf8"
);

const SWAP_LT = 3;
const WISH_LT = 4;
const SELL_LT = 5;

interface Fixtures {
  userId: string;
  collectionId: string;
  areaId: string;
  mnhId: string;
  usedId: string;
}

let f: Fixtures;
let itemNo = 0;

/** One row of a made-up export. */
interface Row {
  colnectId: string | null;
  name: string;
  country: string;
  /** `List` / `Quantity` / `Condition`, positionally — the shape the reader is built around. */
  lists: { listName: string; quantity: string; condition: string }[];
}

/** A Colnect export, in the shape the reader reads: five preamble lines, a blank, the header, the
 *  rows, and the footer. Only the columns the import takes are written — the reader finds them by
 *  name, so the other thirty-odd would be scenery. */
function exportFile(rows: Row[], stamp = "2026-08-22 10:00:00 GMT+0"): string {
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
        cell(row.name),
        cell(row.country),
        cell(""),
        row.colnectId ? `https://colnect.com/stamps/stamp/${row.colnectId}` : cell(""),
        cell(row.lists.map((l) => l.listName).join(",")),
        cell(row.lists.map((l) => `[${l.quantity}]`).join(",")),
        cell(row.lists.map((l) => `[${l.condition}]`).join(",")),
        cell(""),
      ].join(",")
    );
  }
  lines.push(`"END of Colnect list launched on ${stamp}"`);
  return lines.join("\n");
}

/** One row on the Swap list alone — the ordinary case. */
function swapRow(colnectId: string | null, over: Partial<Row> & { quantity?: string; condition?: string } = {}): Row {
  return {
    colnectId,
    name: over.name ?? `Colnect ${colnectId ?? "?"}`,
    country: over.country ?? "Poland",
    lists: over.lists ?? [
      { listName: "Swap", quantity: over.quantity ?? "1", condition: over.condition ?? "MNH" },
    ],
  };
}

async function stamp(colnectId: string | null, name: string): Promise<string> {
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

async function copy(
  stampId: string,
  conditionId: string,
  over: { forTrade?: boolean; forSale?: boolean } = {}
) {
  itemNo += 1;
  await prisma.item.create({
    data: {
      collectionId: f.collectionId,
      itemNo,
      stampId,
      conditionId,
      inCollection: true,
      forTrade: over.forTrade ?? true,
      forSale: over.forSale ?? false,
      deliveryState: "delivered",
    },
  });
}

before(async () => {
  const ts = Date.now();
  const userId = `test-user-colnect-report-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User colnect-report-${ts}`,
      email: `test-colnect-report-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-colnect-report-${ts}`,
      name: `Collection colnect-report-${ts}`,
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
  const used = await prisma.stampCondition.create({
    data: { collectionId: collection.id, name: "Used", abbreviation: "U", sortOrder: 1 },
  });
  // The collection's own reading of Colnect's five grades (#404) — the report compares through it
  // rather than through a second opinion about what `MNH` means.
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
    mnhId: mnh.id,
    usedId: used.id,
  };

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

describe("Colnect list import (#685)", () => {
  it("lands a file against the list it names itself, and says what it read", async () => {
    const preview = await previewColnectListFile(
      f.userId,
      f.collectionId,
      "swap.csv",
      exportFile([swapRow("9001"), swapRow("9002")])
    );
    assert.equal(preview.suggestedList, "Swap");
    assert.equal(preview.resolvedLt, SWAP_LT, "the file's own list name resolves the mapping");
    assert.equal(preview.declaredCount, 2);
    assert.equal(preview.rowsRead, 2);
    assert.deepEqual(
      preview.targets.map((t) => t.lt),
      [SWAP_LT],
      "only a list switched on is offered"
    );

    const result = await importColnectListSnapshot(f.userId, f.collectionId, {
      lt: SWAP_LT,
      fileName: "swap.csv",
      text: exportFile([swapRow("9001"), swapRow("9002")]),
    });
    assert.equal(result.rowsWritten, 2);
    assert.equal(result.replaced, false);
  });

  it("reports rows carrying no Link rather than quietly dropping them", async () => {
    const result = await importColnectListSnapshot(f.userId, f.collectionId, {
      lt: SWAP_LT,
      fileName: "swap.csv",
      // The third row carries a catalog code and no link, so the reader keeps it and the import
      // cannot: there is nothing to compare it by.
      text: exportFile([swapRow("9001"), swapRow("9002"), swapRow(null)]).replace(
        `"","",`,
        `"Mi:PL 1","",`
      ),
    });
    assert.equal(result.rowsOnList, 3);
    assert.equal(result.rowsWritten, 2);
    assert.equal(result.rowsWithoutId, 1);
    assert.equal(result.replaced, true, "the second import replaced the first");
  });

  it("takes the per-list columns for the list being imported, not the row's first group", async () => {
    // The row is on Wish first and Swap second, and the two disagree about both numbers.
    const row: Row = {
      colnectId: "9100",
      name: "Two lists",
      country: "Poland",
      lists: [
        { listName: "Wish", quantity: "5", condition: "U" },
        { listName: "Swap", quantity: "2", condition: "MNH" },
      ],
    };
    await importColnectListSnapshot(f.userId, f.collectionId, {
      lt: SWAP_LT,
      fileName: "two-lists.csv",
      text: exportFile([row, swapRow("9101")]),
      listName: "Swap",
    });
    const stored = await prisma.colnectListSnapshotRow.findFirst({
      where: { colnectId: "9100", snapshot: { mapping: { collectionId: f.collectionId } } },
      select: { quantity: true, conditionAbbrev: true },
    });
    assert.deepEqual(stored, { quantity: 2, conditionAbbrev: "MNH" });
  });

  it("keeps the export's own timestamp and declared count off a real file", async () => {
    // The real fixture's rows are on `Test Swap FROM`, which no configured list is called, so the
    // list has to be named — which is exactly the case the screen asks about.
    const result = await importColnectListSnapshot(f.userId, f.collectionId, {
      lt: SWAP_LT,
      fileName: "own-wish-list.csv",
      text: REAL_EXPORT,
      listName: "Test Swap FROM",
    });
    assert.equal(result.declaredCount, 8);
    assert.equal(result.rowsOnList, result.rowsRead);
    const lists = await getColnectReportLists(f.userId, f.collectionId);
    const swap = lists.find((l) => l.lt === SWAP_LT);
    assert.ok(swap?.snapshot);
    assert.equal(swap.snapshot.declaredCount, 8);
    assert.ok(swap.snapshot.exportedAt, "Colnect's own stamp of when, parsed");
  });

  it("refuses a file that is not an export, and a list that is not synced", async () => {
    await assert.rejects(
      () => previewColnectListFile(f.userId, f.collectionId, "notes.csv", "hello,world\n1,2"),
      ColnectListImportError
    );
    await assert.rejects(
      () =>
        importColnectListSnapshot(f.userId, f.collectionId, {
          lt: 5,
          fileName: "sell.csv",
          text: exportFile([swapRow("9001")]),
        }),
      ColnectListImportError
    );
  });
});

describe("Colnect list discrepancy report (#686)", () => {
  /** One stamp per bucket, and two that must stay out of the report entirely. */
  const ids = {
    inSync: "1001",
    quantity: "1002",
    grade: "1003",
    onlyLocal: "1004",
    onlyColnect: "1005",
    mixedGrade: "1006",
  };
  const stampIds: Record<string, string> = {};

  before(async () => {
    // In step: two copies for trade, MNH, and the list says the same.
    stampIds.inSync = await stamp(ids.inSync, "In step");
    await copy(stampIds.inSync, f.mnhId);
    await copy(stampIds.inSync, f.mnhId);
    // One copy here, three on the list.
    stampIds.quantity = await stamp(ids.quantity, "Wrong count");
    await copy(stampIds.quantity, f.mnhId);
    // Used here, mint there.
    stampIds.grade = await stamp(ids.grade, "Wrong grade");
    await copy(stampIds.grade, f.usedId);
    // Here and not on the list.
    stampIds.onlyLocal = await stamp(ids.onlyLocal, "Missing there");
    await copy(stampIds.onlyLocal, f.mnhId);
    // Two copies, two grades — the local side states no grade at all, so nothing is reported even
    // though the list names one.
    stampIds.mixedGrade = await stamp(ids.mixedGrade, "Two grades");
    await copy(stampIds.mixedGrade, f.mnhId);
    await copy(stampIds.mixedGrade, f.usedId);
    // No Colnect id: never checked, and therefore not missing from anything.
    stampIds.notComparable = await stamp(null, "Unlinked");
    await copy(stampIds.notComparable, f.mnhId);
    // A copy that is not for trade — the predicate does not hold, so it is not on this list's local
    // side at all.
    const parked = await stamp("1007", "Not for trade");
    await copy(parked, f.mnhId, { forTrade: false });

    await importColnectListSnapshot(f.userId, f.collectionId, {
      lt: SWAP_LT,
      fileName: "swap.csv",
      text: exportFile([
        swapRow(ids.inSync, { quantity: "2", condition: "MNH" }),
        swapRow(ids.quantity, { quantity: "3", condition: "MNH" }),
        swapRow(ids.grade, { quantity: "1", condition: "MNH" }),
        swapRow(ids.onlyColnect, { quantity: "1", condition: "MNH", country: "Andorra" }),
        swapRow(ids.mixedGrade, { quantity: "2", condition: "MNH" }),
      ]),
    });
  });

  it("counts the five buckets, and stays silent about what is in step", async () => {
    const counts = await getColnectReportCounts(f.userId, f.collectionId, SWAP_LT);
    assert.deepEqual(counts, {
      "only-local": 1,
      "only-colnect": 1,
      quantity: 1,
      grade: 1,
      "not-comparable": 1,
    });
  });

  it("files each row under its own bucket, with both sides on it", async () => {
    const page = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT);
    const byKey = new Map(page.rows.map((row) => [row.key, row]));

    const quantity = byKey.get(ids.quantity);
    assert.equal(quantity?.bucket, "quantity");
    assert.equal(quantity?.localQuantity, 1);
    assert.equal(quantity?.colnectQuantity, 3);

    const grade = byKey.get(ids.grade);
    assert.equal(grade?.bucket, "grade");
    assert.equal(grade?.localConditionId, f.usedId);
    assert.equal(grade?.colnectGrade, "MNH");

    assert.equal(byKey.get(ids.onlyLocal)?.bucket, "only-local");
    const extra = byKey.get(ids.onlyColnect);
    assert.equal(extra?.bucket, "only-colnect");
    assert.equal(extra?.stampId, null, "nothing local to point at");
    assert.equal(extra?.country, "Andorra", "the file's own country, where there is no stamp");

    const unlinked = byKey.get(stampIds.notComparable);
    assert.equal(unlinked?.bucket, "not-comparable");
    assert.equal(unlinked?.colnectId, null);
    assert.equal(unlinked?.country, "Poland", "the stamp's own area, where there is a stamp");

    assert.equal(byKey.has(ids.inSync), false, "an item in step is not a difference");
    assert.equal(
      byKey.has(ids.mixedGrade),
      false,
      "copies that disagree on a grade state none, so there is nothing to disagree with"
    );
  });

  it("filters by bucket and by country, and counts each under the other", async () => {
    const onlyColnect = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT, {
      buckets: ["only-colnect"],
    });
    assert.deepEqual(
      onlyColnect.rows.map((r) => r.key),
      [ids.onlyColnect]
    );

    const countries = await getColnectReportCountries(f.userId, f.collectionId, SWAP_LT);
    assert.deepEqual(countries, [
      { country: "Andorra", rows: 1 },
      { country: "Poland", rows: 4 },
    ]);

    const inPoland = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT, {
      countries: ["Poland"],
    });
    assert.equal(inPoland.rows.length, 4);

    // A bucket's own count is not narrowed by the bucket filter — that is what makes it a facet.
    const counted = await getColnectReportCounts(f.userId, f.collectionId, SWAP_LT, {
      buckets: ["grade"],
    });
    assert.equal(counted["only-colnect"], 1);
  });

  it("hides a row marked done until the next import, and one accepted for good", async () => {
    await setColnectReportDone(f.userId, f.collectionId, SWAP_LT, ids.quantity, "quantity", true);
    await setColnectReportIgnored(
      f.userId,
      f.collectionId,
      SWAP_LT,
      ids.onlyColnect,
      "only-colnect",
      true,
      "Kept there on purpose"
    );

    const open = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT);
    assert.equal(open.rows.some((r) => r.key === ids.quantity), false);
    assert.equal(open.rows.some((r) => r.key === ids.onlyColnect), false);

    const all = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT, {
      includeHidden: true,
    });
    assert.equal(all.rows.find((r) => r.key === ids.quantity)?.done, true);
    const ignored = all.rows.find((r) => r.key === ids.onlyColnect);
    assert.equal(ignored?.ignored, true);
    assert.equal(ignored?.ignoredNote, "Kept there on purpose");

    // The same file again: the claim about Colnect's state dies with the export it was made
    // against, the judgement about this collection does not.
    await importColnectListSnapshot(f.userId, f.collectionId, {
      lt: SWAP_LT,
      fileName: "swap.csv",
      text: exportFile([
        swapRow(ids.inSync, { quantity: "2", condition: "MNH" }),
        swapRow(ids.quantity, { quantity: "3", condition: "MNH" }),
        swapRow(ids.grade, { quantity: "1", condition: "MNH" }),
        swapRow(ids.onlyColnect, { quantity: "1", condition: "MNH", country: "Andorra" }),
        swapRow(ids.mixedGrade, { quantity: "2", condition: "MNH" }),
      ]),
    });

    const after = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT);
    assert.equal(
      after.rows.some((r) => r.key === ids.quantity),
      true,
      "a difference that comes back was not actually done"
    );
    assert.equal(
      after.rows.some((r) => r.key === ids.onlyColnect),
      false,
      "an accepted divergence stays accepted"
    );
  });

  it("pages in a total order", async () => {
    const first = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT, {}, 0, 2);
    assert.equal(first.rows.length, 2);
    assert.equal(first.nextCursor, "2");
    const second = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT, {}, 2, 2);
    const keys = new Set([...first.rows, ...second.rows].map((r) => r.key));
    assert.equal(keys.size, first.rows.length + second.rows.length, "no row on two pages");
  });
});

describe("Colnect list report over wants (#686)", () => {
  before(async () => {
    await setColnectListMapping(f.userId, f.collectionId, WISH_LT, {
      source: "wants_open",
      sourceOfTruth: "colnect",
      enabled: true,
    });
    const wanted = await stamp("2001", "Wanted, one grade");
    await prisma.want.create({
      data: {
        collectionId: f.collectionId,
        stampId: wanted,
        conditions: { create: [{ conditionId: f.mnhId }] },
      },
    });
    const anyGrade = await stamp("2002", "Wanted, any grade");
    await prisma.want.create({
      data: {
        collectionId: f.collectionId,
        stampId: anyGrade,
        conditions: { create: [{ conditionId: f.mnhId }, { conditionId: f.usedId }] },
      },
    });
    const closed = await stamp("2003", "Found already");
    await prisma.want.create({
      data: { collectionId: f.collectionId, stampId: closed, closedAt: new Date() },
    });

    await importColnectListSnapshot(f.userId, f.collectionId, {
      lt: WISH_LT,
      fileName: "wish.csv",
      text: exportFile([
        { colnectId: "2001", name: "Wanted", country: "Poland", lists: [{ listName: "Wish", quantity: "1", condition: "U" }] },
        { colnectId: "2002", name: "Any grade", country: "Poland", lists: [{ listName: "Wish", quantity: "1", condition: "U" }] },
        { colnectId: "2003", name: "Found", country: "Poland", lists: [{ listName: "Wish", quantity: "1", condition: "MNH" }] },
      ]),
      listName: "Wish",
    });
  });

  it("reads a want's single condition as its grade and says nothing where it names several", async () => {
    const rows = await listColnectReportRows(f.userId, f.collectionId, WISH_LT);
    const byKey = new Map(rows.rows.map((row) => [row.key, row]));
    assert.equal(byKey.get("2001")?.bucket, "grade", "one condition, and the list disagrees");
    assert.equal(
      byKey.has("2002"),
      false,
      "a want naming several conditions states no grade to disagree with"
    );
    assert.equal(
      byKey.get("2003")?.bucket,
      "only-colnect",
      "a closed want is not an open one — the list still holds it"
    );
  });
});

describe("The local candidate behind a Colnect-only row (#687)", () => {
  // A list of its own, because this is about what the *other* rows of a report cannot show: the
  // Swap fixtures above are built so that every stamp either qualifies or does not exist here, and
  // the whole question here is the third case — held, and not on the list's terms.
  const held = "1101";
  const unknown = "1102";
  const qualifying = "1103";
  let heldStampId = "";

  before(async () => {
    await setColnectListMapping(f.userId, f.collectionId, SELL_LT, {
      source: "items_for_sale",
      sourceOfTruth: "colnect",
      enabled: true,
    });

    // Held, in hand, and **not** for sale: the predicate does not hold, so the row is
    // `only-colnect` — and yet there is something here to set the flag on.
    heldStampId = await stamp(held, "Held but not for sale");
    await copy(heldStampId, f.mnhId, { forSale: false });
    await copy(heldStampId, f.mnhId, { forSale: false });
    // Never heard of it: the list names an item this collection holds no stamp for at all.
    // (No local stamp is created for `unknown`.)
    // On both sides, so it stays off the report entirely.
    const forSale = await stamp(qualifying, "For sale");
    await copy(forSale, f.mnhId, { forSale: true });

    await importColnectListSnapshot(f.userId, f.collectionId, {
      lt: SELL_LT,
      fileName: "sell.csv",
      text: exportFile([
        { colnectId: held, name: "Held but not for sale", country: "Poland", lists: [{ listName: "Sell", quantity: "1", condition: "MNH" }] },
        { colnectId: unknown, name: "Never heard of it", country: "Poland", lists: [{ listName: "Sell", quantity: "1", condition: "MNH" }] },
        { colnectId: qualifying, name: "For sale", country: "Poland", lists: [{ listName: "Sell", quantity: "1", condition: "MNH" }] },
      ]),
    });
  });

  it("names the stamp a Colnect-only row could be set on, and how many copies it would flag", async () => {
    const page = await listColnectReportRows(f.userId, f.collectionId, SELL_LT);
    const byKey = new Map(page.rows.map((row) => [row.key, row]));

    const heldRow = byKey.get(held);
    assert.equal(heldRow?.bucket, "only-colnect", "the predicate does not hold, so it is extra there");
    assert.equal(heldRow?.stampId, null, "the local side of the comparison holds no row for it");
    assert.equal(heldRow?.candidateStampId, heldStampId, "and yet the collection holds the stamp");
    assert.equal(heldRow?.candidateCopies, 2, "both copies are in hand and unflagged");

    const unknownRow = byKey.get(unknown);
    assert.equal(unknownRow?.bucket, "only-colnect");
    assert.equal(unknownRow?.candidateStampId, null, "nothing here carries that Colnect ID");
    assert.equal(unknownRow?.candidateCopies, null);

    assert.equal(byKey.has(qualifying), false, "an item in step is not a difference");
  });

  it("states no candidate copies for a want-backed list, where no flag is set on anything", async () => {
    await setColnectListMapping(f.userId, f.collectionId, WISH_LT, {
      source: "wants_open",
      sourceOfTruth: "colnect",
      enabled: true,
    });
    const wanted = await stamp("1104", "Wanted, no want row yet");
    await importColnectListSnapshot(f.userId, f.collectionId, {
      lt: WISH_LT,
      fileName: "wish.csv",
      text: exportFile([
        { colnectId: "1104", name: "Wanted, no want row yet", country: "Poland", lists: [{ listName: "Wish", quantity: "1", condition: "MNH" }] },
      ]),
    });

    const page = await listColnectReportRows(f.userId, f.collectionId, WISH_LT);
    const row = page.rows.find((r) => r.key === "1104");
    assert.equal(row?.bucket, "only-colnect");
    assert.equal(row?.candidateStampId, wanted, "the stamp is here; the want is not");
    assert.equal(row?.candidateCopies, null, "there is no flag to set — a want is created instead");
  });
});

// What a row calls the stamp when the stamp calls itself nothing, and what it calls the place the
// stamp is filed under. Both are the same complaint about the same screen: a column of italic
// `(unnamed)` rows under a bare leaf area identifies nothing, and the collection knows better on
// both counts. Last in the file because it adds a stamp to the Swap list, which every count above
// is asserted against.
describe("How a report row identifies its stamp (#686)", () => {
  it("names the whole area path and the issue behind an unnamed stamp", async () => {
    const child = await prisma.collectionArea.create({
      data: { collectionId: f.collectionId, name: "People's Republic", parentId: f.areaId },
    });
    const issue = await prisma.issue.create({
      data: {
        collectionId: f.collectionId,
        collectionAreaId: child.id,
        issueNo: 1,
        name: "A Thousand Years",
        year: 1966,
      },
    });
    const unnamed = await prisma.stamp.create({
      data: {
        collectionId: f.collectionId,
        // No name of its own, which is what most of a Colnect list looks like.
        colnectId: null,
        stampAreaLinks: { create: [{ collectionAreaId: child.id, isPrimary: true }] },
        issueMemberships: { create: [{ issueId: issue.id }] },
      },
    });
    await copy(unnamed.id, f.mnhId);

    const page = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT, {
      buckets: ["not-comparable"],
    });
    const row = page.rows.find((r) => r.stampId === unnamed.id);
    assert.equal(row?.country, "Poland › People's Republic", "the path, not the leaf");
    assert.equal(row?.issueName, "A Thousand Years");
    assert.equal(row?.issueYear, 1966);

    // The facet has to state the same string the rows do, or ticking it would hide them.
    const countries = await getColnectReportCountries(f.userId, f.collectionId, SWAP_LT);
    assert.ok(
      countries.some((c) => c.country === "Poland › People's Republic"),
      "the country facet lists what the rows carry"
    );
    const filtered = await listColnectReportRows(f.userId, f.collectionId, SWAP_LT, {
      countries: ["Poland › People's Republic"],
    });
    assert.equal(filtered.rows.length, 1, "and filtering by it finds the row");
  });
});
