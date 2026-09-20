import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";

// The whitespace rule where it is guaranteed rather than merely applied (#1357): the Prisma client
// extension in `src/lib/db.ts`, over a real database. The field's own half is `shared/text-input.tsx`
// and the rule itself is unit-tested in `tests/unit/prisma-text-trim.test.ts`; what only a database
// can show is that the trimmed value is the value that comes back out.

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-trim-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-trim-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

describe("the whitespace around typed text", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`${ts}`)).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-trim-${ts}`, name: `Trim ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("is gone from a created row, and from every column of it", async () => {
    const area = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "  Poland  ",
        description: " A stray space before and after. ",
        catalogPrefix: "PL ",
        sortOrder: 0,
      },
    });
    assert.equal(area.name, "Poland");
    assert.equal(area.description, "A stray space before and after.");
    assert.equal(area.catalogPrefix, "PL");
  });

  it("is gone from an update, and from an upsert's create and update alike", async () => {
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Before", sortOrder: 1 },
    });
    const updated = await prisma.collectionArea.update({
      where: { id: area.id },
      data: { name: "  After  " },
    });
    assert.equal(updated.name, "After");

    const created = await prisma.contact.upsert({
      where: { id: "no-such-contact-id" },
      create: { collectionId, name: "  Upserted in  " },
      update: { name: "  Upserted out  " },
    });
    assert.equal(created.name, "Upserted in");
    const changed = await prisma.contact.upsert({
      where: { id: created.id },
      create: { collectionId, name: "  never  " },
      update: { name: "  Upserted out  " },
    });
    assert.equal(changed.name, "Upserted out");
  });

  it("is gone from a row written through a nested create", async () => {
    const area = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "Nested",
        sortOrder: 2,
        translations: { create: [{ language: "pl", titleName: "  Polska  " }] },
      },
      include: { translations: true },
    });
    assert.equal(area.translations[0].titleName, "Polska");
  });

  it("leaves the line breaks and indentation inside a longer text exactly as typed", async () => {
    const body = "First line\n\n    indented\n  less indented\n\nlast";
    const contact = await prisma.contact.create({
      data: { collectionId, name: "Multi-line", notes: `\n  ${body}\n \n` },
    });
    assert.equal(contact.notes, body);
    assert.equal(contact.notes?.split("\n").length, body.split("\n").length);
  });

  it("stores a value of nothing but whitespace as an empty one", async () => {
    // Required and optional alike arrive as `''`, so *typed spaces* and *empty* are one state. The
    // rule stops there: `''` is a statement of its own for a vendor's prefix (`area-prefix.ts`).
    const contact = await prisma.contact.create({
      data: { collectionId, name: "Blanks", notes: "   \n  " },
    });
    assert.equal(contact.notes, "");

    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "   ", sortOrder: 3 },
    });
    assert.equal(area.name, "");
  });

  it("does not reach inside a Json column's value", async () => {
    const value = { values: ["  spaced on purpose  "], rangeValue: { from: " 1 " } };
    const row = await prisma.allegroCategoryParameterMemory.create({
      data: {
        collectionId,
        platformId,
        categoryId: " 123 ",
        parameterId: "456",
        parameterName: "  Condition  ",
        value,
      },
    });
    // The two `String` columns beside it are trimmed; the `Json` one is not touched at all.
    assert.equal(row.categoryId, "123");
    assert.equal(row.parameterName, "Condition");
    assert.deepEqual(row.value, value);
  });

  it("leaves a query's own `where` alone, so a read still asks what it was asked", async () => {
    await prisma.contact.create({ data: { collectionId, name: "Findable" } });
    const spaced = await prisma.contact.findMany({
      where: { collectionId, name: "  Findable  " },
    });
    assert.equal(spaced.length, 0, "the where clause is the caller's question, not ours to rewrite");
    const exact = await prisma.contact.findMany({ where: { collectionId, name: "Findable" } });
    assert.equal(exact.length, 1);
  });
});
