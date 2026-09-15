import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createHawidStrip,
  getHawidStrips,
  updateHawidStrip,
  HawidStripTakenError,
} from "../../src/lib/hawid-stock";
import { type HawidStripInput } from "../../src/lib/hawid";

// The hawid stock's identity (#796): a strip is its packet number **and its label**.
//
// Two mounts a collector really owns can both be marked 26 mm and be 30 mm and 31 mm tall, because
// the border differs by product line (#793). The index is `NULLS NOT DISTINCT` and hand-written, so
// the one case below that no Prisma-level check could catch is the unlabelled pair: without that
// clause Postgres treats two null labels as different and lets the second one in.

const ts = Date.now();

const input = (
  heightMm: number,
  totalHeightMm: number,
  label: string | null
): HawidStripInput => ({ heightMm, totalHeightMm, stockLengthMm: 210, label });

const isTaken = (pattern: RegExp) => (err: unknown) => {
  assert.ok(err instanceof HawidStripTakenError, `expected HawidStripTakenError, got ${String(err)}`);
  assert.match(err.message, pattern);
  return true;
};

describe("hawid stock identity (#796)", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;

  before(async () => {
    userId = `test-user-hawid-stock-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User hawid-stock-${ts}`,
        email: `test-hawid-stock-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const collection = (slug: string) =>
      prisma.collection.create({
        data: { slug, name: slug, baseCurrency: "EUR", ownerId: userId, defaultLanguage: "en" },
      });
    collectionId = (await collection(`col-hawid-stock-${ts}`)).id;
    otherCollectionId = (await collection(`col-hawid-stock-other-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const stripsOf = async (id: string) =>
    (await getHawidStrips(userId, id)).map((s) => [s.heightMm, s.totalHeightMm, s.label]);

  it("enters two mounts with one packet number when their labels differ", async () => {
    await createHawidStrip(userId, collectionId, input(26, 30, "Hawid 264"));
    await createHawidStrip(userId, collectionId, input(26, 31, "Lindner"));
    assert.deepEqual(await stripsOf(collectionId), [
      [26, 30, "Hawid 264"],
      [26, 31, "Lindner"],
    ]);
  });

  it("refuses a second strip under the same packet number and label, and says to relabel it", async () => {
    await assert.rejects(
      createHawidStrip(userId, collectionId, input(26, 32, "Hawid 264")),
      isTaken(/26 mm strip labelled "Hawid 264" is already in the stock.*label/)
    );
    assert.equal((await stripsOf(collectionId)).length, 2);
  });

  it("lets an unlabelled strip sit beside labelled ones of the same packet number", async () => {
    // `26 mm` and `26 mm (Hawid 264)` are different lines on a cutting list.
    await createHawidStrip(userId, collectionId, input(26, 29, null));
    assert.equal((await stripsOf(collectionId)).length, 3);
  });

  it("refuses a second unlabelled strip of one packet number", async () => {
    // The NULLS NOT DISTINCT control: a plain unique index accepts this row.
    await assert.rejects(
      createHawidStrip(userId, collectionId, input(26, 33, null)),
      isTaken(/26 mm strip with no label is already in the stock.*label/)
    );
    assert.equal((await stripsOf(collectionId)).length, 3);
  });

  it("refuses an edit that makes two strips indistinguishable, and leaves the row as it was", async () => {
    const lindner = (await getHawidStrips(userId, collectionId)).find((s) => s.label === "Lindner");
    assert.ok(lindner);
    await assert.rejects(
      updateHawidStrip(userId, lindner.id, input(26, 31, null)),
      isTaken(/with no label/)
    );
    await assert.rejects(
      updateHawidStrip(userId, lindner.id, input(26, 31, "Hawid 264")),
      isTaken(/labelled "Hawid 264"/)
    );
    // An edit that keeps the row's own identity is not a clash with itself.
    await updateHawidStrip(userId, lindner.id, input(26, 31.5, "Lindner"));
    assert.deepEqual(await stripsOf(collectionId), [
      [26, 30, "Hawid 264"],
      [26, 31.5, "Lindner"],
      [26, 29, null],
    ]);
  });

  it("keeps the identity inside one collection", async () => {
    await createHawidStrip(userId, otherCollectionId, input(26, 29, null));
    await createHawidStrip(userId, otherCollectionId, input(26, 30, "Hawid 264"));
    assert.equal((await stripsOf(otherCollectionId)).length, 2);
  });
});
