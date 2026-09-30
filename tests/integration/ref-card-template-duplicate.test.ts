import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createRefCardTemplate,
  duplicateRefCardTemplate,
  getRefCardTemplates,
} from "../../src/lib/ref-card-templates";

// The Ref card templates page in Settings (#1478): a template is created and duplicated with its id
// handed back, so the page can select what it just made.
//
// What is pinned:
//
// - a duplicate carries every measurement and takes the first free *(copy)* name, counting on rather
//   than colliding with the unique name;
// - editing the copy leaves its source alone — nothing links the two;
// - another collector cannot duplicate a template by its id.

const ts = Date.now();

describe("ref card template create and duplicate (#1478)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let sourceId: string;

  const values = { cardWidthMm: 62.5, cardHeightMm: 30, fontSizeMm: 7, paddingTopMm: 2.5 };

  before(async () => {
    const user = (id: string) =>
      prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    userId = (await user(`test-user-refcard-dup-${ts}`)).id;
    strangerId = (await user(`test-user-refcard-dup-other-${ts}`)).id;
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-refcard-dup-${ts}`,
          name: "Ref card dup",
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "en",
        },
      })
    ).id;
    sourceId = await createRefCardTemplate(userId, collectionId, { name: "Pocket", ...values });
  });

  after(async () => {
    await prisma.refCardTemplate.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("hands back the id of the template it created", async () => {
    const templates = await getRefCardTemplates(userId, collectionId);
    assert.equal(templates.find((t) => t.id === sourceId)?.name, "Pocket");
  });

  it("copies every measurement under the first free (copy) name, and counts on", async () => {
    const firstId = await duplicateRefCardTemplate(userId, sourceId);
    const secondId = await duplicateRefCardTemplate(userId, sourceId);
    const templates = await getRefCardTemplates(userId, collectionId);
    const first = templates.find((t) => t.id === firstId)!;
    const second = templates.find((t) => t.id === secondId)!;
    assert.equal(first.name, "Pocket (copy)");
    assert.equal(second.name, "Pocket (copy 2)");
    assert.deepEqual(
      {
        cardWidthMm: first.cardWidthMm,
        cardHeightMm: first.cardHeightMm,
        fontSizeMm: first.fontSizeMm,
        paddingTopMm: first.paddingTopMm,
      },
      values
    );
  });

  it("leaves the source alone when the copy is edited", async () => {
    const copyId = await duplicateRefCardTemplate(userId, sourceId);
    await prisma.refCardTemplate.update({ where: { id: copyId }, data: { cardWidthMm: 40 } });
    const templates = await getRefCardTemplates(userId, collectionId);
    assert.equal(templates.find((t) => t.id === sourceId)?.cardWidthMm, 62.5);
    assert.equal(templates.length, 4);
  });

  it("refuses a duplicate asked for by someone else", async () => {
    await assert.rejects(() => duplicateRefCardTemplate(strangerId, sourceId));
  });
});
