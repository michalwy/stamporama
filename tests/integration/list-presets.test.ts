import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createListPreset,
  deleteListPreset,
  listListPresets,
  ListPresetNameTakenError,
  renameListPreset,
  updateListPresetView,
} from "../../src/lib/list-presets";
import type { ListView } from "../../src/lib/list-views";

// Filter presets on every list (#2487) — the server half. What the pure round trip in
// `tests/unit/list-views.test.ts` cannot reach: that a preset is collection data, scoped and
// owner-checked; that each list sees only its own; that a name is unique within its list; that the
// view comes back byte for byte (a search phrase's spaces included, which the text-trim extension
// must leave alone inside a Json column); and that a record deleted since is dropped on the way out
// and named as it was when the preset was saved.

const ts = Date.now();

function view(params: Record<string, string>, stored: Record<string, string> = {}): ListView {
  return { params, stored, local: {} };
}

describe("filter presets (#2487)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let tagA: string;
  let tagB: string;

  before(async () => {
    userId = `test-user-listpreset-${ts}`;
    otherUserId = `test-user-listpreset-other-${ts}`;
    for (const [id, tag] of [
      [userId, "listpreset"],
      [otherUserId, "listpreset-other"],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${tag}-${ts}`,
          email: `test-${tag}-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-listpreset-${ts}`, name: "Presets", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    tagA = (await prisma.tag.create({ data: { collectionId, name: "Rare" } })).id;
    tagB = (await prisma.tag.create({ data: { collectionId, name: "Keep" } })).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("keeps each list's presets apart, by name, and the view exactly as saved", async () => {
    const saved = view(
      { tagIds: `${tagA},${tagB}`, search: "  PRL  ", sortBy: "name" },
      { groupMode: "issue" }
    );
    await createListPreset(userId, collectionId, "copies", {
      name: "zeta",
      view: saved,
      refs: { tagIds: "tag" },
    });
    await createListPreset(userId, collectionId, "copies", { name: "Alpha", view: view({}), refs: {} });
    await createListPreset(userId, collectionId, "offers", { name: "Offers one", view: view({}), refs: {} });

    const copies = await listListPresets(userId, collectionId, "copies");
    assert.deepEqual(
      copies.map((p) => p.name),
      ["Alpha", "zeta"]
    );
    assert.deepEqual(copies[1].view, saved);
    assert.deepEqual(copies[1].dropped, []);
    assert.deepEqual(
      (await listListPresets(userId, collectionId, "offers")).map((p) => p.name),
      ["Offers one"]
    );
  });

  it("refuses a name already taken on the same list, and allows it on another", async () => {
    await assert.rejects(
      createListPreset(userId, collectionId, "copies", { name: " Alpha ", view: view({}), refs: {} }),
      ListPresetNameTakenError
    );
    await createListPreset(userId, collectionId, "sales", { name: "Alpha", view: view({}), refs: {} });
  });

  it("drops a deleted record on the way out and names it as it was saved", async () => {
    const id = (
      await createListPreset(userId, collectionId, "stamps", {
        name: "Tagged",
        view: view({ tagIds: `${tagA},${tagB}`, areaId: "none" }),
        refs: { tagIds: "tag", areaId: "area" },
      })
    ).id;
    await prisma.tag.delete({ where: { id: tagA } });
    const preset = (await listListPresets(userId, collectionId, "stamps")).find((p) => p.id === id);
    assert.ok(preset);
    assert.deepEqual(preset.view.params, { tagIds: tagB, areaId: "none" });
    assert.deepEqual(preset.dropped, ["tag “Rare”"]);
  });

  it("updates the view whole, renames, and deletes", async () => {
    const id = (
      await createListPreset(userId, collectionId, "trades", {
        name: "Open",
        view: view({ status: "open", partner: "x" }),
        refs: {},
      })
    ).id;
    await updateListPresetView(userId, id, { view: view({ status: "closed" }), refs: {} });
    await renameListPreset(userId, id, "Closed");
    let presets = await listListPresets(userId, collectionId, "trades");
    assert.deepEqual(
      presets.map((p) => [p.name, p.view.params]),
      [["Closed", { status: "closed" }]]
    );
    await deleteListPreset(userId, id);
    presets = await listListPresets(userId, collectionId, "trades");
    assert.equal(presets.length, 0);
  });

  it("is the collection owner's alone", async () => {
    await assert.rejects(listListPresets(otherUserId, collectionId, "copies"));
    await assert.rejects(
      createListPreset(otherUserId, collectionId, "copies", { name: "x", view: view({}), refs: {} })
    );
    const [preset] = await listListPresets(userId, collectionId, "copies");
    await assert.rejects(renameListPreset(otherUserId, preset.id, "y"));
    await assert.rejects(deleteListPreset(otherUserId, preset.id));
    await assert.rejects(updateListPresetView(otherUserId, preset.id, { view: view({}), refs: {} }));
  });
});
