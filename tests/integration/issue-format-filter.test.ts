import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createCollection } from "../../src/lib/collections";
import { buildItemFilterWhere, createItem, listItemsPaginated } from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import { listStampsPaginated } from "../../src/lib/stamps";
import { listIssuesPaginated } from "../../src/lib/issues";
import { createWant, listWantsPaginated } from "../../src/lib/wants";
import { ORDINARY_STAMP_ISSUE_FORMAT } from "../../src/lib/issue-format-filter";

// The issue-format filter (#2440) against the real `where` builders: the Copies list and every copy
// picker (`buildItemWhere`), the Stamps list, the Issues list and the Wants list. *Souvenir sheet*
// keeps only souvenir sheets or copies of them; *Stamp (none)* keeps only the ordinary stamps; a
// several-stamp piece matches when any of its stamps does.
//
// One collection (seeded with the issue formats), two issues:
//   - *Sheets*: a souvenir sheet (Bl) and an ordinary stamp;
//   - *Panes*: a booklet pane (HBl).
// Copies: one of each stamp, and a cover leading with the ordinary stamp and carrying the sheet.

const ts = Date.now();

describe("the issue-format filter (#2440)", () => {
  let userId: string;
  let collectionId: string;
  let blId: string;
  let hblId: string;
  let sheetsIssueId: string;
  let panesIssueId: string;
  let sheet: string, plain: string, pane: string;
  let sheetCopy: string, plainCopy: string, paneCopy: string, coverCopy: string;

  before(async () => {
    userId = `test-user-ifmt-filter-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User ifmt-${ts}`,
        email: `test-ifmt-filter-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (await createCollection(userId, `Issue format filter ${ts}`, "EUR")).id;
    const format = async (abbreviation: string) =>
      (
        await prisma.stampIssueFormat.findFirstOrThrow({
          where: { collectionId, abbreviation },
          select: { id: true },
        })
      ).id;
    blId = await format("Bl");
    hblId = await format("HBl");

    const areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 99 },
      })
    ).id;
    const stamp = async (name: string, issueFormatId: string | null) =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name,
            issuedYear: 1960,
            issueFormatId,
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
    sheet = await stamp("Chopin sheet", blId);
    plain = await stamp("Chopin 60 gr", null);
    pane = await stamp("Booklet pane", hblId);

    const issue = async (issueNo: number, name: string, stampIds: string[]) => {
      const id = (
        await prisma.issue.create({
          // Past the collection's counter: this row bypasses `allocateEntityNumber` (#432).
          data: { collectionId, issueNo, collectionAreaId: areaId, name, year: 1960 },
        })
      ).id;
      await prisma.issueMember.createMany({
        data: stampIds.map((stampId, sortOrder) => ({ issueId: id, stampId, sortOrder })),
      });
      return id;
    };
    sheetsIssueId = await issue(9501, "Sheets", [sheet, plain]);
    panesIssueId = await issue(9502, "Panes", [pane]);

    sheetCopy = (await createItem(userId, collectionId, { stampId: sheet, conditionId })).id;
    plainCopy = (await createItem(userId, collectionId, { stampId: plain, conditionId })).id;
    paneCopy = (await createItem(userId, collectionId, { stampId: pane, conditionId })).id;
    coverCopy = (await createItem(userId, collectionId, { stampId: plain, conditionId })).id;
    await setItemStamps(userId, coverCopy, [{ stampId: plain }, { stampId: sheet }]);

    for (const stampId of [sheet, plain, pane]) {
      await createWant(userId, collectionId, {
        stampId,
        conditionIds: [],
        certificateStatusIds: [],
        formatIds: [],
        priority: "normal",
        notes: null,
      });
    }
  });

  after(async () => {
    await prisma.want.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const sorted = (ids: string[]) => [...ids].sort();

  async function copies(issueFormatIds: string[]): Promise<string[]> {
    const { items } = await listItemsPaginated(userId, collectionId, { issueFormatIds, pageSize: 100 });
    return sorted(items.map((i) => i.id));
  }

  it("keeps the copies of souvenir sheets, a cover carrying one among them", async () => {
    assert.deepEqual(await copies([blId]), sorted([sheetCopy, coverCopy]));
  });

  it("keeps the ordinary stamps' copies under Stamp (none), the cover leading with one too", async () => {
    assert.deepEqual(await copies([ORDINARY_STAMP_ISSUE_FORMAT]), sorted([plainCopy, coverCopy]));
  });

  it("ORs Stamp (none) with a real format, and is no filter when nothing is ticked", async () => {
    assert.deepEqual(
      await copies([ORDINARY_STAMP_ISSUE_FORMAT, hblId]),
      sorted([plainCopy, paneCopy, coverCopy])
    );
    assert.deepEqual(await copies([]), sorted([sheetCopy, plainCopy, paneCopy, coverCopy]));
  });

  it("narrows the pickers' shared `where` the same way", async () => {
    const where = await buildItemFilterWhere(collectionId, { issueFormatIds: [hblId] });
    const rows = await prisma.item.findMany({ where, select: { id: true } });
    assert.deepEqual(rows.map((r) => r.id), [paneCopy]);
  });

  it("narrows the Stamps list to the stamps in a ticked format", async () => {
    const names = async (issueFormatIds: string[]) =>
      sorted((await listStampsPaginated(userId, collectionId, { issueFormatIds })).items.map((s) => s.id));
    assert.deepEqual(await names([blId]), [sheet]);
    assert.deepEqual(await names([ORDINARY_STAMP_ISSUE_FORMAT]), [plain]);
    assert.deepEqual(await names([ORDINARY_STAMP_ISSUE_FORMAT, blId]), sorted([sheet, plain]));
  });

  it("keeps the issues holding a stamp in a ticked format", async () => {
    const issues = async (issueFormatIds: string[]) =>
      sorted((await listIssuesPaginated(userId, collectionId, { issueFormatIds })).items.map((i) => i.id));
    assert.deepEqual(await issues([blId]), [sheetsIssueId]);
    assert.deepEqual(await issues([hblId]), [panesIssueId]);
    assert.deepEqual(await issues([ORDINARY_STAMP_ISSUE_FORMAT]), [sheetsIssueId]);
  });

  it("narrows the Wants list by the wanted stamp's issue format", async () => {
    const wanted = async (issueFormatIds: string[]) =>
      sorted(
        (await listWantsPaginated(userId, collectionId, { status: "all", issueFormatIds })).items.map(
          (w) => w.stampId
        )
      );
    assert.deepEqual(await wanted([blId]), [sheet]);
    assert.deepEqual(await wanted([ORDINARY_STAMP_ISSUE_FORMAT, hblId]), sorted([plain, pane]));
  });

  it("carries each stamp's issue format on the copy rows, the carried ones included", async () => {
    const { items } = await listItemsPaginated(userId, collectionId, { ids: [coverCopy], pageSize: 1 });
    const [cover] = items;
    assert.equal(cover.issueFormatId, null);
    assert.deepEqual(
      cover.carriedStamps.map((s) => s.issueFormatId),
      [null, blId]
    );
  });
});
