import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createCollection } from "../../src/lib/collections";
import { getIssueCompleteness } from "../../src/lib/checklist-completeness";
import { getChecklistsForIssue, getRunChecklist, listChecklistIdsByStamp } from "../../src/lib/checklists";
import { DEFAULT_CHECKLIST } from "../../src/lib/checklist-vocabulary";
import { getChecklistEstimatedValue } from "../../src/lib/estimated-values";
import { addStampToIssue, createIssue, getChecklistPriceDetails, getIssueHeadersByIds } from "../../src/lib/issues";
import { createItem } from "../../src/lib/items";
import { loadPoolChecklists } from "../../src/lib/lot-builder";
import { getChecklistMarketValue } from "../../src/lib/market-values";
import {
  getStampIssueFormats,
  updateStampIssueFormat,
  type StampIssueFormatData,
} from "../../src/lib/stamp-issue-formats";
import { createWant, previewIssueMissingWants } from "../../src/lib/wants";

// An issue format says whether its entries count towards the series (#2470, ADR-0080). An FDC sits
// in its issue, on the issue's checklist as every stamp added to it is, and the series around it
// reads as though it were not there — until the switch is turned back on, which restores it,
// because the membership was never touched.

const ts = Date.now();

describe("an issue format that does not count towards the series (#2470)", () => {
  const userId = `test-user-isfs-${ts}`;
  let collectionId: string;
  let conditionId: string;
  let issueId: string;
  let checklistId: string;
  let first: string, second: string, fdc: string;
  let fdcFormat: StampIssueFormatData;

  async function addStamp(name: string, issueFormatId?: string): Promise<string> {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      name,
      checklistIds: [DEFAULT_CHECKLIST],
      catalogNumbers: [],
      ...(issueFormatId ? { issueFormatId } : {}),
    });
    return stampId;
  }

  const hold = (stampId: string) =>
    createItem(userId, collectionId, { stampId, conditionId, inCollection: true, deliveryState: "delivered" });

  const setCounts = (countsTowardsSeries: boolean) =>
    updateStampIssueFormat(userId, fdcFormat.id, {
      name: fdcFormat.name,
      abbreviation: fdcFormat.abbreviation,
      color: fdcFormat.color,
      countsTowardsSeries,
    });

  async function grid() {
    const { checklists } = await getIssueCompleteness(userId, collectionId, issueId, false);
    assert.equal(checklists.length, 1);
    return checklists[0];
  }

  before(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: "Test",
        email: `test-isfs-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (await createCollection(userId, `Series ${ts}`, "EUR")).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 99 },
        select: { id: true },
      })
    ).id;
    const areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    issueId = (await createIssue(userId, collectionId, areaId, { name: "Set" })).id;

    const formats = await getStampIssueFormats(userId, collectionId);
    fdcFormat = formats.find((f) => f.abbreviation === "FDC")!;
    first = await addStamp("first");
    second = await addStamp("second");
    fdc = await addStamp("first day cover", fdcFormat.id);
    checklistId = (await getChecklistsForIssue(userId, collectionId, issueId, false))[0].id;
    await hold(first);
    await hold(second);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("seeds FDC and Postal stationery switched off, and every other value on", async () => {
    const off = (await getStampIssueFormats(userId, collectionId))
      .filter((f) => !f.countsTowardsSeries)
      .map((f) => f.abbreviation);
    assert.deepEqual(off, ["PS", "FDC"]);
  });

  it("reads an issue holding all its stamps and no FDC as complete", async () => {
    const checklist = await grid();
    const any = checklist.rows.find((r) => r.disposition === "any" && r.conditionId === null);
    assert.equal(any?.owned, 2);
    assert.equal(any?.completeSets, 1);
    assert.equal(checklist.requiredCount, 2);
    const [summary] = await getIssueHeadersByIds(userId, collectionId, [issueId], false);
    assert.equal(summary.requiredCount, 2);
    assert.equal(summary.memberCount, 3, "the FDC stays in its issue");
  });

  it("leaves the FDC out of the checklist's price and value totals", async () => {
    assert.equal((await getChecklistPriceDetails(userId, collectionId, checklistId)).requiredCount, 2);
    assert.equal((await getChecklistEstimatedValue(userId, collectionId, checklistId)).requiredCount, 2);
    assert.equal((await getChecklistMarketValue(userId, collectionId, checklistId)).requiredCount, 2);
  });

  it("wants a whole set without the FDC, and the FDC on its own", async () => {
    const [preview] = await previewIssueMissingWants(userId, collectionId, issueId);
    assert.deepEqual(preview.missingStampIds, []);
    const whole = await createWant(userId, collectionId, {
      checklistId,
      conditionIds: [],
      certificateStatusIds: [],
      formatIds: [],
      priority: "normal",
      notes: null,
    });
    const wanted = await prisma.want.findMany({ where: { id: { in: whole.ids } }, select: { stampId: true } });
    assert.deepEqual(wanted.map((w) => w.stampId).sort(), [first, second].sort());

    const single = await createWant(userId, collectionId, {
      stampId: fdc,
      conditionIds: [],
      certificateStatusIds: [],
      formatIds: [],
      priority: "normal",
      notes: null,
    });
    assert.equal(single.created, 1);
  });

  it("never lets the FDC make or break a complete set", async () => {
    const candidates = [first, fdc].map((stampId) => ({ stampId, variantChain: [stampId] }));
    const pool = await loadPoolChecklists(
      collectionId,
      candidates as unknown as Parameters<typeof loadPoolChecklists>[1],
      false
    );
    assert.deepEqual(pool, [{ checklistId, stampIds: [first, second] }]);
    const onlyFdc = await loadPoolChecklists(
      collectionId,
      [{ stampId: fdc, variantChain: [fdc] }] as unknown as Parameters<typeof loadPoolChecklists>[1],
      false
    );
    assert.deepEqual(onlyFdc, [], "an FDC alone touches no set");
  });

  it("keeps the FDC on the checklist's editor, and off everything reading it as a series", async () => {
    const [editor] = await getChecklistsForIssue(userId, collectionId, issueId, false);
    assert.deepEqual([...editor.stampIds].sort(), [first, second, fdc].sort());
    assert.deepEqual([...editor.countingStampIds].sort(), [first, second].sort());
    assert.deepEqual((await getRunChecklist(userId, collectionId, checklistId))?.stampIds.slice().sort(), [first, second].sort());
    const on = await listChecklistIdsByStamp(collectionId, [first, fdc], false);
    assert.deepEqual([...on.keys()], [first]);
  });

  it("restores the FDC to the series when the switch is turned back on, with nothing rewritten", async () => {
    await setCounts(true);
    try {
      const checklist = await grid();
      assert.equal(checklist.requiredCount, 3);
      const [summary] = await getIssueHeadersByIds(userId, collectionId, [issueId], false);
      assert.equal(summary.requiredCount, 3);
    } finally {
      await setCounts(false);
    }
    assert.equal((await grid()).requiredCount, 2);
  });
});
