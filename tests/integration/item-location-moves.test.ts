import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, updateItem } from "../../src/lib/items";
import { bulkUpdateLotItems, createLot, intakeStamps, markPurchaseArrived } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { deleteLocation } from "../../src/lib/locations";
import { getCopyLocationMoves, listLocationHistory, setMoveSourceTx } from "../../src/lib/location-moves";

// A copy's moves between locations (#2277, ADR-0074). The entries are the database's — a trigger on
// `item` — so what is pinned here is that every way the app moves a copy leaves one, with what moved
// it; that a write not touching the location leaves none; that the ref alone is a move; and that the
// reads give the copy's history and a location's (with everything under it) back the right way round.

const ts = Date.now();

describe("item location moves (#2277)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let cabinetId: string;
  let bookAId: string;
  let bookBId: string;
  let safeId: string;
  let otherCollectionId: string;
  let foreignPurchaseId: string;

  before(async () => {
    userId = `test-user-locmoves-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User locmoves-${ts}`,
        email: `test-locmoves-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-locmoves-${ts}`, name: "Moves", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-locmoves-other-${ts}`, name: "Other", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    foreignPurchaseId = (
      await createPurchase(userId, otherCollectionId, { currency: "EUR", purchasedAt: "2026-01-01" })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Chopin" } })).id;
    cabinetId = (
      await prisma.location.create({
        data: { collectionId, code: "S", name: "Szafa", assignable: false },
      })
    ).id;
    bookAId = (
      await prisma.location.create({
        data: { collectionId, code: "A", name: "Klaser A", parentId: cabinetId },
      })
    ).id;
    bookBId = (
      await prisma.location.create({
        data: { collectionId, code: "B", name: "Klaser B", parentId: cabinetId },
      })
    ).id;
    safeId = (await prisma.location.create({ data: { collectionId, code: "T", name: "Sejf" } })).id;
  });

  after(async () => {
    for (const id of [collectionId, otherCollectionId]) {
      await prisma.item.deleteMany({ where: { collectionId: id } });
      await prisma.purchase.deleteMany({ where: { collectionId: id } });
      await prisma.location.deleteMany({ where: { collectionId: id, parentId: { not: null } } });
      await prisma.location.deleteMany({ where: { collectionId: id } });
      await prisma.stamp.deleteMany({ where: { collectionId: id } });
      await prisma.stampCondition.deleteMany({ where: { collectionId: id } });
      await prisma.collection.delete({ where: { id } });
    }
    await prisma.user.delete({ where: { id: userId } });
  });

  async function movesOf(itemId: string) {
    return prisma.itemLocationMove.findMany({
      where: { itemId },
      orderBy: [{ movedAt: "asc" }, { id: "asc" }],
    });
  }

  it("records a copy added through the copy form, and every change of its location or ref", async () => {
    const item = await createItem(userId, collectionId, {
      stampId,
      conditionId,
      locationId: bookAId,
      locationRef: "12",
    });
    await updateItem(userId, item.id, { locationId: bookAId, locationRef: "13" });
    await updateItem(userId, item.id, { notes: "a note, not a move" });
    await updateItem(userId, item.id, { locationId: null });

    const moves = await movesOf(item.id);
    assert.deepEqual(
      moves.map((m) => [m.source, m.fromLocationId, m.fromRef, m.toLocationId, m.toRef]),
      [
        ["copy_form", null, null, bookAId, "12"],
        // The ref is part of the place: card 12 to card 13 of one box is a move.
        ["copy_form", bookAId, "12", bookAId, "13"],
        // Taken off with no new location — and the ref goes with it.
        ["copy_form", bookAId, "13", null, null],
      ]
    );
    assert.equal(moves[0].toLocationName, "Klaser A");
    assert.equal(moves[0].collectionId, collectionId);
  });

  it("records Bulk edit, and a purchase's own screen as the purchase — but never another collection's", async () => {
    const a = await createItem(userId, collectionId, { stampId, conditionId });
    const b = await createItem(userId, collectionId, { stampId, conditionId });
    await bulkUpdateLotItems(userId, [a.id, b.id], { locationId: bookBId, locationRef: "7" });

    const purchase = await createPurchase(userId, collectionId, { currency: "EUR", purchasedAt: "2026-02-01" });
    await bulkUpdateLotItems(userId, [a.id], { locationId: safeId }, { source: "purchase", sourceId: purchase.id });
    await bulkUpdateLotItems(
      userId,
      [b.id],
      { locationId: safeId },
      { source: "purchase", sourceId: foreignPurchaseId }
    );

    const movesA = await movesOf(a.id);
    assert.deepEqual(
      movesA.map((m) => [m.source, m.sourceId, m.toLocationId, m.toRef]),
      [
        ["copy_form", null, null, null],
        ["bulk_edit", null, bookBId, "7"],
        // The plain move writes no ref, so the copy keeps the one it had.
        ["purchase", purchase.id, safeId, "7"],
      ]
    );
    const lastB = (await movesOf(b.id)).at(-1)!;
    assert.equal(lastB.source, "purchase");
    assert.equal(lastB.sourceId, null, "a purchase of another collection is not named");
  });

  it("records copies added on a purchase, and filed on its arrival, as the purchase's", async () => {
    const purchase = await createPurchase(userId, collectionId, { currency: "EUR", purchasedAt: "2026-03-01" });
    const lotId = await createLot(userId, purchase.id, 10);
    const [copy] = await intakeStamps(userId, { lotId }, { stampId, conditionId });
    await markPurchaseArrived(userId, purchase.id, { locationId: bookAId });

    const moves = await movesOf(copy.itemId);
    assert.deepEqual(
      moves.map((m) => [m.source, m.sourceId, m.toLocationId]),
      [
        ["purchase", purchase.id, null],
        ["purchase", purchase.id, bookAId],
      ]
    );
  });

  it("records a write that names no source as another change, and two sources in one transaction apart", async () => {
    const item = await createItem(userId, collectionId, { stampId, conditionId });
    await prisma.item.update({ where: { id: item.id }, data: { locationId: safeId } });
    await prisma.$transaction(async (tx) => {
      await setMoveSourceTx(tx, { source: "replacement" });
      await tx.item.update({ where: { id: item.id }, data: { locationRef: "1" } });
      await setMoveSourceTx(tx, { source: "bulk_edit" });
      await tx.item.update({ where: { id: item.id }, data: { locationRef: "2" } });
    });
    // The setting ended with its transaction: the next bare write is unnamed again.
    await prisma.item.update({ where: { id: item.id }, data: { locationRef: "3" } });

    assert.deepEqual(
      (await movesOf(item.id)).map((m) => [m.source, m.toRef]),
      [
        ["copy_form", null],
        ["other", null],
        ["replacement", "1"],
        ["bulk_edit", "2"],
        ["other", "3"],
      ]
    );
  });

  it("reads a copy's history newest first, with the purchase and the places named", async () => {
    const purchase = await createPurchase(userId, collectionId, { currency: "EUR", purchasedAt: "2026-04-01" });
    const item = await createItem(userId, collectionId, { stampId, conditionId, locationId: bookAId });
    await bulkUpdateLotItems(userId, [item.id], { locationId: bookBId, locationRef: "5" }, {
      source: "purchase",
      sourceId: purchase.id,
    });

    const history = await getCopyLocationMoves(userId, collectionId, item.id);
    assert.equal(history.length, 2);
    const [latest, first] = history;
    assert.equal(latest.source, "purchase");
    assert.equal(latest.named?.kind, "purchase");
    assert.equal(latest.named?.id, purchase.id);
    assert.match(latest.named!.label, /2026-04-01/);
    assert.deepEqual(latest.from, { locationId: bookAId, label: "Szafa › Klaser A", code: "S.A", deleted: false, ref: null });
    assert.deepEqual(latest.to, { locationId: bookBId, label: "Szafa › Klaser B", code: "S.B", deleted: false, ref: "5" });
    assert.equal(first.source, "copy_form");
    assert.equal(latest.copy.stampName, "Chopin");
  });

  it("keeps a deleted location's name on the entries that named it", async () => {
    const shoebox = await prisma.location.create({ data: { collectionId, code: "P", name: "Pudełko" } });
    const item = await createItem(userId, collectionId, { stampId, conditionId, locationId: shoebox.id });
    await updateItem(userId, item.id, { locationId: safeId });
    await deleteLocation(userId, shoebox.id);

    const [latest] = await getCopyLocationMoves(userId, collectionId, item.id);
    assert.deepEqual(latest.from, { locationId: null, label: "Pudełko", code: null, deleted: true, ref: null });
  });

  it("reads a location's history with everything under it, by ref and by day, a page at a time", async () => {
    const item = await createItem(userId, collectionId, { stampId, conditionId });
    await updateItem(userId, item.id, { locationId: bookAId, locationRef: "x9" });
    await updateItem(userId, item.id, { locationId: bookBId, locationRef: "y1" });
    await updateItem(userId, item.id, { locationId: safeId });

    const all: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await listLocationHistory(userId, collectionId, cabinetId, { cursor, pageSize: 2 });
      all.push(...page.items.filter((e) => e.copy.id === item.id).map((e) => e.direction));
      cursor = page.nextCursor;
    } while (cursor);
    // Newest first: out to the safe, within the cabinet (A → B), in from no location.
    assert.deepEqual(all, ["out", "within", "in"]);

    const byRef = await listLocationHistory(userId, collectionId, cabinetId, { ref: "X9" });
    assert.deepEqual(
      byRef.items.map((e) => [e.copy.id, e.direction]),
      [
        [item.id, "within"],
        [item.id, "in"],
      ]
    );

    const bookA = await listLocationHistory(userId, collectionId, bookAId, { ref: "x9" });
    assert.deepEqual(bookA.items.map((e) => e.direction), ["out", "in"]);

    const today = new Date().toISOString().slice(0, 10);
    const none = await listLocationHistory(userId, collectionId, cabinetId, { to: "2020-01-01" });
    assert.equal(none.items.length, 0);
    const todays = await listLocationHistory(userId, collectionId, cabinetId, { from: today, to: today, ref: "y1" });
    assert.equal(todays.items.length, 2);
  });

  it("refuses another collection's location", async () => {
    await assert.rejects(listLocationHistory(userId, otherCollectionId, bookAId), /not found/i);
  });
});
