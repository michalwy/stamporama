import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  matchColnectItems,
  confirmColnectMatch,
  overwriteColnectAttributes,
} from "../../src/lib/colnect";
import { setStampIssueFormatColnectValue } from "../../src/lib/stamp-issue-formats";

// Filling a stamp's issue format from its Colnect page (#2443) against a real database: Colnect's
// "Format" mapped through `colnectValue` on the issue-format row like the four attribute
// dictionaries (#739), an unmapped word named and nothing changed, Colnect's "Stamp" read as an
// ordinary stamp, and a format the collector set never overwritten without the confirm.

interface Seed {
  userId: string;
  collectionId: string;
  stamps: Record<string, string>;
  souvenirSheet: string;
  exSouvenirSheet: string;
  miniatureSheet: string;
}

async function seed(suffix: string): Promise<Seed> {
  const user = await prisma.user.create({
    data: {
      id: `test-user-isf-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-isf-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: { slug: `col-isf-${suffix}`, name: "Issue formats", baseCurrency: "EUR", ownerId: user.id },
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

  // Only the souvenir sheet is mapped; the other two are what `unmapped` is read against.
  const issueFormat = (name: string, abbreviation: string, sortOrder: number, colnectValue?: string) =>
    prisma.stampIssueFormat.create({
      data: { collectionId, name, abbreviation, sortOrder, colnectValue },
      select: { id: true },
    });
  const souvenirSheet = await issueFormat("Souvenir sheet", "Bl", 0, "Souvenir Sheet");
  const exSouvenirSheet = await issueFormat("Stamp from a souvenir sheet", "exBl", 1);
  const miniatureSheet = await issueFormat("Miniature sheet", "MS", 2);

  async function makeStamp(name: string, number: string, issueFormatId?: string): Promise<string> {
    const stamp = await prisma.stamp.create({ data: { collectionId, name, issueFormatId } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: stamp.id, catalogVendorId: mi.id, number },
    });
    return stamp.id;
  }

  return {
    userId: user.id,
    collectionId,
    souvenirSheet: souvenirSheet.id,
    exSouvenirSheet: exSouvenirSheet.id,
    miniatureSheet: miniatureSheet.id,
    stamps: {
      sheet: await makeStamp("A souvenir sheet", "500"),
      unmapped: await makeStamp("A miniature sheet", "501"),
      ordinary: await makeStamp("An ordinary stamp", "100"),
      fromSheet: await makeStamp("A stamp from a sheet", "101", exSouvenirSheet.id),
    },
  };
}

const issueFormatOf = async (stampId: string) =>
  (await prisma.stamp.findUniqueOrThrow({ where: { id: stampId }, select: { issueFormatId: true } }))
    .issueFormatId;

const item = (colnectId: string, number: string, issueFormat: string) => ({
  colnectId,
  catalogRefs: [{ catalog: "Mi", number: `PL ${number}` }],
  attributes: { issueFormat },
});

describe("Colnect issue-format sync (#2443)", () => {
  let s: Seed;

  before(async () => {
    s = await seed(`${Date.now()}`);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: s.userId } });
    await prisma.user.delete({ where: { id: s.userId } });
  });

  it("fills Souvenir sheet from a souvenir sheet's page, once it is mapped", async () => {
    const [result] = await matchColnectItems(
      s.userId,
      s.collectionId,
      [item("1", "500", "Souvenir Sheet")],
      { attributes: true }
    );
    assert.equal(result.status, "auto");
    if (result.status === "auto") {
      assert.deepEqual(
        result.stamp?.attributes.map((p) => [p.field, p.fieldLabel, p.status, p.label]),
        [["issueFormat", "Issue format", "filled", "Souvenir sheet"]]
      );
    }
    assert.equal(await issueFormatOf(s.stamps.sheet), s.souvenirSheet);
  });

  it("names an unmapped Colnect format and changes nothing", async () => {
    const [result] = await matchColnectItems(
      s.userId,
      s.collectionId,
      [item("2", "501", "Miniature Sheet")],
      { attributes: true }
    );
    assert.equal(result.status, "auto");
    if (result.status === "auto") {
      assert.deepEqual(
        result.stamp?.attributes.map((p) => [p.field, p.status, p.colnectLabel]),
        [["issueFormat", "unmapped", "Miniature Sheet"]]
      );
    }
    assert.equal(await issueFormatOf(s.stamps.unmapped), null);
    assert.equal(
      await prisma.stampIssueFormat.count({ where: { collectionId: s.collectionId } }),
      3,
      "nothing is created for a word the mapping does not cover"
    );
  });

  it("leaves the issue format empty for Colnect's Stamp", async () => {
    const [result] = await matchColnectItems(
      s.userId,
      s.collectionId,
      [item("3", "100", "Stamp")],
      { attributes: true }
    );
    assert.equal(result.status, "auto");
    if (result.status === "auto") assert.deepEqual(result.stamp?.attributes, []);
    assert.equal(await issueFormatOf(s.stamps.ordinary), null);
  });

  // A stamp from a souvenir sheet is a "Stamp" on Colnect: no disagreement with the collector's exBl.
  it("does not read Colnect's Stamp as a disagreement with a format the collector set", async () => {
    const written = await confirmColnectMatch(s.userId, s.collectionId, {
      colnectId: "4",
      stampId: s.stamps.fromSheet,
      attributeSync: true,
      attributes: { issueFormat: "Stamp" },
    });
    assert.deepEqual(written.attributes, []);
    assert.equal(await issueFormatOf(s.stamps.fromSheet), s.exSouvenirSheet);
  });

  it("reports a format the collector set differently, and writes it only on the confirm", async () => {
    const written = await confirmColnectMatch(s.userId, s.collectionId, {
      colnectId: "4",
      stampId: s.stamps.fromSheet,
      attributeSync: true,
      attributes: { issueFormat: "Souvenir Sheet" },
    });
    assert.deepEqual(
      written.attributes.map((p) => [p.status, p.currentLabel, p.colnectLabel]),
      [["conflict", "Stamp from a souvenir sheet", "Souvenir Sheet"]]
    );
    assert.equal(await issueFormatOf(s.stamps.fromSheet), s.exSouvenirSheet);

    const settled = await overwriteColnectAttributes(s.userId, s.collectionId, {
      stampId: s.stamps.fromSheet,
      attributes: { issueFormat: "Souvenir Sheet" },
    });
    assert.deepEqual(
      settled.map((p) => [p.field, p.status]),
      [["issueFormat", "filled"]]
    );
    assert.equal(await issueFormatOf(s.stamps.fromSheet), s.souvenirSheet);
  });

  it("refuses Colnect's Stamp and a word another issue format holds, and clears with a blank", async () => {
    await assert.rejects(
      setStampIssueFormatColnectValue(s.userId, s.miniatureSheet, " stamp "),
      /ordinary stamp/
    );
    await assert.rejects(
      setStampIssueFormatColnectValue(s.userId, s.miniatureSheet, "souvenir  sheet"),
      /already mapped/
    );
    await setStampIssueFormatColnectValue(s.userId, s.miniatureSheet, " Miniature Sheet ");
    const mapped = await prisma.stampIssueFormat.findUniqueOrThrow({
      where: { id: s.miniatureSheet },
      select: { colnectValue: true },
    });
    assert.equal(mapped.colnectValue, "Miniature Sheet");
    await setStampIssueFormatColnectValue(s.userId, s.miniatureSheet, "");
    const cleared = await prisma.stampIssueFormat.findUniqueOrThrow({
      where: { id: s.miniatureSheet },
      select: { colnectValue: true },
    });
    assert.equal(cleared.colnectValue, null);
  });
});
