import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createAlbumTemplate,
  duplicateAlbumTemplate,
  getAlbumTemplate,
  getAlbumTemplates,
} from "../../src/lib/album-templates";
import { DEFAULT_ALBUM_PRESET, albumRenderPreset } from "../../src/lib/album-template-rules";

// The Album templates page in Settings (#1474): a template is created and duplicated with its id
// handed back, so the page can select what it just made, and a stored template is read one at a
// time for the preview beside the list.
//
// What is pinned:
//
// - a duplicate carries **every** preset value and takes the first free *(copy)* name, counting on
//   rather than colliding with the unique name;
// - editing the copy leaves its source alone — nothing links the two;
// - a template is read only inside its own collection, so a preview cannot be pointed at another
//   collector's template by its id.

const ts = Date.now();

describe("album template duplicate and read (#1474)", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let sourceId: string;

  const values = { ...DEFAULT_ALBUM_PRESET, marginLeftMm: 22, titleSizePt: 19, printPhotos: false };

  before(async () => {
    userId = `test-user-tpl-dup-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User tpl-dup-${ts}`,
        email: `test-tpl-dup-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const collection = (slug: string) =>
      prisma.collection.create({
        data: { slug, name: slug, baseCurrency: "EUR", ownerId: userId, defaultLanguage: "en" },
      });
    collectionId = (await collection(`col-tpl-dup-${ts}`)).id;
    otherCollectionId = (await collection(`col-tpl-dup-other-${ts}`)).id;
    sourceId = await createAlbumTemplate(userId, collectionId, { name: "Polska A4", ...values });
  });

  after(async () => {
    await prisma.albumTemplate.deleteMany({
      where: { collectionId: { in: [collectionId, otherCollectionId] } },
    });
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("hands back the id of the template it created", async () => {
    const read = await getAlbumTemplate(userId, collectionId, sourceId);
    assert.equal(read?.name, "Polska A4");
  });

  it("copies every value under the first free (copy) name, and counts on", async () => {
    const firstId = await duplicateAlbumTemplate(userId, sourceId);
    const secondId = await duplicateAlbumTemplate(userId, sourceId);
    const first = await getAlbumTemplate(userId, collectionId, firstId);
    const second = await getAlbumTemplate(userId, collectionId, secondId);
    assert.equal(first?.name, "Polska A4 (copy)");
    assert.equal(second?.name, "Polska A4 (copy 2)");
    assert.deepEqual(albumRenderPreset(first!), albumRenderPreset(values));
  });

  it("leaves the source alone when the copy is edited", async () => {
    const copyId = await duplicateAlbumTemplate(userId, sourceId);
    await prisma.albumTemplate.update({ where: { id: copyId }, data: { marginLeftMm: 5 } });
    const source = await getAlbumTemplate(userId, collectionId, sourceId);
    assert.equal(source?.marginLeftMm, 22);
    assert.equal((await getAlbumTemplates(userId, collectionId)).length, 4);
  });

  it("reads a template only inside its own collection", async () => {
    assert.equal(await getAlbumTemplate(userId, otherCollectionId, sourceId), null);
  });
});
