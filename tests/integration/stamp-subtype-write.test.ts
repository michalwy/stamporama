import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createCollection } from "../../src/lib/collections";
import { addStampToIssue } from "../../src/lib/issues";
import { updateStampWithCatalog, getStampSubtypeAssignment } from "../../src/lib/stamps";
import { getDefaultSubtypeId, getStampSubtypes } from "../../src/lib/subtypes";

describe("subtype write path (addStampToIssue / updateStampWithCatalog)", () => {
  let userId: string;
  let collectionId: string;
  let issueId: string;
  let parentStampId: string;
  let defaultSubtypeId: string;
  let errorSubtypeId: string; // an actsAsVariant=false subtype
  let otherCollectionSubtypeId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-subw-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User subw-${ts}`,
        email: `test-subw-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // createCollection seeds the default subtype set (incl. the "Variant" default).
    const col = await createCollection(userId, `Subtype Write ${ts}`, "EUR");
    collectionId = col.id;

    defaultSubtypeId = (await getDefaultSubtypeId(collectionId))!;
    const subtypes = await getStampSubtypes(userId, collectionId);
    errorSubtypeId = subtypes.find((s) => s.name === "Error")!.id;

    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany" },
    });
    const issue = await prisma.issue.create({
      data: { collectionId, collectionAreaId: area.id, name: "First Issue", year: 1872 },
    });
    issueId = issue.id;

    const parent = await prisma.stamp.create({ data: { collectionId, name: "Parent" } });
    parentStampId = parent.id;
    await prisma.stampCollectionArea.create({
      data: { stampId: parentStampId, collectionAreaId: area.id, isPrimary: true },
    });
    await prisma.issueMember.create({
      data: { issueId, stampId: parentStampId, requiredForCompleteness: true },
    });

    // A subtype belonging to a different collection, to test cross-collection guard.
    const other = await createCollection(userId, `Other ${ts}`, "EUR");
    otherCollectionSubtypeId = (await getDefaultSubtypeId(other.id))!;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("assigns the collection default subtype to a child when none is chosen", async () => {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      parentStampId,
      requiredForCompleteness: false,
      catalogNumbers: [],
    });
    const child = await prisma.stamp.findUniqueOrThrow({ where: { id: stampId } });
    assert.equal(child.subtypeId, defaultSubtypeId);
    assert.equal(child.actsAsVariantOverride, null);
  });

  it("assigns an explicit subtype and override to a child", async () => {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      parentStampId,
      subtypeId: errorSubtypeId,
      actsAsVariantOverride: true,
      requiredForCompleteness: false,
      catalogNumbers: [],
    });
    const child = await prisma.stamp.findUniqueOrThrow({ where: { id: stampId } });
    assert.equal(child.subtypeId, errorSubtypeId);
    assert.equal(child.actsAsVariantOverride, true);
  });

  it("leaves a top-level stamp unclassified even if subtype fields are passed", async () => {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      parentStampId: null,
      subtypeId: errorSubtypeId,
      actsAsVariantOverride: false,
      requiredForCompleteness: true,
      catalogNumbers: [],
    });
    const top = await prisma.stamp.findUniqueOrThrow({ where: { id: stampId } });
    assert.equal(top.subtypeId, null);
    assert.equal(top.actsAsVariantOverride, null);
  });

  it("rejects a subtype from another collection", async () => {
    await assert.rejects(
      () =>
        addStampToIssue(userId, collectionId, issueId, {
          parentStampId,
          subtypeId: otherCollectionSubtypeId,
          requiredForCompleteness: false,
          catalogNumbers: [],
        }),
      /not found in this collection/i
    );
  });

  it("changes a child's subtype and override on edit", async () => {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      parentStampId,
      requiredForCompleteness: false,
      catalogNumbers: [],
    });
    await updateStampWithCatalog(userId, stampId, {
      catalogNumbers: [],
      subtypeId: errorSubtypeId,
      actsAsVariantOverride: false,
    });
    let child = await prisma.stamp.findUniqueOrThrow({ where: { id: stampId } });
    assert.equal(child.subtypeId, errorSubtypeId);
    assert.equal(child.actsAsVariantOverride, false);

    // Passing subtypeId: null falls back to the collection default; override cleared.
    await updateStampWithCatalog(userId, stampId, {
      catalogNumbers: [],
      subtypeId: null,
      actsAsVariantOverride: null,
    });
    child = await prisma.stamp.findUniqueOrThrow({ where: { id: stampId } });
    assert.equal(child.subtypeId, defaultSubtypeId);
    assert.equal(child.actsAsVariantOverride, null);
  });

  it("reads back a child's assignment for edit prefill", async () => {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      parentStampId,
      subtypeId: errorSubtypeId,
      actsAsVariantOverride: false,
      requiredForCompleteness: false,
      catalogNumbers: [],
    });
    const assignment = await getStampSubtypeAssignment(userId, stampId);
    assert.equal(assignment.parentId, parentStampId);
    assert.equal(assignment.subtypeId, errorSubtypeId);
    assert.equal(assignment.actsAsVariantOverride, false);
  });

  it("leaves subtype untouched on edit when fields are omitted", async () => {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      parentStampId,
      subtypeId: errorSubtypeId,
      actsAsVariantOverride: true,
      requiredForCompleteness: false,
      catalogNumbers: [],
    });
    await updateStampWithCatalog(userId, stampId, {
      name: "Renamed",
      catalogNumbers: [],
    });
    const child = await prisma.stamp.findUniqueOrThrow({ where: { id: stampId } });
    assert.equal(child.name, "Renamed");
    assert.equal(child.subtypeId, errorSubtypeId);
    assert.equal(child.actsAsVariantOverride, true);
  });

  it("forces subtype fields to null when editing a top-level stamp", async () => {
    const top = await prisma.stamp.create({ data: { collectionId, name: "Top" } });
    await updateStampWithCatalog(userId, top.id, {
      catalogNumbers: [],
      subtypeId: errorSubtypeId,
      actsAsVariantOverride: true,
    });
    const reloaded = await prisma.stamp.findUniqueOrThrow({ where: { id: top.id } });
    assert.equal(reloaded.subtypeId, null);
    assert.equal(reloaded.actsAsVariantOverride, null);
  });
});
