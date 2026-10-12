import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { previewCopyChecklistSlots } from "../../src/lib/offers";

// The *New offer* dialog's series order (#1869) reads each copy's checklist slots. The ordering is
// unit-tested (`new-offer-copies.test.ts`); what is exercised here is the read: the slot's place in
// the checklist's own order, specialised checklists only while the switch is on, a copy on no
// checklist absent, and nothing read across collections or owners.

describe("the New offer dialog's checklist slots (#1869)", () => {
  let userId: string;
  let collectionId: string;
  let foreignItemId: string;
  const items = new Map<string, string>();

  before(async () => {
    const ts = Date.now();
    userId = `test-user-new-offer-slots-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User new-offer-slots-${ts}`,
        email: `test-new-offer-slots-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const collection = (slug: string) =>
      prisma.collection.create({ data: { slug, name: slug, baseCurrency: "EUR", ownerId: userId } });
    collectionId = (await collection(`col-new-offer-slots-${ts}`)).id;
    const foreignId = (await collection(`col-new-offer-slots-other-${ts}`)).id;

    const conditions = new Map<string, string>();
    for (const id of [collectionId, foreignId]) {
      const condition = await prisma.stampCondition.create({
        data: { collectionId: id, name: "Used", abbreviation: "U", sortOrder: 0 },
      });
      conditions.set(id, condition.id);
    }
    const copyOf = async (inCollection: string, name: string) => {
      const conditionId = conditions.get(inCollection)!;
      const stamp = await prisma.stamp.create({ data: { collectionId: inCollection, name } });
      const item = await createItem(userId, inCollection, { stampId: stamp.id, conditionId });
      return { stampId: stamp.id, itemId: item.id };
    };

    const stamps = new Map<string, string>();
    for (const name of ["first", "second", "loose", "colour"]) {
      const { stampId, itemId } = await copyOf(collectionId, name);
      stamps.set(name, stampId);
      items.set(name, itemId);
    }
    foreignItemId = (await copyOf(foreignId, "elsewhere")).itemId;

    const checklist = (name: string, kind: string, members: string[]) =>
      prisma.checklist.create({
        data: {
          collectionId,
          name,
          kind,
          stamps: { create: members.map((m, sortOrder) => ({ stampId: stamps.get(m)!, sortOrder })) },
        },
      });
    // `second` leads its checklist although it was created after `first`.
    await checklist("Series", "standard", ["second", "first"]);
    await checklist("Colours", "specialised", ["colour"]);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const ids = () => [...items.values(), foreignItemId];

  it("gives each copy its place in the checklist's order, and none to a copy on no checklist", async () => {
    const slots = await previewCopyChecklistSlots(userId, collectionId, ids(), false);
    const series = slots[items.get("first")!]?.[0];
    assert.ok(series, "the first stamp has a slot");
    assert.equal(series.position, 1);
    assert.deepEqual(slots[items.get("second")!], [{ checklistId: series.checklistId, position: 0 }]);
    assert.equal(slots[items.get("loose")!], undefined);
    assert.equal(slots[foreignItemId], undefined, "a copy of another collection is not read");
  });

  it("reads specialised checklists only while they are switched on", async () => {
    const off = await previewCopyChecklistSlots(userId, collectionId, ids(), false);
    assert.equal(off[items.get("colour")!], undefined);
    const on = await previewCopyChecklistSlots(userId, collectionId, ids(), true);
    assert.equal(on[items.get("colour")!]?.length, 1);
  });

  it("refuses a collection the user does not own", async () => {
    await assert.rejects(() => previewCopyChecklistSlots("someone-else", collectionId, ids(), false));
  });
});
