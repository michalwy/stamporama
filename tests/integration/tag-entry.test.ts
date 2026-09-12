import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createTag,
  deleteTag,
  getStampTags,
  getTags,
  listTags,
  setIssueTagEntries,
  setItemTagEntries,
  setStampTagEntries,
} from "../../src/lib/tags";
import { createLot, intakeStamps } from "../../src/lib/lots";
import { createPurchase, setPurchaseStatus } from "../../src/lib/purchases";

// Tags typed into an edit dialog (#1192). The dialog's chips arrive as entries — an existing tag by
// id, a new one by name with the colour its chip showed — and the save resolves them against the
// dictionary as it is *now*, creating what is missing in the same transaction as the join rows.
//
// Pinned here is what the issue's decisions say and nothing else can check: a name that exists in
// any casing attaches that tag and creates nothing, a new tag is an ordinary tag afterwards, and a
// write that is refused leaves no tag behind.

const ts = Date.now();

describe("typing tags into an edit dialog (#1192)", () => {
  let userId: string;
  let collectionId: string;
  let issueId: string;
  let stampId: string;
  let itemId: string;
  let birdsId: string;
  let foreignTagId: string;

  async function issueTagNames(): Promise<string[]> {
    const rows = await prisma.issueTag.findMany({ where: { issueId }, include: { tag: true } });
    return rows.map((r) => r.tag.name).sort();
  }

  before(async () => {
    userId = `test-user-tag-entry-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Tag entry",
        email: `test-tag-entry-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-tag-entry-${ts}`, name: "Tags", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })
    ).id;
    issueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 1192, collectionAreaId: areaId, name: "Numerals", year: 1919 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Numeral 5f" } })).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    await setPurchaseStatus(userId, purchase.id, "arrived");
    const lotId = await createLot(userId, purchase.id, 10);
    itemId = (await intakeStamps(userId, { lotId }, { stampId, conditionId }))[0].itemId;

    await createTag(userId, collectionId, { name: "Birds", color: "red" });
    birdsId = (await listTags(userId, collectionId)).find((t) => t.name === "Birds")!.id;

    const otherCol = await prisma.collection.create({
      data: { slug: `col-tag-entry-other-${ts}`, name: "Other", baseCurrency: "EUR", ownerId: userId },
    });
    foreignTagId = (
      await prisma.tag.create({ data: { collectionId: otherCol.id, name: "Elsewhere" } })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("attaches the existing tag for a name typed in another casing, and creates nothing", async () => {
    await setIssueTagEntries(userId, issueId, [{ id: null, name: "bIRDS", color: "blue" }]);
    assert.deepEqual(await issueTagNames(), ["Birds"]);
    const dictionary = await listTags(userId, collectionId);
    assert.equal(dictionary.length, 1);
    // The existing tag keeps its own colour; the chip's guess is only for a tag being born.
    assert.equal(dictionary[0].color, "red");
  });

  it("creates a name nobody has used, in the colour its chip showed, and attaches it", async () => {
    await setIssueTagEntries(userId, issueId, [
      { id: birdsId, name: "Birds", color: "red" },
      { id: null, name: "to-check", color: "teal" },
    ]);
    assert.deepEqual(await issueTagNames(), ["Birds", "to-check"]);
    const created = (await listTags(userId, collectionId)).find((t) => t.name === "to-check");
    assert.equal(created?.color, "teal");
  });

  it("gives a new tag the palette's free hue when the request carries no colour", async () => {
    await setIssueTagEntries(userId, issueId, [{ id: null, name: "swap", color: null }]);
    const swap = (await listTags(userId, collectionId)).find((t) => t.name === "swap");
    // red (Birds) and teal (to-check) are taken; orange is the first hue nobody uses.
    assert.equal(swap?.color, "orange");
    // A replace: the two tags the entries did not name came off the issue.
    assert.deepEqual(await issueTagNames(), ["swap"]);
  });

  it("creates one tag for a new name named twice in different casings", async () => {
    await setIssueTagEntries(userId, issueId, [
      { id: null, name: "Expertise", color: "violet" },
      { id: null, name: "expertise", color: "pink" },
    ]);
    const matches = (await listTags(userId, collectionId)).filter(
      (t) => t.name.toLowerCase() === "expertise"
    );
    assert.equal(matches.length, 1);
    assert.deepEqual(await issueTagNames(), ["Expertise"]);
  });

  it("resolves a chip whose tag was deleted meanwhile by its name, rather than dropping it", async () => {
    await createTag(userId, collectionId, { name: "Gone", color: null });
    const goneId = (await listTags(userId, collectionId)).find((t) => t.name === "Gone")!.id;
    await deleteTag(userId, goneId);
    await setIssueTagEntries(userId, issueId, [{ id: goneId, name: "Gone", color: "slate" }]);
    assert.deepEqual(await issueTagNames(), ["Gone"]);
  });

  it("drops an id from another collection and creates nothing for it", async () => {
    const before = (await getTags(userId, collectionId)).length;
    await setIssueTagEntries(userId, issueId, [{ id: foreignTagId, name: "", color: null }]);
    assert.deepEqual(await issueTagNames(), []);
    assert.equal((await getTags(userId, collectionId)).length, before);
  });

  it("writes a stamp's and a copy's tags the same way, each its own", async () => {
    await setStampTagEntries(userId, stampId, [{ id: null, name: "Numerals", color: "indigo" }]);
    await setItemTagEntries(userId, itemId, [
      { id: null, name: "numerals", color: "green" },
      { id: null, name: "Drawer-3", color: "amber" },
    ]);
    assert.deepEqual(
      (await getStampTags(userId, stampId)).map((t) => t.name),
      ["Numerals"]
    );
    const copyTags = await prisma.itemTag.findMany({ where: { itemId }, include: { tag: true } });
    assert.deepEqual(copyTags.map((r) => r.tag.name).sort(), ["Drawer-3", "Numerals"]);
    // Nothing inherited: the copy's tags did not reach its stamp.
    assert.equal((await getStampTags(userId, stampId)).length, 1);
  });

  it("is a normal tag afterwards: counted in Settings and deletable there", async () => {
    const drawer = (await getTags(userId, collectionId)).find((t) => t.name === "Drawer-3")!;
    assert.equal(drawer.copyCount, 1);
    await deleteTag(userId, drawer.id);
    assert.equal(await prisma.itemTag.count({ where: { itemId, tagId: drawer.id } }), 0);
  });

  it("creates no tag when the write is refused", async () => {
    const before = (await getTags(userId, collectionId)).length;
    await assert.rejects(
      () => setIssueTagEntries("wrong-user", issueId, [{ id: null, name: "intruder", color: null }]),
      /access denied/i
    );
    assert.equal((await getTags(userId, collectionId)).length, before);
  });
});
