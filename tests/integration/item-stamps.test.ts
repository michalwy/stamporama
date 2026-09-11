import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  addItemStamp,
  listItemStamps,
  removeItemStamp,
  setItemStamps,
} from "../../src/lib/item-stamps";
import { createItem, resolveItemVariant, updateItem } from "../../src/lib/items";
import { deleteStamp } from "../../src/lib/stamps";

// The stamps a copy carries (#744, ADR-0044) — the schema, and the one module allowed to write it.
//
// What is pinned here is the pair of derived columns, because they are the whole reason the design
// works: `Item.stampId` is a pointer at the first entry and `Item.stampCount` the summed quantity,
// and #745 makes "a carrier bearing more than one stamp is a copy of none of them" true everywhere
// by reading the second of them as a flat `where`. A count that had drifted from the rows it is
// summed from would take every copy-count, checklist, want and duplicate check with it, silently.
//
// The other half is the ordinary copy: a collection that has never seen a cover must go on behaving
// exactly as it did, which is why a plain create, a variant refinement and a stamp deletion are
// asserted here beside the carrier cases.

describe("the stamps a copy carries (#744)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let coverId: string;
  let blockOfFourId: string;
  let mi200: string;
  let mi201: string;
  let mi205: string;
  /** A base stamp with one variant child, for the refinement path. */
  let baseStampId: string;
  let variantStampId: string;
  /** Another collection's stamp, for the cross-collection refusal. */
  let foreignStampId: string;

  async function newCopy(stampId: string): Promise<string> {
    const copy = await createItem(userId, collectionId, { stampId, conditionId });
    return copy.id;
  }

  async function readCopy(itemId: string) {
    return prisma.item.findUniqueOrThrow({
      where: { id: itemId },
      select: { stampId: true, stampCount: true },
    });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-item-stamps-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User item-stamps-${ts}`,
        email: `test-item-stamps-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-item-stamps-${ts}`,
        name: `Collection item-stamps-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    // The carrier type is an ordinary format row, beside "block of four" (ADR-0044 §5).
    coverId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Cover", abbreviation: "cov", sortOrder: 0 },
      })
    ).id;
    blockOfFourId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Block of four", abbreviation: "blk4", sortOrder: 1 },
      })
    ).id;

    mi200 = (await prisma.stamp.create({ data: { collectionId, name: "Mi 200" } })).id;
    mi201 = (await prisma.stamp.create({ data: { collectionId, name: "Mi 201" } })).id;
    mi205 = (await prisma.stamp.create({ data: { collectionId, name: "Mi 205" } })).id;

    baseStampId = (await prisma.stamp.create({ data: { collectionId, name: "Mi 300" } })).id;
    variantStampId = (
      await prisma.stamp.create({
        data: { collectionId, name: "Mi 300 II", parentId: baseStampId },
      })
    ).id;

    const otherCol = await prisma.collection.create({
      data: {
        slug: `col-item-stamps-other-${ts}`,
        name: `Other collection item-stamps-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    foreignStampId = (
      await prisma.stamp.create({ data: { collectionId: otherCol.id, name: "Elsewhere" } })
    ).id;
  });

  // -------------------------------------------------------------------------
  // The ordinary copy
  // -------------------------------------------------------------------------

  it("gives a newly created copy one entry, and a count of one", async () => {
    const itemId = await newCopy(mi200);

    const entries = await listItemStamps(userId, itemId);
    assert.deepEqual(
      entries.map((e) => ({ stampId: e.stampId, quantity: e.quantity, formatId: e.formatId, sortOrder: e.sortOrder })),
      [{ stampId: mi200, quantity: 1, formatId: null, sortOrder: 0 }]
    );

    const copy = await readCopy(itemId);
    assert.equal(copy.stampId, mi200);
    // One stamp, so the copy is an ordinary copy of it and #745 will count it.
    assert.equal(copy.stampCount, 1);
  });

  it("moves the leading entry when an edit re-points the copy", async () => {
    const itemId = await newCopy(mi200);
    await updateItem(userId, itemId, { stampId: mi201 });

    const entries = await listItemStamps(userId, itemId);
    assert.deepEqual(entries.map((e) => e.stampId), [mi201]);
    assert.equal((await readCopy(itemId)).stampId, mi201);
  });

  it("moves the leading entry when a copy is refined to a variant", async () => {
    const itemId = await newCopy(baseStampId);
    await resolveItemVariant(userId, itemId, variantStampId, "Perforation checked");

    const entries = await listItemStamps(userId, itemId);
    assert.deepEqual(entries.map((e) => e.stampId), [variantStampId]);
    const copy = await readCopy(itemId);
    assert.equal(copy.stampId, variantStampId);
    assert.equal(copy.stampCount, 1);
  });

  // -------------------------------------------------------------------------
  // The carrier
  // -------------------------------------------------------------------------

  it("records a cover franked with three stamps as one copy of three entries", async () => {
    const itemId = await newCopy(mi200);
    // What the piece physically is — a cover — stays on the copy (ADR-0044 §5).
    await updateItem(userId, itemId, { formatId: coverId });

    const entries = await setItemStamps(userId, itemId, [
      { stampId: mi200 },
      { stampId: mi201 },
      { stampId: mi205 },
    ]);
    assert.deepEqual(entries.map((e) => e.stampId), [mi200, mi201, mi205]);
    assert.deepEqual(entries.map((e) => e.sortOrder), [0, 1, 2]);

    const copy = await readCopy(itemId);
    assert.equal(copy.stampId, mi200, "the pointer is the first entry");
    assert.equal(copy.stampCount, 3);
    assert.equal(
      (await prisma.item.findUniqueOrThrow({ where: { id: itemId }, select: { formatId: true } }))
        .formatId,
      coverId
    );
  });

  it("keeps the order the collector gave, pointer included", async () => {
    const itemId = await newCopy(mi200);
    await setItemStamps(userId, itemId, [{ stampId: mi205 }, { stampId: mi200 }]);

    assert.deepEqual((await listItemStamps(userId, itemId)).map((e) => e.stampId), [mi205, mi200]);
    assert.equal((await readCopy(itemId)).stampId, mi205);
  });

  it("counts described components, not sheets of paper", async () => {
    const itemId = await newCopy(mi200);
    // A block of four *on* the cover is one component of quantity 1 with the block format, never
    // four (ADR-0044 §4); the same stamp twice loose is one entry of quantity 2.
    await setItemStamps(userId, itemId, [
      { stampId: mi200, formatId: blockOfFourId },
      { stampId: mi201, quantity: 2 },
    ]);

    const copy = await readCopy(itemId);
    assert.equal(copy.stampCount, 3);
    assert.deepEqual(
      (await listItemStamps(userId, itemId)).map((e) => [e.quantity, e.formatId]),
      [
        [1, blockOfFourId],
        [2, null],
      ]
    );
  });

  it("holds the same stamp twice when the two components differ in format", async () => {
    const itemId = await newCopy(mi200);
    const entries = await setItemStamps(userId, itemId, [
      { stampId: mi200 },
      { stampId: mi200, formatId: blockOfFourId },
    ]);
    assert.equal(entries.length, 2);
    assert.equal((await readCopy(itemId)).stampCount, 2);
  });

  // -------------------------------------------------------------------------
  // Adding and removing, and the two columns keeping step
  // -------------------------------------------------------------------------

  it("adds a stamp to the end and takes it off again, the count following each time", async () => {
    const itemId = await newCopy(mi200);
    assert.equal((await readCopy(itemId)).stampCount, 1);

    await addItemStamp(userId, itemId, { stampId: mi201, quantity: 2 });
    let copy = await readCopy(itemId);
    assert.equal(copy.stampCount, 3, "one plus two");
    assert.equal(copy.stampId, mi200, "appending does not move the pointer");

    const entries = await listItemStamps(userId, itemId);
    const added = entries.find((e) => e.stampId === mi201)!;
    const remaining = await removeItemStamp(userId, itemId, added.id);

    assert.deepEqual(remaining.map((e) => e.stampId), [mi200]);
    copy = await readCopy(itemId);
    assert.equal(copy.stampCount, 1, "back to an ordinary copy of one stamp");
    assert.equal(copy.stampId, mi200);
  });

  it("re-numbers the positions when an entry in the middle is removed", async () => {
    const itemId = await newCopy(mi200);
    await setItemStamps(userId, itemId, [
      { stampId: mi200 },
      { stampId: mi201 },
      { stampId: mi205 },
    ]);
    const middle = (await listItemStamps(userId, itemId)).find((e) => e.stampId === mi201)!;

    const remaining = await removeItemStamp(userId, itemId, middle.id);
    assert.deepEqual(remaining.map((e) => e.sortOrder), [0, 1], "no gap is left behind");
    assert.deepEqual(remaining.map((e) => e.stampId), [mi200, mi205]);
  });

  it("moves the pointer when the leading entry is the one removed", async () => {
    const itemId = await newCopy(mi200);
    await setItemStamps(userId, itemId, [{ stampId: mi200 }, { stampId: mi201 }]);
    const leading = (await listItemStamps(userId, itemId))[0];

    await removeItemStamp(userId, itemId, leading.id);
    const copy = await readCopy(itemId);
    assert.equal(copy.stampId, mi201);
    assert.equal(copy.stampCount, 1);
  });

  it("refuses to take the last stamp off a copy", async () => {
    const itemId = await newCopy(mi200);
    const [only] = await listItemStamps(userId, itemId);
    await assert.rejects(
      () => removeItemStamp(userId, itemId, only.id),
      /at least one stamp/
    );
    assert.equal((await listItemStamps(userId, itemId)).length, 1);
  });

  it("refuses an empty list", async () => {
    const itemId = await newCopy(mi200);
    await assert.rejects(() => setItemStamps(userId, itemId, []), /at least one stamp/);
    assert.equal((await readCopy(itemId)).stampCount, 1);
  });

  // -------------------------------------------------------------------------
  // What the database refuses
  // -------------------------------------------------------------------------

  it("refuses the same stamp twice in the same format — in the module and in the index", async () => {
    const itemId = await newCopy(mi200);
    await assert.rejects(
      () => setItemStamps(userId, itemId, [{ stampId: mi200 }, { stampId: mi200 }]),
      /already on this copy/
    );

    // And the index behind it, which is the authority: two concurrent saves cannot both pass the
    // check above, so `item_stamp_unique` has to be the thing that actually cannot be got past. It
    // needs `NULLS NOT DISTINCT` to see two null formats as the same value, which is exactly what a
    // plain unique index would not do.
    const [existing] = await listItemStamps(userId, itemId);
    await assert.rejects(
      () =>
        prisma.itemStamp.create({
          data: { itemId, stampId: existing.stampId, quantity: 1, formatId: null, sortOrder: 1 },
        }),
      /Unique constraint|item_stamp_unique/
    );
  });

  it("refuses a quantity below one, and a fractional one", async () => {
    const itemId = await newCopy(mi200);
    await assert.rejects(
      () => setItemStamps(userId, itemId, [{ stampId: mi200, quantity: 0 }]),
      /at least 1/
    );
    await assert.rejects(
      () => setItemStamps(userId, itemId, [{ stampId: mi200, quantity: 1.5 }]),
      /at least 1/
    );
  });

  it("refuses a stamp from another collection", async () => {
    const itemId = await newCopy(mi200);
    await assert.rejects(
      () => setItemStamps(userId, itemId, [{ stampId: mi200 }, { stampId: foreignStampId }]),
      /not found in this collection/
    );
    assert.equal((await readCopy(itemId)).stampCount, 1, "nothing was written");
  });

  it("refuses a caller who does not own the collection", async () => {
    const itemId = await newCopy(mi200);
    await assert.rejects(
      () => setItemStamps("someone-else", itemId, [{ stampId: mi201 }]),
      /access denied/
    );
  });

  // -------------------------------------------------------------------------
  // Deleting a stamp
  // -------------------------------------------------------------------------

  it("still deletes an ordinary copy along with its stamp", async () => {
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mi 900" } })).id;
    const itemId = await newCopy(stampId);

    await deleteStamp(userId, stampId);

    assert.equal(await prisma.item.count({ where: { id: itemId } }), 0);
    assert.equal(await prisma.itemStamp.count({ where: { itemId } }), 0);
  });

  // The refusal is the application's, not a constraint's: `ItemStamp.stampId` cascades, because a
  // RESTRICT there is checked before the cascades queued beside it and fired on every ordinary copy
  // (see the migration). So this is the test that the rule survived being moved a layer up.
  it("refuses to delete a stamp another piece carries", async () => {
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mi 901" } })).id;
    const carrierId = await newCopy(mi200);
    await setItemStamps(userId, carrierId, [{ stampId: mi200 }, { stampId }]);

    await assert.rejects(() => deleteStamp(userId, stampId), /one of the stamps on copy/);

    // The refusal rolls the whole transaction back: the stamp is still there, and so is the cover.
    assert.equal(await prisma.stamp.count({ where: { id: stampId } }), 1);
    assert.equal((await listItemStamps(userId, carrierId)).length, 2);
  });

  it("takes a carrier's entries with it when the copy itself is deleted", async () => {
    const itemId = await newCopy(mi200);
    await setItemStamps(userId, itemId, [{ stampId: mi200 }, { stampId: mi201 }]);

    await prisma.item.delete({ where: { id: itemId } });
    assert.equal(await prisma.itemStamp.count({ where: { itemId } }), 0);
  });

  it("lets a collection holding a carrier be deleted outright", async () => {
    // The case that decided the referential action. Deleting a collection cascades into `stamp`
    // before it reaches `item`, so a RESTRICT on the entry's stamp made the collection permanently
    // undeletable — the guard fired on entries that were about to be cascaded away anyway.
    const ts = Date.now();
    const doomed = await prisma.collection.create({
      data: {
        slug: `col-item-stamps-doomed-${ts}`,
        name: `Doomed item-stamps-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    const grade = await prisma.stampCondition.create({
      data: { collectionId: doomed.id, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    const one = await prisma.stamp.create({ data: { collectionId: doomed.id, name: "A" } });
    const two = await prisma.stamp.create({ data: { collectionId: doomed.id, name: "B" } });
    const copy = await createItem(userId, doomed.id, {
      stampId: one.id,
      conditionId: grade.id,
    });
    await setItemStamps(userId, copy.id, [{ stampId: one.id }, { stampId: two.id }]);

    await prisma.collection.delete({ where: { id: doomed.id } });
    assert.equal(await prisma.itemStamp.count({ where: { itemId: copy.id } }), 0);
  });
});
