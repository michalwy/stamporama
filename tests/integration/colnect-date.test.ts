import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  matchColnectItems,
  confirmColnectMatch,
  overwriteColnectIssuedDate,
} from "../../src/lib/colnect";

// End-to-end coverage of the Colnect issue-date sync (#655) against a real database: the per-field
// fill that adds precision without correcting anything, the disagreement that is reported and left
// alone, and the deliberate overwrite that settles one.

interface Seed {
  userId: string;
  collectionId: string;
  mi: string;
  stamps: Record<string, string>;
}

async function seed(suffix: string): Promise<Seed> {
  const user = await prisma.user.create({
    data: {
      id: `test-user-date-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-date-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: { slug: `col-date-${suffix}`, name: "Dates", baseCurrency: "EUR", ownerId: user.id },
  });
  const collectionId = collection.id;

  const mi = await prisma.catalogVendor.create({
    data: { collectionId, name: "Michel", abbreviation: "Mi" },
  });
  const area = await prisma.collectionArea.create({
    data: { collectionId, name: `Poland-${suffix}` },
  });
  await prisma.collectionAreaVendor.create({
    data: { collectionAreaId: area.id, catalogVendorId: mi.id, areaPrefix: "PL" },
  });

  async function makeStamp(
    name: string,
    number: string,
    date: { issuedYear?: number; issuedMonth?: number; issuedDay?: number }
  ): Promise<string> {
    const stamp = await prisma.stamp.create({ data: { collectionId, name, ...date } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: stamp.id, catalogVendorId: mi.id, number },
    });
    return stamp.id;
  }

  const stamps: Record<string, string> = {
    // Dated by its issue's year alone — the common case a Colnect page can sharpen.
    yearOnly: await makeStamp("Year only", "100", { issuedYear: 1945 }),
    // No date at all.
    undated: await makeStamp("Undated", "200", {}),
    // Already dated to the day, and to a different one.
    disagreeing: await makeStamp("Disagreeing", "300", {
      issuedYear: 1945,
      issuedMonth: 1,
      issuedDay: 23,
    }),
    // Dated more precisely than the page it will be matched against.
    precise: await makeStamp("Precise", "400", { issuedYear: 1945, issuedMonth: 1, issuedDay: 22 }),
  };

  return { userId: user.id, collectionId, mi: mi.id, stamps };
}

const dateOf = async (stampId: string) =>
  prisma.stamp.findUniqueOrThrow({
    where: { id: stampId },
    select: { issuedYear: true, issuedMonth: true, issuedDay: true },
  });

/** One Colnect item, matched on its Michel number, carrying whatever the page printed as its date. */
const item = (colnectId: string, number: string, issuedOn?: string) => ({
  colnectId,
  catalogRefs: [{ catalog: "Mi", number: `PL ${number}` }],
  ...(issuedOn ? { issuedOn } : {}),
});

describe("Colnect issue-date sync", () => {
  let s: Seed;

  before(async () => {
    s = await seed(`${Date.now()}`);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: s.userId } });
    await prisma.user.delete({ where: { id: s.userId } });
  });

  it("is off unless asked for", async () => {
    const [result] = await matchColnectItems(s.userId, s.collectionId, [item("1", "100", "1945-01-22")], {
      dryRun: true,
    });
    assert.equal(result.status, "auto");
    if (result.status === "auto") assert.equal(result.stamp?.dateProposal, null);
  });

  it("proposes the missing components without writing on a dry run", async () => {
    const [result] = await matchColnectItems(s.userId, s.collectionId, [item("1", "100", "1945-01-22")], {
      dryRun: true,
      issueDate: true,
    });
    assert.equal(result.status, "auto");
    if (result.status === "auto") {
      const p = result.stamp?.dateProposal;
      assert.equal(p?.status, "would-fill");
      assert.equal(p?.currentLabel, "1945");
      assert.equal(p?.label, "22 Jan 1945");
    }
    assert.deepEqual(await dateOf(s.stamps.yearOnly), {
      issuedYear: 1945,
      issuedMonth: null,
      issuedDay: null,
    });
  });

  it("writes the missing components on a real run, keeping the year we already had", async () => {
    const [result] = await matchColnectItems(s.userId, s.collectionId, [item("1", "100", "1945-01-22")], {
      issueDate: true,
    });
    assert.equal(result.status, "auto");
    if (result.status === "auto") assert.equal(result.stamp?.dateProposal?.status, "filled");
    assert.deepEqual(await dateOf(s.stamps.yearOnly), {
      issuedYear: 1945,
      issuedMonth: 1,
      issuedDay: 22,
    });
  });

  it("dates an undated stamp outright", async () => {
    await matchColnectItems(s.userId, s.collectionId, [item("2", "200", "1938-07-04")], {
      issueDate: true,
    });
    assert.deepEqual(await dateOf(s.stamps.undated), {
      issuedYear: 1938,
      issuedMonth: 7,
      issuedDay: 4,
    });
  });

  it("reports a disagreement and writes nothing", async () => {
    const [result] = await matchColnectItems(s.userId, s.collectionId, [item("3", "300", "1945-01-22")], {
      issueDate: true,
    });
    assert.equal(result.status, "auto");
    if (result.status === "auto") {
      const p = result.stamp?.dateProposal;
      assert.equal(p?.status, "conflict");
      assert.deepEqual(p?.conflictingFields, ["day"]);
      assert.equal(p?.currentLabel, "23 Jan 1945");
      assert.equal(p?.colnectLabel, "22 Jan 1945");
    }
    assert.deepEqual(await dateOf(s.stamps.disagreeing), {
      issuedYear: 1945,
      issuedMonth: 1,
      issuedDay: 23,
    });
  });

  it("proposes nothing when Colnect knows no more than we do", async () => {
    const [result] = await matchColnectItems(s.userId, s.collectionId, [item("4", "400", "1945")], {
      issueDate: true,
    });
    assert.equal(result.status, "auto");
    if (result.status === "auto") assert.equal(result.stamp?.dateProposal, null);
  });

  it("dates the stamp the user picked when confirming a match", async () => {
    const stamp = await prisma.stamp.create({
      data: { collectionId: s.collectionId, name: "Picked", issuedYear: 1950 },
    });
    const written = await confirmColnectMatch(s.userId, s.collectionId, {
      colnectId: "5",
      stampId: stamp.id,
      issueDate: true,
      issuedOn: "1950-03-08",
    });
    assert.equal(written.date?.status, "filled");
    assert.deepEqual(await dateOf(stamp.id), {
      issuedYear: 1950,
      issuedMonth: 3,
      issuedDay: 8,
    });

    // Without the flag, the same confirmation leaves the date alone.
    const other = await prisma.stamp.create({
      data: { collectionId: s.collectionId, name: "Not dated", issuedYear: 1950 },
    });
    const plain = await confirmColnectMatch(s.userId, s.collectionId, {
      colnectId: "6",
      stampId: other.id,
      issuedOn: "1950-03-08",
    });
    assert.equal(plain.date, null);
    assert.deepEqual(await dateOf(other.id), {
      issuedYear: 1950,
      issuedMonth: null,
      issuedDay: null,
    });
  });

  describe("overwriteColnectIssuedDate", () => {
    it("replaces the date whole, clearing what Colnect does not state", async () => {
      const result = await overwriteColnectIssuedDate(s.userId, s.collectionId, {
        stampId: s.stamps.disagreeing,
        issuedOn: "1946",
      });
      assert.equal(result.label, "1946");
      assert.deepEqual(await dateOf(s.stamps.disagreeing), {
        issuedYear: 1946,
        issuedMonth: null,
        issuedDay: null,
      });
    });

    it("refuses a value that is not a date, and a stamp outside the collection", async () => {
      await assert.rejects(() =>
        overwriteColnectIssuedDate(s.userId, s.collectionId, {
          stampId: s.stamps.precise,
          issuedOn: "unknown",
        })
      );
      await assert.rejects(() =>
        overwriteColnectIssuedDate(s.userId, s.collectionId, {
          stampId: "nonexistent-stamp",
          issuedOn: "1946-02-03",
        })
      );
      await assert.rejects(() =>
        overwriteColnectIssuedDate("wrong-user", s.collectionId, {
          stampId: s.stamps.precise,
          issuedOn: "1946-02-03",
        })
      );
      assert.deepEqual(await dateOf(s.stamps.precise), {
        issuedYear: 1945,
        issuedMonth: 1,
        issuedDay: 22,
      });
    });
  });
});
