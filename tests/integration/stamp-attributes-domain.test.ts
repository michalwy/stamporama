import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createStampAttribute,
  deleteStampAttribute,
  getStampAttributeLists,
  getStampAttributes,
  reorderStampAttributes,
  updateStampAttribute,
  StampAttributeInUseError,
} from "../../src/lib/stamp-attributes";
import { STAMP_ATTRIBUTE_KINDS } from "../../src/lib/stamp-attribute-kinds";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-attrs-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-attrs-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: {
      slug: `col-attrs-${suffix}`,
      name: `Collection ${suffix}`,
      baseCurrency: "EUR",
      ownerId,
    },
  });
}

describe("stamp attribute dictionaries (#72)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`a-${ts}`)).id;
    otherUserId = (await createTestUser(`b-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("starts every dictionary empty — nothing is seeded, because nothing is the usual value", async () => {
    const lists = await getStampAttributeLists(userId, collectionId);
    for (const kind of STAMP_ATTRIBUTE_KINDS) {
      assert.deepEqual(lists[kind], [], kind);
    }
  });

  it("creates, appends, renames, translates and reorders in every dictionary", async () => {
    for (const kind of STAMP_ATTRIBUTE_KINDS) {
      const firstId = await createStampAttribute(userId, collectionId, kind, { name: `${kind} one` });
      const secondId = await createStampAttribute(userId, collectionId, kind, {
        name: `${kind} two`,
        translations: { pl: { name: `${kind} dwa` }, de: { name: "" } },
      });

      let rows = await getStampAttributes(userId, collectionId, kind);
      assert.deepEqual(
        rows.map((r) => [r.id, r.sortOrder]),
        [[firstId, 0], [secondId, 1]],
        `${kind}: a new row is appended`
      );
      // A blank language is not stored; a filled one is.
      assert.deepEqual(rows[1].nameByLanguage, { pl: `${kind} dwa` });

      await updateStampAttribute(userId, kind, secondId, {
        name: `${kind} TWO`,
        translations: { pl: { name: "" }, de: { name: `${kind} zwei` } },
      });
      rows = await getStampAttributes(userId, collectionId, kind);
      assert.equal(rows[1].name, `${kind} TWO`);
      assert.deepEqual(rows[1].nameByLanguage, { de: `${kind} zwei` }, "blank clears, filled adds");

      await reorderStampAttributes(userId, collectionId, kind, [secondId, firstId]);
      rows = await getStampAttributes(userId, collectionId, kind);
      assert.deepEqual(rows.map((r) => r.id), [secondId, firstId]);
    }

    const lists = await getStampAttributeLists(userId, collectionId);
    for (const kind of STAMP_ATTRIBUTE_KINDS) {
      assert.equal(lists[kind].length, 2, kind);
    }
  });

  it("keeps the four dictionaries apart", async () => {
    // Two rows each, and a colour is never listed as a paper.
    const lists = await getStampAttributeLists(userId, collectionId);
    assert.ok(lists.color.every((r) => r.name.startsWith("color")));
    assert.ok(lists.paper.every((r) => r.name.startsWith("paper")));
  });

  it("refuses a reorder that does not name exactly the collection's rows", async () => {
    const [row] = await getStampAttributes(userId, collectionId, "watermark");
    await assert.rejects(() => reorderStampAttributes(userId, collectionId, "watermark", [row.id]));
  });

  it("refuses to delete a row a stamp references, and allows it once the stamp lets go", async () => {
    const lists = await getStampAttributeLists(userId, collectionId);
    const stamp = await prisma.stamp.create({
      data: {
        collectionId,
        denomination: "10 gr",
        perforation: "11½:12",
        colorId: lists.color[0].id,
        watermarkId: lists.watermark[0].id,
        paperId: lists.paper[0].id,
        printingId: lists.printing[0].id,
      },
    });

    for (const kind of STAMP_ATTRIBUTE_KINDS) {
      await assert.rejects(
        () => deleteStampAttribute(userId, kind, lists[kind][0].id),
        (err: unknown) => err instanceof StampAttributeInUseError,
        `${kind} in use`
      );
    }

    await prisma.stamp.update({
      where: { id: stamp.id },
      data: { colorId: null, watermarkId: null, paperId: null, printingId: null },
    });
    for (const kind of STAMP_ATTRIBUTE_KINDS) {
      await deleteStampAttribute(userId, kind, lists[kind][0].id);
      const rows = await getStampAttributes(userId, collectionId, kind);
      assert.equal(rows.length, 1, kind);
    }

    // The two printed facts stay text as printed.
    const reread = await prisma.stamp.findUniqueOrThrow({ where: { id: stamp.id } });
    assert.equal(reread.denomination, "10 gr");
    assert.equal(reread.perforation, "11½:12");
    await prisma.stamp.delete({ where: { id: stamp.id } });
  });

  it("drops a row's translations with the row", async () => {
    const id = await createStampAttribute(userId, collectionId, "printing", {
      name: "Recess",
      translations: { pl: { name: "Staloryt" } },
    });
    assert.equal(await prisma.stampPrintingTranslation.count({ where: { stampPrintingId: id } }), 1);
    await deleteStampAttribute(userId, "printing", id);
    assert.equal(await prisma.stampPrintingTranslation.count({ where: { stampPrintingId: id } }), 0);
  });

  it("is owner-scoped on every path", async () => {
    const [row] = await getStampAttributes(userId, collectionId, "color");
    await assert.rejects(() => getStampAttributeLists(otherUserId, collectionId));
    await assert.rejects(() => createStampAttribute(otherUserId, collectionId, "color", { name: "x" }));
    await assert.rejects(() => updateStampAttribute(otherUserId, "color", row.id, { name: "x" }));
    await assert.rejects(() => deleteStampAttribute(otherUserId, "color", row.id));
    await assert.rejects(() => reorderStampAttributes(otherUserId, collectionId, "color", [row.id]));
  });
});
