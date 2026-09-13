import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { addStampRangeToIssue } from "../../src/lib/issues";
import { createStampSizePreset } from "../../src/lib/stamp-size-presets";

// Choosing a size preset while creating a stamp range (#807; ADR-0048 §4). The stamps are born with
// the preset's pair, inside the transaction that creates them.
//
// What is at risk is **which stamps get the size**. A range that duplicates a catalog number already
// held still creates a new stamp in a warning collection, so the old stamp carrying that number sits
// right beside the new one — and it must come out of this exactly as it went in.

let nextTestIssueNo = 9807;

describe("a size preset chosen while adding a stamp range (#807)", () => {
  const ts = Date.now();
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let areaId: string;
  let vendorId: string;
  let presetId: string;
  let foreignPresetId: string;

  before(async () => {
    userId = `test-user-rangesize-${ts}`;
    otherUserId = `test-user-rangesize-other-${ts}`;
    await prisma.user.createMany({
      data: [userId, otherUserId].map((id) => ({
        id,
        name: `Test User ${id}`,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-rangesize-${ts}`, name: "Range size", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const foreignCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-rangesize-other-${ts}`,
          name: "Someone else's",
          baseCurrency: "EUR",
          ownerId: otherUserId,
        },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Infla" } })).id;
    vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    // A tenth of a millimetre on one side, so a write that rounded or truncated would show.
    presetId = (
      await createStampSizePreset(userId, collectionId, { widthMm: 21.5, heightMm: 25, name: "Germania" })
    ).id;
    foreignPresetId = (
      await createStampSizePreset(otherUserId, foreignCollectionId, { widthMm: 40, heightMm: 30 })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  async function newIssue(name: string) {
    return prisma.issue.create({
      data: { collectionId, issueNo: nextTestIssueNo++, collectionAreaId: areaId, name, year: 1921 },
    });
  }

  /** The issue's stamps by catalog number, with the size each one stores. */
  async function sizesOn(issueId: string) {
    const members = await prisma.issueMember.findMany({
      where: { issueId },
      orderBy: { sortOrder: "asc" },
      select: {
        stamp: {
          select: {
            id: true,
            widthMm: true,
            heightMm: true,
            catalogNumbers: { select: { number: true } },
          },
        },
      },
    });
    return members.map(({ stamp }) => ({
      id: stamp.id,
      number: stamp.catalogNumbers[0]?.number,
      widthMm: stamp.widthMm === null ? null : stamp.widthMm.toNumber(),
      heightMm: stamp.heightMm === null ? null : stamp.heightMm.toNumber(),
    }));
  }

  const range = (numbers: string[]) => ({
    count: numbers.length,
    vendors: [{ catalogVendorId: vendorId, numbers }],
  });

  it("writes the preset's pair onto every stamp the range creates", async () => {
    const issue = await newIssue("Germania overprints");
    await addStampRangeToIssue(userId, collectionId, issue.id, range(["1", "2", "3"]), {
      sizePresetId: presetId,
    });

    const stamps = await sizesOn(issue.id);
    assert.deepEqual(
      stamps.map((s) => [s.number, s.widthMm, s.heightMm]),
      [
        ["1", 21.5, 25],
        ["2", 21.5, 25],
        ["3", 21.5, 25],
      ]
    );
  });

  it("creates sizeless stamps when no preset is chosen, exactly as before", async () => {
    const issue = await newIssue("No size");
    await addStampRangeToIssue(userId, collectionId, issue.id, range(["10", "11"]));
    const empty = await newIssue("Blank preset");
    await addStampRangeToIssue(userId, collectionId, empty.id, range(["20"]), { sizePresetId: null });

    for (const s of [...(await sizesOn(issue.id)), ...(await sizesOn(empty.id))]) {
      assert.equal(s.widthMm, null, `${s.number} width`);
      assert.equal(s.heightMm, null, `${s.number} height`);
    }
  });

  it("does not size a stamp already holding a number the range duplicates", async () => {
    const earlier = await newIssue("Earlier");
    await addStampRangeToIssue(userId, collectionId, earlier.id, range(["100"]));
    const [held] = await sizesOn(earlier.id);

    // `100` again — the warning collection's path, where the duplicate is a new stamp.
    const later = await newIssue("Later");
    await addStampRangeToIssue(userId, collectionId, later.id, range(["100", "101"]), {
      sizePresetId: presetId,
    });

    const created = await sizesOn(later.id);
    assert.equal(created.length, 2);
    assert.ok(!created.some((s) => s.id === held.id), "the range made new stamps");
    for (const s of created) assert.deepEqual([s.widthMm, s.heightMm], [21.5, 25]);

    const [after] = await sizesOn(earlier.id);
    assert.deepEqual([after.id, after.widthMm, after.heightMm], [held.id, null, null]);
  });

  it("refuses a preset from another collection and creates nothing", async () => {
    const issue = await newIssue("Foreign preset");
    await assert.rejects(
      () =>
        addStampRangeToIssue(userId, collectionId, issue.id, range(["200", "201"]), {
          sizePresetId: foreignPresetId,
        }),
      /preset not found/
    );
    assert.deepEqual(await sizesOn(issue.id), []);
  });
});
