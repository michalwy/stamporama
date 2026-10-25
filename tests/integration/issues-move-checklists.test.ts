import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prisma } from "../../src/lib/db";
import { addStampToIssue, moveStampNode } from "../../src/lib/issues";

// A stamp moved to another issue takes its checklist places with it (#2184): the Issues screen's
// *Move to another issue…* now asks `moveStampNode` for what the agent API's move already did
// (#2169), and `20261025180000_moved_stamps_checklist_places` cleans up the stamps the screen moved
// before. The places-moving rule itself is the API's, tested in `agent-api-issue-tree.test.ts`; what
// is new here is that a checklist spanning issues keeps the stamp, and the clean-up.
//
// The clean-up's state is the one the old screen left — `moveStampNode` without the option — and the
// migration file runs, bytes off disk, inside a transaction that is rolled back: it reads every
// collection's checklists, and the other suites' rows are not this test's to change.
const MIGRATION = fileURLToPath(
  new URL("../../prisma/migrations/20261025180000_moved_stamps_checklist_places/migration.sql", import.meta.url)
);

let nextTestIssueNo = 9801;

describe("a moved stamp's checklist places (#2184)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;

  before(async () => {
    const ts = Date.now();
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-move-checklists-${ts}`,
          name: `Test User move-checklists-${ts}`,
          email: `test-move-checklists-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-move-checklists-${ts}`, name: `Collection ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Area" } })).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newIssue(name: string) {
    return (
      await prisma.issue.create({
        data: { collectionId, issueNo: nextTestIssueNo++, collectionAreaId: areaId, name },
      })
    ).id;
  }

  async function addStamp(issueId: string, name: string, parentStampId?: string) {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      name,
      catalogNumbers: [],
      checklistIds: [],
      ...(parentStampId ? { parentStampId } : {}),
    });
    return stampId;
  }

  async function checklist(issueId: string | null, name: string, stampIds: string[], kind = "standard", sortOrder = 0) {
    const id = (await prisma.checklist.create({ data: { collectionId, issueId, name, kind, sortOrder } })).id;
    await prisma.checklistStamp.createMany({
      data: stampIds.map((stampId, i) => ({ checklistId: id, stampId, sortOrder: i })),
    });
    return id;
  }

  it("keeps a moved stamp on a checklist spanning issues", async () => {
    const source = await newIssue("Spanning source");
    const target = await newIssue("Spanning target");
    const base = await addStamp(source, "base");
    const own = await checklist(source, "Source set", [base]);
    const spanning = await checklist(null, "Across issues", [base]);

    await moveStampNode(userId, collectionId, source, base, target, { moveChecklistPlaces: true });

    const places = await prisma.checklistStamp.findMany({
      where: { stampId: base },
      select: { checklistId: true, checklist: { select: { issueId: true } } },
    });
    assert.equal(places.some((p) => p.checklistId === own), false);
    assert.equal(places.some((p) => p.checklistId === spanning), true);
    assert.equal(places.some((p) => p.checklist.issueId === target), true);
  });

  it("cleans up the stamps the screen moved before, by the move's own rule", async () => {
    // Moved into an issue with a standard checklist: the base and the variant that was on a standard
    // checklist join it, at its end; the variant on a specialised one only joins none.
    const source = await newIssue("Old source");
    const target = await newIssue("Old target");
    const base = await addStamp(source, "base");
    const onStandard = await addStamp(source, "on standard", base);
    const onSpecialised = await addStamp(source, "on specialised", base);
    const stay = await addStamp(source, "stays");
    const sourceSet = await checklist(source, "Source set", [stay, base, onStandard]);
    const colours = await checklist(source, "Colours", [onSpecialised], "specialised");
    const spanning = await checklist(null, "Across issues", [base]);
    const already = await addStamp(target, "already there");
    const targetSet = await checklist(target, "Target set", [already]);

    // Moved into an issue with only a specialised checklist: a standard one is made for it, named
    // after the issue and read first.
    const lone = await addStamp(source, "lone");
    await prisma.checklistStamp.create({ data: { checklistId: sourceSet, stampId: lone, sortOrder: 9 } });
    const bare = await newIssue("Bare target");
    const bareSpecial = await checklist(bare, "Bare colours", [], "specialised", 3);

    // Moved into an issue where it is already on a checklist: it only leaves the old one.
    const placed = await addStamp(source, "placed");
    await prisma.checklistStamp.create({ data: { checklistId: sourceSet, stampId: placed, sortOrder: 10 } });
    const placedTarget = await newIssue("Placed target");

    // The screen as it was: the tree moves, the checklist places stay behind.
    await moveStampNode(userId, collectionId, source, base, target);
    await moveStampNode(userId, collectionId, source, lone, bare);
    await moveStampNode(userId, collectionId, source, placed, placedTarget);
    const placedSet = await checklist(placedTarget, "Placed set", [placed], "specialised");

    const sql = await readFile(MIGRATION, "utf8");
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(sql);

        const on = async (checklistId: string) =>
          (
            await tx.checklistStamp.findMany({
              where: { checklistId },
              select: { stampId: true },
              orderBy: { sortOrder: "asc" },
            })
          ).map((row) => row.stampId);

        assert.deepEqual(await on(sourceSet), [stay]);
        assert.deepEqual(await on(colours), []);
        assert.deepEqual(await on(spanning), [base]);
        assert.deepEqual(await on(targetSet), [already, base, onStandard]);

        const made = await tx.checklist.findMany({
          where: { issueId: bare },
          select: { id: true, name: true, kind: true, sortOrder: true },
          orderBy: { sortOrder: "asc" },
        });
        assert.equal(made.length, 2);
        assert.deepEqual(
          { name: made[0].name, kind: made[0].kind, sortOrder: made[0].sortOrder },
          { name: "Bare target", kind: "standard", sortOrder: 2 }
        );
        assert.equal(made[1].id, bareSpecial);
        assert.deepEqual(await on(made[0].id), [lone]);

        assert.deepEqual(await on(placedSet), [placed]);
        assert.equal(await tx.checklist.count({ where: { issueId: placedTarget } }), 1);

        throw new Error("rollback");
      }),
      /rollback/
    );
  });
});
