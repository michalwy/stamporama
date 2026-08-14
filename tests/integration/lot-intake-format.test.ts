import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createLot, createLotWithStamps, intakeStamps } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";

// The format a copy is recorded with at intake (#573). Before this, intake wrote `formatId: null`
// on everything it created, and a null format *is* "single" (`StampFormat`, ADR-0020) — so a block
// of four identified into a lot was recorded as a single stamp, priced as one and matched against
// wants as one. Two rules are pinned here because both are invisible once wrong: the format
// reaches the row *and* the returned `ArrivingCopy` (the want review reads it as the third axis),
// and a whole-checklist intake drops it, since one format cannot be true of many stamps at once.

describe("intake records a copy's format (#573)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let block4Id: string;
  let foreignFormatId: string;
  let stampId: string;
  let otherStampId: string;
  let checklistId: string;

  async function openLot() {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    return createLot(userId, purchase.id, 10);
  }

  async function formatOf(itemId: string) {
    const item = await prisma.item.findUniqueOrThrow({
      where: { id: itemId },
      select: { formatId: true },
    });
    return item.formatId;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-intake-format-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User intake-format-${ts}`,
        email: `test-intake-format-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-intake-format-${ts}`,
        name: `Collection intake-format-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    // A second collection of the same owner, to prove the format is scoped to the one being
    // worked in — ownership alone is not the check.
    const otherCol = await prisma.collection.create({
      data: {
        slug: `col-intake-format-other-${ts}`,
        name: `Other collection intake-format-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });

    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    conditionId = condition.id;
    const block4 = await prisma.stampFormat.create({
      data: { collectionId, name: "Block of 4", abbreviation: "Blk4", sortOrder: 0 },
    });
    block4Id = block4.id;
    const foreign = await prisma.stampFormat.create({
      data: {
        collectionId: otherCol.id,
        name: "Block of 4",
        abbreviation: "Blk4",
        sortOrder: 0,
      },
    });
    foreignFormatId = foreign.id;

    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Test stamp" } });
    stampId = stamp.id;
    const other = await prisma.stamp.create({ data: { collectionId, name: "Second stamp" } });
    otherStampId = other.id;
    const checklist = await prisma.checklist.create({
      data: {
        collectionId,
        name: "Test checklist",
        stamps: { create: [{ stampId }, { stampId: otherStampId }] },
      },
      select: { id: true },
    });
    checklistId = checklist.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("writes the chosen format onto the copy, and reports it back", async () => {
    const lotId = await openLot();
    const [copy] = await intakeStamps(userId, lotId, {
      stampId,
      conditionId,
      formatId: block4Id,
    });
    assert.equal(await formatOf(copy.itemId), block4Id);
    // The want review is judged on what comes back, not on a re-read, so a right row and a wrong
    // return value would still ring the chip for a want that only ever wanted singles.
    assert.equal(copy.formatId, block4Id);
  });

  it("records a single when no format is named", async () => {
    const lotId = await openLot();
    const [copy] = await intakeStamps(userId, lotId, { stampId, conditionId });
    assert.equal(await formatOf(copy.itemId), null);
    assert.equal(copy.formatId, null);
  });

  it("drops a format on a whole-checklist intake: one format cannot fit many stamps", async () => {
    const lotId = await openLot();
    const copies = await intakeStamps(userId, lotId, {
      checklistId,
      conditionId,
      formatId: block4Id,
    });
    assert.equal(copies.length, 2);
    for (const copy of copies) {
      assert.equal(await formatOf(copy.itemId), null);
      assert.equal(copy.formatId, null);
    }
  });

  it("carries the format through `add lot with stamps`", async () => {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    const { copies } = await createLotWithStamps(userId, purchase.id, {
      price: 10,
      stampId,
      conditionId,
      formatId: block4Id,
    });
    assert.equal(copies.length, 1);
    assert.equal(await formatOf(copies[0].itemId), block4Id);
  });

  it("refuses a format from another collection", async () => {
    const lotId = await openLot();
    await assert.rejects(
      intakeStamps(userId, lotId, { stampId, conditionId, formatId: foreignFormatId }),
      /Format not found in this collection/
    );
  });
});
