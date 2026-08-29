import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { addStampToIssue, addVariantRangeToStamp } from "../../src/lib/issues";
import { DEFAULT_CHECKLIST } from "../../src/lib/checklist-vocabulary";

// A run of variants added under one base stamp (#722) — `addStampRangeToIssue` one level down.
// What matters here is that the run comes out exactly as the single add dialog would have left
// each stamp: parented, classified, filed under the same issue, dated from the *base stamp* — and
// off the issue's checklist, because a variant is not the issue's set.

let nextTestIssueNo = 9801;

describe("adding a range of variants under a base stamp (#722)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let vendorId: string;
  let defaultSubtypeId: string;
  let otherSubtypeId: string;

  before(async () => {
    const ts = Date.now();
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-varrange-${ts}`,
          name: `Test User varrange-${ts}`,
          email: `test-varrange-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-varrange-${ts}`,
          name: `Collection ${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Area" } })).id;
    vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    defaultSubtypeId = (
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
    otherSubtypeId = (
      await prisma.stampSubtype.create({
        data: {
          collectionId,
          name: "Error",
          actsAsVariant: false,
          isDefault: false,
          sortOrder: 1,
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newIssue(name: string, year: number | null = 1958) {
    return prisma.issue.create({
      data: { collectionId, issueNo: nextTestIssueNo++, collectionAreaId: areaId, name, year },
    });
  }

  async function addBase(issueId: string, number: string, issuedYear: number | null) {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      name: "base",
      issuedYear,
      catalogNumbers: [{ catalogVendorId: vendorId, number }],
      // The issue's own set, the way a root stamp is added.
      checklistIds: [DEFAULT_CHECKLIST],
    });
    return stampId;
  }

  /** The children of `parentId`, with everything the run is asserted on. */
  async function childrenOf(parentId: string) {
    return prisma.stamp.findMany({
      where: { parentId },
      select: {
        id: true,
        name: true,
        issuedYear: true,
        subtypeId: true,
        actsAsVariantOverride: true,
        catalogNumbers: { select: { catalogVendorId: true, number: true } },
        checklistEntries: { select: { checklistId: true } },
        issueMemberships: { select: { issueId: true, sortOrder: true } },
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      },
    });
  }

  it("creates the run under the base stamp, numbered, classified and filed", async () => {
    const issue = await newIssue("Birds");
    // A base stamp dated apart from its issue — a variant is dated from the node it hangs
    // under (#360), so this is the year the children must get.
    const base = await addBase(issue.id, "240", 1961);

    await addVariantRangeToStamp(userId, collectionId, issue.id, base, {
      catalogVendorId: vendorId,
      numbers: ["240a", "240b", "240c"],
      subtypeId: otherSubtypeId,
    });

    const children = await childrenOf(base);
    assert.equal(children.length, 3);
    assert.deepEqual(
      children.map((c) => c.catalogNumbers[0].number).sort(),
      ["240a", "240b", "240c"]
    );
    for (const child of children) {
      assert.equal(child.name, null);
      assert.equal(child.issuedYear, 1961, "dated from the base stamp, not the issue");
      assert.equal(child.subtypeId, otherSubtypeId);
      assert.equal(child.actsAsVariantOverride, null);
      assert.equal(child.catalogNumbers[0].catalogVendorId, vendorId);
      assert.deepEqual(child.issueMemberships.map((m) => m.issueId), [issue.id]);
      assert.deepEqual(child.stampAreaLinks, [{ collectionAreaId: areaId, isPrimary: true }]);
      // Not the issue's set: a variant is an extra, exactly as the single add dialog leaves it.
      assert.deepEqual(child.checklistEntries, []);
    }

    // Filed after everything already in the issue, in the order the numbers were given (#549).
    const byNumber = new Map(children.map((c) => [c.catalogNumbers[0].number, c]));
    const order = ["240a", "240b", "240c"].map(
      (n) => byNumber.get(n)!.issueMemberships[0].sortOrder
    );
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    const baseOrder = await prisma.issueMember.findUniqueOrThrow({
      where: { issueId_stampId: { issueId: issue.id, stampId: base } },
      select: { sortOrder: true },
    });
    assert.ok(order[0] > baseOrder.sortOrder);
  });

  it("falls back to the collection's default subtype when none is chosen", async () => {
    const issue = await newIssue("Default subtype");
    const base = await addBase(issue.id, "300", 1958);

    await addVariantRangeToStamp(userId, collectionId, issue.id, base, {
      catalogVendorId: vendorId,
      numbers: ["300a"],
    });

    const [child] = await childrenOf(base);
    assert.equal(child.subtypeId, defaultSubtypeId);
  });

  it("leaves the base stamp's own checklist entry alone", async () => {
    const issue = await newIssue("Checklists");
    const base = await addBase(issue.id, "400", 1958);
    const before = await prisma.checklistStamp.count({ where: { stampId: base } });
    assert.equal(before, 1);

    await addVariantRangeToStamp(userId, collectionId, issue.id, base, {
      catalogVendorId: vendorId,
      numbers: ["400a", "400b"],
    });

    assert.equal(await prisma.checklistStamp.count({ where: { stampId: base } }), 1);
  });

  it("refuses a base stamp that is not a member of the issue", async () => {
    const home = await newIssue("Home");
    const elsewhere = await newIssue("Elsewhere");
    const base = await addBase(home.id, "500", 1958);

    await assert.rejects(
      addVariantRangeToStamp(userId, collectionId, elsewhere.id, base, {
        catalogVendorId: vendorId,
        numbers: ["500a"],
      }),
      /not a member of this issue/
    );
  });

  it("refuses a subtype from another collection", async () => {
    const issue = await newIssue("Foreign subtype");
    const base = await addBase(issue.id, "600", 1958);

    await assert.rejects(
      addVariantRangeToStamp(userId, collectionId, issue.id, base, {
        catalogVendorId: vendorId,
        numbers: ["600a"],
        subtypeId: "no-such-subtype",
      }),
      /Subtype not found/
    );
  });

  it("refuses an empty run", async () => {
    const issue = await newIssue("Empty");
    const base = await addBase(issue.id, "700", 1958);

    await assert.rejects(
      addVariantRangeToStamp(userId, collectionId, issue.id, base, {
        catalogVendorId: vendorId,
        numbers: [],
      }),
      /at least one stamp/
    );
  });
});
