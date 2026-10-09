import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createCollageTemplate,
  duplicateCollageTemplate,
  getCollageTemplates,
} from "../../src/lib/collage-templates";
import type { CollageTemplateInput } from "../../src/lib/collage-template-rules";

// The Collage templates page in Settings (#1477): a template is created and duplicated with its id
// handed back, so the page can select what it just made.
//
// What is pinned:
//
// - a duplicate carries **every** value and takes the first free *(copy)* name, counting on;
// - editing the copy leaves its source alone — nothing links the two;
// - a template cannot be duplicated by a collector who does not own its collection.

const ts = Date.now();

describe("collage template duplicate (#1477)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let sourceId: string;

  const values: Omit<CollageTemplateInput, "name"> = {
    gridMode: "auto",
    gridShape: "portrait",
    pairSides: true,
    rows: 4,
    columns: 5,
    gapPercent: 7,
    background: "#223344",
    labelPercent: 1.7,
  };

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

  before(async () => {
    userId = `test-user-collage-dup-${ts}`;
    strangerId = `test-user-collage-dup-other-${ts}`;
    await user(userId);
    await user(strangerId);
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-collage-dup-${ts}`,
          name: "Collage dup",
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "en",
        },
      })
    ).id;
    sourceId = await createCollageTemplate(userId, collectionId, { name: "Definitives", ...values });
  });

  after(async () => {
    await prisma.collageTemplate.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("hands back the id of the template it created", async () => {
    const templates = await getCollageTemplates(userId, collectionId);
    assert.equal(templates.find((t) => t.id === sourceId)?.name, "Definitives");
  });

  it("copies every value under the first free (copy) name, and counts on", async () => {
    const firstId = await duplicateCollageTemplate(userId, sourceId);
    const secondId = await duplicateCollageTemplate(userId, sourceId);
    const templates = await getCollageTemplates(userId, collectionId);
    const first = templates.find((t) => t.id === firstId)!;
    const second = templates.find((t) => t.id === secondId)!;
    assert.equal(first.name, "Definitives (copy)");
    assert.equal(second.name, "Definitives (copy 2)");
    assert.deepEqual(
      {
        gridMode: first.gridMode,
        gridShape: first.gridShape,
        pairSides: first.pairSides,
        rows: first.rows,
        columns: first.columns,
        gapPercent: first.gapPercent,
        background: first.background,
        labelPercent: first.labelPercent,
      },
      values
    );
  });

  it("leaves the source alone when the copy is edited", async () => {
    const copyId = await duplicateCollageTemplate(userId, sourceId);
    await prisma.collageTemplate.update({ where: { id: copyId }, data: { rows: 1 } });
    const templates = await getCollageTemplates(userId, collectionId);
    assert.equal(templates.find((t) => t.id === sourceId)?.rows, 4);
    assert.equal(templates.length, 4);
  });

  it("refuses a collector who does not own the collection", async () => {
    await assert.rejects(duplicateCollageTemplate(strangerId, sourceId));
    assert.equal((await getCollageTemplates(userId, collectionId)).length, 4);
  });
});
