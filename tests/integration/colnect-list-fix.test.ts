import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { setColnectListMapping } from "../../src/lib/colnect-list-sync";
import {
  ColnectLocalFixError,
  applyColnectLocalFix,
  previewColnectLocalFix,
} from "../../src/lib/colnect-list-fix";

// **Fixing this side from the report (#687).**
//
// What only a database can answer, and so what is checked here: that a fix acts on exactly the rows
// the bucket was computed from — the copies *in hand* and no others — that it names them before it
// takes them, and that every combination the menu does not offer is also one the write refuses. The
// last part matters more than it looks: the menu is a client component reading
// `colnectLocalFixesFor`, and a write that trusted it would be a write with no guard at all.

const SWAP_LT = 3;
const SELL_LT = 5;
const WISH_LT = 4;

interface Fixtures {
  userId: string;
  collectionId: string;
  areaId: string;
  mnhId: string;
  usedId: string;
  ctoId: string;
}

let f: Fixtures;
let itemNo = 0;

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

async function copy(
  stampId: string,
  over: {
    conditionId?: string;
    forTrade?: boolean;
    forSale?: boolean;
    deliveryState?: string;
    disposedAt?: Date | null;
  } = {}
): Promise<string> {
  itemNo += 1;
  const created = await prisma.item.create({
    data: {
      collectionId: f.collectionId,
      itemNo,
      stampId,
      conditionId: over.conditionId ?? f.mnhId,
      inCollection: true,
      forTrade: over.forTrade ?? false,
      forSale: over.forSale ?? false,
      deliveryState: over.deliveryState ?? "delivered",
      disposedAt: over.disposedAt ?? null,
    },
  });
  return created.id;
}

async function want(stampId: string, conditionIds: string[]): Promise<string> {
  const created = await prisma.want.create({
    data: {
      collectionId: f.collectionId,
      stampId,
      conditions: { create: conditionIds.map((conditionId) => ({ conditionId })) },
    },
  });
  return created.id;
}

before(async () => {
  const ts = Date.now();
  const userId = `test-user-colnect-fix-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User colnect-fix-${ts}`,
      email: `test-colnect-fix-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-colnect-fix-${ts}`,
      name: `Collection colnect-fix-${ts}`,
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
  const cto = await prisma.stampCondition.create({
    data: { collectionId: collection.id, name: "Cancelled to order", abbreviation: "CTO", sortOrder: 2 },
  });
  await prisma.colnectConditionMapping.create({
    data: { collectionId: collection.id, stampConditionId: mnh.id, colnectValue: "1" },
  });
  await prisma.colnectConditionMapping.create({
    data: { collectionId: collection.id, stampConditionId: used.id, colnectValue: "4" },
  });

  f = { userId, collectionId: collection.id, areaId: area.id, mnhId: mnh.id, usedId: used.id, ctoId: cto.id };

  // Swap: ours wins. Sell: Colnect wins, so a Colnect-only row can be adopted onto a held copy.
  // Wish: wants, Colnect wins.
  await setColnectListMapping(f.userId, f.collectionId, SWAP_LT, {
    source: "items_for_trade",
    sourceOfTruth: "local",
    enabled: true,
  });
  await setColnectListMapping(f.userId, f.collectionId, SELL_LT, {
    source: "items_for_sale",
    sourceOfTruth: "colnect",
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

describe("Clearing a predicate that no longer holds (#687)", () => {
  it("unflags every copy in hand, and leaves the ones that are not", async () => {
    const stampId = await stamp("2001", "Went out last month");
    const a = await copy(stampId, { forTrade: true });
    const b = await copy(stampId, { forTrade: true });
    // Sold and gone: not in hand, so not part of what the list's predicate ever counted.
    const disposed = await copy(stampId, { forTrade: true, disposedAt: new Date() });
    // Still on its way: likewise outside the predicate.
    const ordered = await copy(stampId, { forTrade: true, deliveryState: "ordered" });

    const preview = await previewColnectLocalFix(
      f.userId,
      f.collectionId,
      SWAP_LT,
      "2001",
      "only-local",
      "clear"
    );
    assert.deepEqual(
      preview.copies.map((c) => c.id).sort(),
      [a, b].sort(),
      "the preview names the copies the report counted and no others"
    );
    assert.equal(preview.copies[0].conditionAbbreviation, "MNH", "named the way a shelf names it");

    const result = await applyColnectLocalFix(
      f.userId,
      f.collectionId,
      SWAP_LT,
      "2001",
      "only-local",
      "clear"
    );
    assert.equal(result.changed, 2);

    const after = await prisma.item.findMany({
      where: { stampId },
      select: { id: true, forTrade: true },
    });
    const flags = new Map(after.map((row) => [row.id, row.forTrade]));
    assert.equal(flags.get(a), false);
    assert.equal(flags.get(b), false);
    assert.equal(flags.get(disposed), true, "a disposed copy was never on the list's local side");
    assert.equal(flags.get(ordered), true, "nor was one that has not arrived");
  });

  it("closes the open wants of a want-backed list, and leaves a closed one alone", async () => {
    const stampId = await stamp("2002", "Already found");
    const open = await want(stampId, [f.mnhId]);
    const closed = await prisma.want.create({
      data: { collectionId: f.collectionId, stampId, closedAt: new Date("2026-01-01") },
    });

    const result = await applyColnectLocalFix(
      f.userId,
      f.collectionId,
      WISH_LT,
      "2002",
      "only-local",
      "clear"
    );
    assert.equal(result.changed, 1);
    assert.notEqual((await prisma.want.findUnique({ where: { id: open } }))?.closedAt, null);
    assert.deepEqual(
      (await prisma.want.findUnique({ where: { id: closed.id } }))?.closedAt,
      new Date("2026-01-01"),
      "a want closed months ago is not re-closed today"
    );
  });

  it("refuses once the row is already gone from the report", async () => {
    const stampId = await stamp("2003", "Nothing to clear");
    await copy(stampId, { forTrade: false });
    await assert.rejects(
      () =>
        previewColnectLocalFix(f.userId, f.collectionId, SWAP_LT, "2003", "only-local", "clear"),
      ColnectLocalFixError
    );
  });
});

describe("Setting a predicate the list says should hold (#687)", () => {
  it("flags the copies in hand that lack it", async () => {
    const stampId = await stamp("2101", "Held, not listed here");
    const a = await copy(stampId, { forSale: false });
    const b = await copy(stampId, { forSale: false });
    const alreadyOn = await copy(stampId, { forSale: true });
    const disposed = await copy(stampId, { forSale: false, disposedAt: new Date() });

    const preview = await previewColnectLocalFix(
      f.userId,
      f.collectionId,
      SELL_LT,
      "2101",
      "only-colnect",
      "set"
    );
    assert.deepEqual(preview.copies.map((c) => c.id).sort(), [a, b].sort());

    const result = await applyColnectLocalFix(
      f.userId,
      f.collectionId,
      SELL_LT,
      "2101",
      "only-colnect",
      "set"
    );
    assert.equal(result.changed, 2);
    const rows = await prisma.item.findMany({ where: { stampId }, select: { id: true, forSale: true } });
    const flags = new Map(rows.map((row) => [row.id, row.forSale]));
    assert.equal(flags.get(a), true);
    assert.equal(flags.get(b), true);
    assert.equal(flags.get(alreadyOn), true);
    assert.equal(flags.get(disposed), false, "a copy out of hand is not put back on offer");
  });

  it("refuses where this side is the one that wins", async () => {
    const stampId = await stamp("2102", "Not ours to adopt");
    await copy(stampId, { forTrade: false });
    await assert.rejects(
      () =>
        previewColnectLocalFix(f.userId, f.collectionId, SWAP_LT, "2102", "only-colnect", "set"),
      ColnectLocalFixError
    );
  });

  it("refuses where there is no copy to flag — a fix never conjures one", async () => {
    await stamp("2103", "Known, not held");
    await assert.rejects(
      () =>
        previewColnectLocalFix(f.userId, f.collectionId, SELL_LT, "2103", "only-colnect", "set"),
      ColnectLocalFixError
    );
  });

  it("refuses where nothing here carries that Colnect ID at all", async () => {
    await assert.rejects(
      () =>
        previewColnectLocalFix(f.userId, f.collectionId, SELL_LT, "2104", "only-colnect", "set"),
      ColnectLocalFixError
    );
  });
});

describe("Narrowing a want to the grade the list states (#687)", () => {
  it("replaces every open want's accepted conditions with the one Colnect means", async () => {
    const stampId = await stamp("2201", "Wanted on other terms");
    const wide = await want(stampId, [f.mnhId, f.usedId]);

    const preview = await previewColnectLocalFix(
      f.userId,
      f.collectionId,
      WISH_LT,
      "2201",
      "grade",
      "grade",
      "U"
    );
    assert.equal(preview.conditionId, f.usedId);
    assert.deepEqual(preview.wants.map((w) => w.id), [wide]);
    assert.deepEqual(
      preview.wants[0].conditionNames.sort(),
      ["Mint never hinged", "Used"],
      "the dialog says what it is narrowing from"
    );

    const result = await applyColnectLocalFix(
      f.userId,
      f.collectionId,
      WISH_LT,
      "2201",
      "grade",
      "grade",
      "U"
    );
    assert.equal(result.changed, 1);
    const conditions = await prisma.wantCondition.findMany({ where: { wantId: wide } });
    assert.deepEqual(conditions.map((c) => c.conditionId), [f.usedId]);
  });

  it("refuses a grade two of this collection's conditions both map to", async () => {
    const stampId = await stamp("2202", "Ambiguous grade");
    await want(stampId, [f.mnhId]);
    // A second condition claiming Colnect's `MNH`: forwards the mapping is still a function, but
    // backwards it now has two answers, and picking one would be an invention.
    await prisma.colnectConditionMapping.create({
      data: { collectionId: f.collectionId, stampConditionId: f.ctoId, colnectValue: "1" },
    });
    try {
      await assert.rejects(
        () =>
          previewColnectLocalFix(f.userId, f.collectionId, WISH_LT, "2202", "grade", "grade", "MNH"),
        ColnectLocalFixError
      );
    } finally {
      await prisma.colnectConditionMapping.deleteMany({
        where: { collectionId: f.collectionId, stampConditionId: f.ctoId },
      });
    }
  });

  it("refuses a grade fix on a copy-backed list", async () => {
    const stampId = await stamp("2203", "Graded here, not there");
    await copy(stampId, { forTrade: true, conditionId: f.usedId });
    await assert.rejects(
      () => previewColnectLocalFix(f.userId, f.collectionId, SWAP_LT, "2203", "grade", "grade", "MNH"),
      ColnectLocalFixError
    );
  });
});

describe("What a fix refuses outright (#687)", () => {
  it("offers nothing for a quantity row, whichever list it is on", async () => {
    const stampId = await stamp("2301", "Wrong count");
    await copy(stampId, { forTrade: true });
    await assert.rejects(
      () =>
        previewColnectLocalFix(f.userId, f.collectionId, SWAP_LT, "2301", "quantity", "clear"),
      ColnectLocalFixError
    );
  });

  it("refuses a list that is not set up for sync", async () => {
    await assert.rejects(
      () => previewColnectLocalFix(f.userId, f.collectionId, 2, "2401", "only-local", "clear"),
      ColnectLocalFixError
    );
  });

  it("refuses a bucket this report does not file rows under", async () => {
    await assert.rejects(
      () => previewColnectLocalFix(f.userId, f.collectionId, SWAP_LT, "2401", "in-sync", "clear"),
      ColnectLocalFixError
    );
  });
});
