import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, getItemStamps, getItemVariantHistory, updateItem } from "../../src/lib/items";
import { listItemStamps } from "../../src/lib/item-stamps";

// **Editing the stamps a copy carries** (#746, ADR-0044) — the path the copy dialog takes: one save
// that carries the copy's own fields *and* the whole list of stamps on the piece.
//
// One save is the point of most of what is pinned here. The stamps and the condition go in the same
// transaction, so a copy cannot come out of a save carrying the old cover's stamps and the new one's
// condition; and a refusal — a stamp from another collection, the same stamp twice in one format —
// leaves every field as it was rather than landing half of the edit.
//
// The other half is **refinement history**. It records this copy being decided to be a *different*
// stamp (ADR-0007 §6), and the entry list can move the pointer without anything of the kind having
// happened: dragging another of the piece's stamps to the front, or striking the leading one off it,
// is a statement about the piece and not a re-identification of it.

const ts = Date.now();

describe("editing the stamps a copy carries (#746)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let vendorId: string;
  let usedId: string;
  let mnhId: string;
  let coverId: string;
  let blockId: string;
  let issueId: string;
  let mi200: string, mi201: string, mi205: string;
  let foreignStampId: string;

  async function newCopy(stampId: string): Promise<string> {
    const copy = await createItem(userId, collectionId, { stampId, conditionId: usedId });
    return copy.id;
  }

  async function readCopy(itemId: string) {
    return prisma.item.findUniqueOrThrow({
      where: { id: itemId },
      select: { stampId: true, stampCount: true, conditionId: true, notes: true },
    });
  }

  before(async () => {
    userId = `test-user-stamp-editor-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User stamp-editor-${ts}`,
        email: `test-stamp-editor-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-stamp-editor-${ts}`,
          name: "Editing carriers",
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint never hinged", abbreviation: "MNH", sortOrder: 1 },
      })
    ).id;
    coverId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Cover", abbreviation: "cov", sortOrder: 0 },
      })
    ).id;
    blockId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Block of four", abbreviation: "Blk4", sortOrder: 1 },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        // Past the collection's counter: this row bypasses `allocateEntityNumber` (#432).
        data: { collectionId, issueNo: 9401, collectionAreaId: areaId, name: "Chopin", year: 1949 },
      })
    ).id;

    const ids: string[] = [];
    for (const n of ["200", "201", "205"]) {
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name: `Chopin ${n}`,
          catalogNumbers: { create: [{ catalogVendorId: vendorId, number: n }] },
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      });
      ids.push(stamp.id);
    }
    [mi200, mi201, mi205] = ids;
    await prisma.issueMember.createMany({
      data: ids.map((stampId, i) => ({ issueId, stampId, sortOrder: i })),
    });

    const otherCol = await prisma.collection.create({
      data: {
        slug: `col-stamp-editor-other-${ts}`,
        name: "Elsewhere",
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    foreignStampId = (
      await prisma.stamp.create({ data: { collectionId: otherCol.id, name: "Elsewhere" } })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  // -------------------------------------------------------------------------
  // One save
  // -------------------------------------------------------------------------

  it("gives a copy several stamps and its carrier type in one save", async () => {
    const itemId = await newCopy(mi200);
    const { item } = await updateItem(userId, itemId, {
      // What the piece physically *is* stays the copy's own format (ADR-0044 §5)…
      formatId: coverId,
      conditionId: mnhId,
      notes: "Registered, Kraków → Wien",
      stampId: mi200,
      // …and what it carries is the entry list, saved in the same breath.
      stamps: [
        { stampId: mi200 },
        { stampId: mi201, formatId: blockId },
        { stampId: mi205, quantity: 2 },
      ],
    });

    assert.equal(item.formatId, coverId);
    assert.equal(item.conditionId, mnhId);
    assert.equal(item.stampId, mi200, "the copy comes back pointing where the entries put it");
    // 1 + 1 + 2: the block of four is **one** described component (ADR-0044 §4).
    const copy = await readCopy(itemId);
    assert.equal(copy.stampCount, 4);
    assert.equal(copy.stampId, mi200, "the pointer is the first entry");
    assert.deepEqual(
      (await listItemStamps(userId, itemId)).map((e) => [e.stampId, e.quantity, e.formatId]),
      [
        [mi200, 1, null],
        [mi201, 1, blockId],
        [mi205, 2, null],
      ]
    );
  });

  it("reads the entries back labelled, in the collector's order", async () => {
    const itemId = await newCopy(mi200);
    await updateItem(userId, itemId, {
      stampId: mi205,
      stamps: [{ stampId: mi205 }, { stampId: mi200, formatId: blockId, quantity: 3 }],
    });

    const read = await getItemStamps(userId, itemId);
    assert.equal(read.stampCount, 4);
    assert.equal(read.multiStamp, true);
    assert.deepEqual(
      read.entries.map((e) => [
        e.stampName,
        e.catalogNumbers.map((cn) => cn.number),
        e.formatName,
        e.quantity,
        e.sortOrder,
      ]),
      [
        ["Chopin 205", ["205"], null, 1, 0],
        ["Chopin 200", ["200"], "Block of four", 3, 1],
      ]
    );
    // The context a copy row shows, so the dialog and the row it was opened from name one issue.
    assert.deepEqual(
      read.entries.map((e) => [e.areaId, e.issueId, e.issueName]),
      [
        [areaId, issueId, "Chopin"],
        [areaId, issueId, "Chopin"],
      ]
    );
  });

  it("takes the piece back down to one stamp, and says so", async () => {
    const itemId = await newCopy(mi200);
    await updateItem(userId, itemId, {
      stampId: mi200,
      stamps: [{ stampId: mi200 }, { stampId: mi201 }],
    });
    assert.equal((await getItemStamps(userId, itemId)).multiStamp, true);

    await updateItem(userId, itemId, { stampId: mi201, stamps: [{ stampId: mi201 }] });
    const read = await getItemStamps(userId, itemId);
    assert.equal(read.multiStamp, false);
    assert.equal(read.stampCount, 1);
    assert.deepEqual(
      read.entries.map((e) => e.stampId),
      [mi201]
    );
    assert.equal((await readCopy(itemId)).stampId, mi201);
  });

  it("leaves the entries alone when a save says nothing about them", async () => {
    const itemId = await newCopy(mi200);
    await updateItem(userId, itemId, {
      stampId: mi200,
      stamps: [{ stampId: mi200 }, { stampId: mi201 }],
    });

    // Every other caller of `updateItem` — the bulk edits, intake, a disposal — has no opinion on
    // the stamps, and an absent list must not read as "take them off".
    await updateItem(userId, itemId, { notes: "Bought at the Kraków fair" });
    const copy = await readCopy(itemId);
    assert.equal(copy.notes, "Bought at the Kraków fair");
    assert.equal(copy.stampCount, 2);
    assert.equal((await listItemStamps(userId, itemId)).length, 2);
  });

  // -------------------------------------------------------------------------
  // A refusal leaves nothing behind
  // -------------------------------------------------------------------------

  it("writes no field at all when the entry list is refused", async () => {
    const itemId = await newCopy(mi200);

    await assert.rejects(
      () =>
        updateItem(userId, itemId, {
          conditionId: mnhId,
          notes: "Should not land",
          stampId: mi200,
          stamps: [{ stampId: mi200 }, { stampId: foreignStampId }],
        }),
      /not found in this collection/
    );
    let copy = await readCopy(itemId);
    assert.equal(copy.conditionId, usedId, "the copy's own fields are untouched");
    assert.equal(copy.notes, null);
    assert.equal(copy.stampCount, 1);

    await assert.rejects(
      () =>
        updateItem(userId, itemId, {
          notes: "Nor this",
          stampId: mi200,
          stamps: [{ stampId: mi200 }, { stampId: mi200 }],
        }),
      /already on this copy/
    );
    copy = await readCopy(itemId);
    assert.equal(copy.notes, null);
    assert.equal((await listItemStamps(userId, itemId)).length, 1);
  });

  // -------------------------------------------------------------------------
  // Refinement history: a re-identification, not a reorder
  // -------------------------------------------------------------------------

  it("records a refinement when the piece is decided to be a stamp it was not carrying", async () => {
    const itemId = await newCopy(mi200);
    await updateItem(userId, itemId, { stampId: mi201, stamps: [{ stampId: mi201 }] });

    const history = await getItemVariantHistory(userId, itemId);
    assert.equal(history.length, 1);
    assert.equal(history[0].fromStampId, mi200);
    assert.equal(history[0].toStampId, mi201);
  });

  it("records none when the pointer moves because the piece was reordered", async () => {
    const itemId = await newCopy(mi200);
    await updateItem(userId, itemId, {
      stampId: mi200,
      stamps: [{ stampId: mi200 }, { stampId: mi205 }],
    });
    assert.equal((await getItemVariantHistory(userId, itemId)).length, 0);

    // Mi 205 to the front: the pointer moves, and nothing about the piece was re-identified.
    await updateItem(userId, itemId, {
      stampId: mi205,
      stamps: [{ stampId: mi205 }, { stampId: mi200 }],
    });
    assert.equal((await readCopy(itemId)).stampId, mi205);
    assert.deepEqual(await getItemVariantHistory(userId, itemId), []);
  });

  it("records none when the leading stamp is simply not on the piece after all", async () => {
    const itemId = await newCopy(mi200);
    await updateItem(userId, itemId, {
      stampId: mi200,
      stamps: [{ stampId: mi200 }, { stampId: mi205 }],
    });

    await updateItem(userId, itemId, { stampId: mi205, stamps: [{ stampId: mi205 }] });
    const copy = await readCopy(itemId);
    assert.equal(copy.stampId, mi205);
    assert.equal(copy.stampCount, 1);
    assert.deepEqual(await getItemVariantHistory(userId, itemId), []);
  });

  it("refuses a caller who does not own the copy", async () => {
    const itemId = await newCopy(mi200);
    await assert.rejects(
      () => updateItem("someone-else", itemId, { stamps: [{ stampId: mi201 }] }),
      /access denied/
    );
    await assert.rejects(() => getItemStamps("someone-else", itemId), /access denied/);
  });
});
