import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createTag,
  updateTag,
  deleteTag,
  getTags,
  getTagUsage,
  listTags,
  setIssueTags,
  setStampTags,
  TagNameTakenError,
} from "../../src/lib/tags";
import { getStampListItem } from "../../src/lib/stamps";
import { getIssueListItem, listIssueMembers } from "../../src/lib/issues";

// User-defined tags (#152): the dictionary, and tags on issues and stamps.
//
// What is pinned here is everything the schema and the types cannot say on their own — that a
// duplicate name is refused rather than merged, that deleting a tag takes it off what carries it
// (the join rows cascade) rather than being blocked by it the way every other dictionary here is,
// that a set is *replaced* by a write rather than appended to, and above all that **nothing is
// inherited** down issue → stamp → variant. That last one is a rule about what the readers do
// *not* do, so nothing goes red if a later reader starts resolving upwards.

const ts = Date.now();

describe("the tag dictionary (#152)", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    userId = `test-user-tags-dict-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Tags dict",
        email: `test-tags-dict-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-tags-dict-${ts}`, name: "Tags", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("starts empty — nothing is seeded", async () => {
    assert.deepEqual(await getTags(userId, collectionId), []);
  });

  it("creates a tag with a name and a colour, and reads it back alphabetically", async () => {
    await createTag(userId, collectionId, { name: "To check", color: "amber" });
    await createTag(userId, collectionId, { name: "Birds", color: null });
    const tags = await getTags(userId, collectionId);
    assert.deepEqual(
      tags.map((t) => [t.name, t.color]),
      [
        ["Birds", null],
        ["To check", "amber"],
      ]
    );
  });

  it("refuses a second tag with an existing name", async () => {
    await assert.rejects(
      () => createTag(userId, collectionId, { name: "Birds", color: "red" }),
      TagNameTakenError
    );
    assert.equal((await getTags(userId, collectionId)).length, 2);
  });

  it("renames and recolours in one write, and refuses a rename onto a taken name", async () => {
    const birds = (await getTags(userId, collectionId)).find((t) => t.name === "Birds")!;
    await updateTag(userId, birds.id, { name: "Fauna", color: "green" });
    const after = (await getTags(userId, collectionId)).find((t) => t.id === birds.id)!;
    assert.equal(after.name, "Fauna");
    assert.equal(after.color, "green");
    await assert.rejects(
      () => updateTag(userId, birds.id, { name: "To check", color: null }),
      TagNameTakenError
    );
  });

  it("stores an unrecognised colour as no colour rather than as itself", async () => {
    // The vocabulary is `src/lib/tag-colors.ts` and the column is plain text; a row written before
    // a hue existed, or by hand, reads as the neutral chip rather than as a broken one.
    const row = await prisma.tag.create({
      data: { collectionId, name: "Hand-written", color: "chartreuse" },
    });
    const read = (await listTags(userId, collectionId)).find((t) => t.id === row.id)!;
    assert.equal(read.color, null);
    await prisma.tag.delete({ where: { id: row.id } });
  });

  it("refuses to read another owner's dictionary", async () => {
    await assert.rejects(() => getTags("wrong-user", collectionId), /access denied/i);
  });
});

describe("tags on issues and stamps (#152)", () => {
  let userId: string;
  let collectionId: string;
  let issueId: string;
  let otherIssueId: string;
  let parentStampId: string;
  let variantStampId: string;
  let checkId: string;
  let birdsId: string;
  let expertiseId: string;

  before(async () => {
    userId = `test-user-tags-hang-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Tags hang",
        email: `test-tags-hang-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-tags-hang-${ts}`, name: "Tags", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalog = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Polska", currency: "EUR" },
    });
    const areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          primaryCatalogNameId: catalog.id,
          collectionAreaCatalogs: { create: [{ catalogNameId: catalog.id }] },
        },
      })
    ).id;
    const variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: {
          collectionId,
          name: "Colour variety",
          actsAsVariant: true,
          isDefault: true,
          sortOrder: 0,
        },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 9152, collectionAreaId: areaId, name: "Numerals", year: 1919 },
      })
    ).id;
    otherIssueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 9153, collectionAreaId: areaId, name: "Others", year: 1920 },
      })
    ).id;

    const stamp = async (number: string, parentId?: string): Promise<string> =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: number,
            parentId,
            subtypeId: parentId ? variantSubtypeId : undefined,
            catalogNumbers: { create: [{ catalogVendorId: vendor.id, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
    parentStampId = await stamp("100");
    variantStampId = await stamp("100a", parentStampId);
    await prisma.issueMember.createMany({
      data: [parentStampId, variantStampId].map((stampId, i) => ({ issueId, stampId, sortOrder: i })),
    });

    await createTag(userId, collectionId, { name: "To check", color: "amber" });
    await createTag(userId, collectionId, { name: "Birds", color: "green" });
    await createTag(userId, collectionId, { name: "For expertising", color: "red" });
    const tags = await listTags(userId, collectionId);
    checkId = tags.find((t) => t.name === "To check")!.id;
    birdsId = tags.find((t) => t.name === "Birds")!.id;
    expertiseId = tags.find((t) => t.name === "For expertising")!.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("puts tags on an issue and reads them back on its row, alphabetically", async () => {
    await setIssueTags(userId, issueId, [checkId, birdsId]);
    const issue = await getIssueListItem(userId, collectionId, issueId);
    assert.deepEqual(issue!.tags.map((t) => t.name), ["Birds", "To check"]);
    assert.equal(issue!.tags.find((t) => t.name === "Birds")!.color, "green");
  });

  it("replaces the set rather than appending to it", async () => {
    await setIssueTags(userId, issueId, [expertiseId]);
    const issue = await getIssueListItem(userId, collectionId, issueId);
    assert.deepEqual(issue!.tags.map((t) => t.name), ["For expertising"]);
    await setIssueTags(userId, issueId, []);
    assert.deepEqual((await getIssueListItem(userId, collectionId, issueId))!.tags, []);
  });

  it("puts tags on a stamp and reads them back on its row and in its issue's tree", async () => {
    await setStampTags(userId, parentStampId, [birdsId]);
    const stamp = await getStampListItem(userId, parentStampId);
    assert.deepEqual(stamp.tags.map((t) => t.name), ["Birds"]);
    const members = await listIssueMembers(userId, collectionId, issueId);
    const node = members.find((m) => m.stampId === parentStampId)!;
    assert.deepEqual(node.tags.map((t) => t.name), ["Birds"]);
  });

  it("inherits nothing: an issue's tag is not on its stamps, a parent's is not on its variants", async () => {
    await setIssueTags(userId, issueId, [checkId]);
    await setStampTags(userId, parentStampId, [birdsId]);
    await setStampTags(userId, variantStampId, []);

    // The issue's tag reaches neither of its stamps.
    assert.deepEqual((await getStampListItem(userId, parentStampId)).tags.map((t) => t.name), [
      "Birds",
    ]);
    assert.deepEqual((await getStampListItem(userId, variantStampId)).tags, []);

    // And the parent's tag reaches neither the variant below it nor the issue above it.
    const members = await listIssueMembers(userId, collectionId, issueId);
    assert.deepEqual(members.find((m) => m.stampId === variantStampId)!.tags, []);
    assert.deepEqual(
      (await getIssueListItem(userId, collectionId, issueId))!.tags.map((t) => t.name),
      ["To check"]
    );

    // Nor the other way: a tag on a variant is not on its parent.
    await setStampTags(userId, variantStampId, [expertiseId]);
    assert.deepEqual((await getStampListItem(userId, parentStampId)).tags.map((t) => t.name), [
      "Birds",
    ]);
  });

  it("drops an id that is not this collection's tag rather than storing it", async () => {
    const strangerId = `${checkId}-not-a-tag`;
    await setStampTags(userId, parentStampId, [birdsId, strangerId]);
    assert.deepEqual((await getStampListItem(userId, parentStampId)).tags.map((t) => t.name), [
      "Birds",
    ]);
  });

  it("counts what a tag is on, and deleting it takes it off everything", async () => {
    await setIssueTags(userId, issueId, [checkId]);
    await setIssueTags(userId, otherIssueId, [checkId]);
    await setStampTags(userId, parentStampId, [checkId, birdsId]);
    await setStampTags(userId, variantStampId, [checkId]);

    assert.deepEqual(await getTagUsage(userId, checkId), { issueCount: 2, stampCount: 2 });
    const listed = (await getTags(userId, collectionId)).find((t) => t.id === checkId)!;
    assert.equal(listed.issueCount, 2);
    assert.equal(listed.stampCount, 2);

    // Deleting is never refused — unlike every other dictionary here, whose FKs are `Restrict`.
    await deleteTag(userId, checkId);
    assert.equal((await getTags(userId, collectionId)).find((t) => t.id === checkId), undefined);
    assert.equal(await prisma.issueTag.count({ where: { tagId: checkId } }), 0);
    assert.equal(await prisma.stampTag.count({ where: { tagId: checkId } }), 0);

    // What else those things carried is untouched.
    assert.deepEqual((await getStampListItem(userId, parentStampId)).tags.map((t) => t.name), [
      "Birds",
    ]);
    assert.deepEqual((await getIssueListItem(userId, collectionId, issueId))!.tags, []);
  });

  it("refuses to write another owner's issue or stamp", async () => {
    await assert.rejects(() => setIssueTags("wrong-user", issueId, [birdsId]), /access denied/i);
    await assert.rejects(
      () => setStampTags("wrong-user", parentStampId, [birdsId]),
      /access denied/i
    );
  });
});
