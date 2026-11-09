import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createCollection } from "../../src/lib/collections";
import { addStampToIssue, createIssue, listIssueMembers } from "../../src/lib/issues";
import { listStampsPaginated, updateStampWithCatalog } from "../../src/lib/stamps";
import { getStampAttributeValues } from "../../src/lib/stamp-attributes";
import {
  createStampIssueFormat,
  deleteStampIssueFormat,
  getStampIssueFormats,
  IssueFormatInUseError,
  reorderStampIssueFormats,
  updateStampIssueFormat,
} from "../../src/lib/stamp-issue-formats";
import { DEFAULT_ISSUE_FORMATS } from "../../src/lib/stamp-issue-format-defaults";
import { DEFAULT_CHECKLIST } from "../../src/lib/checklist-vocabulary";

// A stamp's issue format (#2439): the dictionary — seeded, edited, recoloured, translated,
// reordered, refused deletion while in use — and the path a stamp takes through it: set on add,
// changed and cleared on edit, left alone by a caller that does not send it, and read back on the
// stamp's own read model. None is an ordinary stamp.

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-isf-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-isf-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

describe("stamp issue formats (#2439)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let issueId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`a-${ts}`)).id;
    otherUserId = (await createTestUser(`b-${ts}`)).id;
    collectionId = (await createCollection(userId, `Issue formats ${ts}`, "EUR")).id;
    otherCollectionId = (await createCollection(otherUserId, `Other ${ts}`, "EUR")).id;
    const areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    issueId = (await createIssue(userId, collectionId, areaId, { name: "Sheets" })).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  async function idOf(collection: string, abbreviation: string): Promise<string> {
    const row = await prisma.stampIssueFormat.findFirstOrThrow({
      where: { collectionId: collection, abbreviation },
      select: { id: true },
    });
    return row.id;
  }

  async function addStamp(name: string, issueFormatId?: string | null): Promise<string> {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      name,
      checklistIds: [DEFAULT_CHECKLIST],
      catalogNumbers: [],
      ...(issueFormatId !== undefined ? { issueFormatId } : {}),
    });
    return stampId;
  }

  it("seeds a new collection with the starting values, in order, each with its colour, and no Stamp row", async () => {
    const rows = await getStampIssueFormats(userId, collectionId);
    assert.deepEqual(
      rows.map((r) => [r.name, r.abbreviation, r.color, r.stampCount]),
      DEFAULT_ISSUE_FORMATS.map((d) => [d.name, d.abbreviation, d.color, 0])
    );
    assert.ok(!rows.some((r) => /^(stamp|ordinary stamp|single)$/i.test(r.name)));
  });

  it("refuses another owner", async () => {
    await assert.rejects(getStampIssueFormats(otherUserId, collectionId));
  });

  it("sets an issue format on add, reads it back, and leaves a stamp with none as an ordinary stamp", async () => {
    const bl = await idOf(collectionId, "Bl");
    const sheet = await addStamp("Bl 1", bl);
    const plain = await addStamp("1");

    assert.equal((await getStampAttributeValues(userId, sheet)).issueFormatId, bl);
    assert.equal((await getStampAttributeValues(userId, plain)).issueFormatId, null);

    const { items } = await listStampsPaginated(userId, collectionId, { issueId });
    const byName = new Map(items.map((i) => [i.name, i]));
    assert.deepEqual(byName.get("Bl 1")?.issueFormat, {
      id: bl,
      name: "Souvenir sheet",
      abbreviation: "Bl",
      color: "indigo",
    });
    assert.equal(byName.get("1")?.issueFormat, null);

    // The issue's stamp tree carries the id its row chip looks the colour up by (#2441).
    const members = new Map(
      (await listIssueMembers(userId, collectionId, issueId)).map((m) => [m.name, m])
    );
    assert.equal(members.get("Bl 1")?.issueFormatId, bl);
    assert.equal(members.get("1")?.issueFormatId, null);
  });

  it("changes and clears it on edit, and leaves it alone when the caller does not send it", async () => {
    const ms = await idOf(collectionId, "MS");
    const tb = await idOf(collectionId, "TB");
    const stampId = await addStamp("editable", ms);

    await updateStampWithCatalog(userId, stampId, { name: "editable", catalogNumbers: [] });
    assert.equal((await getStampAttributeValues(userId, stampId)).issueFormatId, ms);

    await updateStampWithCatalog(userId, stampId, {
      name: "editable",
      catalogNumbers: [],
      issueFormatId: tb,
    });
    assert.equal((await getStampAttributeValues(userId, stampId)).issueFormatId, tb);

    await updateStampWithCatalog(userId, stampId, {
      name: "editable",
      catalogNumbers: [],
      issueFormatId: null,
    });
    assert.equal((await getStampAttributeValues(userId, stampId)).issueFormatId, null);
  });

  it("refuses another collection's issue format on add and on edit", async () => {
    const foreign = await idOf(otherCollectionId, "Bl");
    await assert.rejects(addStamp("foreign", foreign), /Issue format not found/);
    const stampId = await addStamp("mine");
    await assert.rejects(
      updateStampWithCatalog(userId, stampId, {
        name: "mine",
        catalogNumbers: [],
        issueFormatId: foreign,
      }),
      /Issue format not found/
    );
    assert.equal((await getStampAttributeValues(userId, stampId)).issueFormatId, null);
  });

  it("counts the stamps using each value, and refuses to delete one in use, saying how many", async () => {
    const coil = await idOf(collectionId, "Coil");
    const a = await addStamp("coil a", coil);
    await addStamp("coil b", coil);

    const row = (await getStampIssueFormats(userId, collectionId)).find((r) => r.id === coil);
    assert.equal(row?.stampCount, 2);

    await assert.rejects(deleteStampIssueFormat(userId, coil), (err: unknown) => {
      assert.ok(err instanceof IssueFormatInUseError);
      assert.equal(err.stampCount, 2);
      return true;
    });
    assert.ok(await prisma.stampIssueFormat.findUnique({ where: { id: coil } }));

    // A stamp leaving it does not inherit anything; the count follows.
    await updateStampWithCatalog(userId, a, { name: "coil a", catalogNumbers: [], issueFormatId: null });
    const after = (await getStampIssueFormats(userId, collectionId)).find((r) => r.id === coil);
    assert.equal(after?.stampCount, 1);
  });

  it("adds, renames, recolours, translates and deletes an unused value", async () => {
    await createStampIssueFormat(userId, collectionId, {
      name: "Sheetlet",
      abbreviation: "KB",
      color: "red",
      countsTowardsSeries: true,
      translations: { de: { name: "Kleinbogen", abbreviation: "" } },
    });
    let rows = await getStampIssueFormats(userId, collectionId);
    const added = rows[rows.length - 1];
    assert.equal(added.name, "Sheetlet");
    assert.equal(added.sortOrder, rows.length - 1);
    assert.deepEqual(added.nameByLanguage, { de: "Kleinbogen" });
    assert.deepEqual(added.abbreviationByLanguage, {});

    await updateStampIssueFormat(userId, added.id, {
      name: "Sheetlet of 10",
      abbreviation: "KB10",
      color: null,
      countsTowardsSeries: true,
      translations: { de: { name: "Kleinbogen", abbreviation: "KB" } },
    });
    rows = await getStampIssueFormats(userId, collectionId);
    const updated = rows.find((r) => r.id === added.id);
    assert.equal(updated?.name, "Sheetlet of 10");
    assert.equal(updated?.abbreviation, "KB10");
    assert.equal(updated?.color, null);
    assert.deepEqual(updated?.abbreviationByLanguage, { de: "KB" });

    await deleteStampIssueFormat(userId, added.id);
    assert.equal(await prisma.stampIssueFormat.findUnique({ where: { id: added.id } }), null);
  });

  it("reorders, and refuses a list that is not exactly the collection's", async () => {
    const ids = (await getStampIssueFormats(userId, collectionId)).map((r) => r.id);
    const reversed = [...ids].reverse();
    await reorderStampIssueFormats(userId, collectionId, reversed);
    assert.deepEqual(
      (await getStampIssueFormats(userId, collectionId)).map((r) => r.id),
      reversed
    );
    await assert.rejects(reorderStampIssueFormats(userId, collectionId, reversed.slice(1)));
  });
});
