import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  matchColnectItems,
  confirmColnectMatch,
  overwriteColnectAttributes,
} from "../../src/lib/colnect";
import { setStampAttributeColnectValue } from "../../src/lib/stamp-attributes";

// End-to-end coverage of the Colnect stamp-attribute sync (#739) against a real database: the fill
// that adds what we state nothing for, the disagreement that is reported and left alone, the Colnect
// word the mapping cannot place, and the deliberate overwrite that settles one.

interface Seed {
  userId: string;
  collectionId: string;
  stamps: Record<string, string>;
  carmine: string;
  greyRed: string;
  lozenges: string;
}

async function seed(suffix: string): Promise<Seed> {
  const user = await prisma.user.create({
    data: {
      id: `test-user-attr-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-attr-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: { slug: `col-attr-${suffix}`, name: "Attributes", baseCurrency: "EUR", ownerId: user.id },
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

  // Two colours, one mapped to Colnect's own word and one to a different spelling of it, and a
  // watermark. Nothing else is mapped, which is what the `unmapped` case is read against.
  const carmine = await prisma.stampColor.create({
    data: { collectionId, name: "Carmine", sortOrder: 0, colnectValue: "Carmine" },
  });
  const greyRed = await prisma.stampColor.create({
    data: { collectionId, name: "Grey red", sortOrder: 1, colnectValue: "Grey Red" },
  });
  const lozenges = await prisma.stampWatermark.create({
    data: { collectionId, name: "Lozenges", sortOrder: 0, colnectValue: "Lozenges" },
  });

  async function makeStamp(
    name: string,
    number: string,
    attributes: Record<string, string | null> = {}
  ): Promise<string> {
    const stamp = await prisma.stamp.create({ data: { collectionId, name, ...attributes } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: stamp.id, catalogVendorId: mi.id, number },
    });
    return stamp.id;
  }

  const stamps: Record<string, string> = {
    bare: await makeStamp("States nothing", "100"),
    stated: await makeStamp("States its own", "200", {
      perforation: "11½",
      colorId: carmine.id,
    }),
    agreeing: await makeStamp("Agrees", "300", { denomination: "10 gr", colorId: carmine.id }),
    unmappable: await makeStamp("Unmappable", "400"),
  };

  return { userId: user.id, collectionId, stamps, carmine: carmine.id, greyRed: greyRed.id, lozenges: lozenges.id };
}

const attributesOf = async (stampId: string) =>
  prisma.stamp.findUniqueOrThrow({
    where: { id: stampId },
    select: {
      denomination: true,
      perforation: true,
      colorId: true,
      watermarkId: true,
      paperId: true,
      printingId: true,
    },
  });

/** One Colnect item, matched on its Michel number, carrying whatever the page stated. */
const item = (
  colnectId: string,
  number: string,
  attributes?: Record<string, string>
) => ({
  colnectId,
  catalogRefs: [{ catalog: "Mi", number: `PL ${number}` }],
  ...(attributes ? { attributes } : {}),
});

describe("Colnect stamp-attribute sync", () => {
  let s: Seed;

  before(async () => {
    s = await seed(`${Date.now()}`);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: s.userId } });
    await prisma.user.delete({ where: { id: s.userId } });
  });

  it("is off unless asked for", async () => {
    const [result] = await matchColnectItems(
      s.userId,
      s.collectionId,
      [item("1", "100", { denomination: "10 gr", color: "Carmine" })],
      { dryRun: true }
    );
    assert.equal(result.status, "auto");
    if (result.status === "auto") assert.deepEqual(result.stamp?.attributes, []);
  });

  it("proposes what the stamp states nothing for, without writing on a dry run", async () => {
    const [result] = await matchColnectItems(
      s.userId,
      s.collectionId,
      [item("1", "100", { denomination: "10 gr", perforation: "11½", color: "Carmine" })],
      { dryRun: true, attributes: true }
    );
    assert.equal(result.status, "auto");
    if (result.status === "auto") {
      assert.deepEqual(
        result.stamp?.attributes.map((p) => [p.field, p.status, p.label]),
        [
          ["denomination", "would-fill", "10 gr"],
          ["perforation", "would-fill", "11½"],
          ["color", "would-fill", "Carmine"],
        ]
      );
    }
    const stored = await attributesOf(s.stamps.bare);
    assert.equal(stored.denomination, null);
    assert.equal(stored.colorId, null);
  });

  it("writes them on a real run", async () => {
    const [result] = await matchColnectItems(
      s.userId,
      s.collectionId,
      [item("1", "100", { denomination: "10 gr", color: "Carmine", watermark: "Lozenges" })],
      { attributes: true }
    );
    assert.equal(result.status, "auto");
    if (result.status === "auto") {
      assert.ok(result.stamp?.attributes.every((p) => p.status === "filled"));
    }
    const stored = await attributesOf(s.stamps.bare);
    assert.equal(stored.denomination, "10 gr");
    assert.equal(stored.colorId, s.carmine);
    assert.equal(stored.watermarkId, s.lozenges);
  });

  it("reports a disagreement and writes nothing", async () => {
    const [result] = await matchColnectItems(
      s.userId,
      s.collectionId,
      [item("2", "200", { perforation: "12", color: "Grey Red" })],
      { attributes: true }
    );
    assert.equal(result.status, "auto");
    if (result.status === "auto") {
      assert.deepEqual(
        result.stamp?.attributes.map((p) => [p.field, p.status, p.currentLabel, p.colnectLabel]),
        [
          ["perforation", "conflict", "11½", "12"],
          ["color", "conflict", "Carmine", "Grey Red"],
        ]
      );
    }
    const stored = await attributesOf(s.stamps.stated);
    assert.equal(stored.perforation, "11½");
    assert.equal(stored.colorId, s.carmine);
  });

  it("proposes nothing where the two sides agree", async () => {
    const [result] = await matchColnectItems(
      s.userId,
      s.collectionId,
      [item("3", "300", { denomination: "10 GR", color: "carmine" })],
      { attributes: true }
    );
    assert.equal(result.status, "auto");
    if (result.status === "auto") assert.deepEqual(result.stamp?.attributes, []);
  });

  // The mapping's whole point: a word we cannot place is said out loud, nothing is created, and it
  // blocks nothing else on the page.
  it("reports an unmapped Colnect word and still fills the rest", async () => {
    const [result] = await matchColnectItems(
      s.userId,
      s.collectionId,
      [item("4", "400", { color: "Vermilion", watermark: "Lozenges" })],
      { attributes: true }
    );
    assert.equal(result.status, "auto");
    if (result.status === "auto") {
      assert.deepEqual(
        result.stamp?.attributes.map((p) => [p.field, p.status, p.colnectLabel]),
        [
          ["color", "unmapped", "Vermilion"],
          ["watermark", "filled", "Lozenges"],
        ]
      );
    }
    const stored = await attributesOf(s.stamps.unmappable);
    assert.equal(stored.colorId, null);
    assert.equal(stored.watermarkId, s.lozenges);
    assert.equal(await prisma.stampColor.count({ where: { name: "Vermilion" } }), 0);
  });

  it("fills the stamp the user picked when confirming a match", async () => {
    const stamp = await prisma.stamp.create({
      data: { collectionId: s.collectionId, name: "Picked" },
    });
    const written = await confirmColnectMatch(s.userId, s.collectionId, {
      colnectId: "5",
      stampId: stamp.id,
      attributeSync: true,
      attributes: { color: "Carmine" },
    });
    assert.equal(written.attributes[0]?.status, "filled");
    assert.equal((await attributesOf(stamp.id)).colorId, s.carmine);

    // Without the flag, the same confirmation leaves the attributes alone.
    const other = await prisma.stamp.create({
      data: { collectionId: s.collectionId, name: "Untouched" },
    });
    const quiet = await confirmColnectMatch(s.userId, s.collectionId, {
      colnectId: "6",
      stampId: other.id,
      attributes: { color: "Carmine" },
    });
    assert.deepEqual(quiet.attributes, []);
    assert.equal((await attributesOf(other.id)).colorId, null);
  });

  it("settles a disagreement only for the attributes it is sent", async () => {
    const written = await overwriteColnectAttributes(s.userId, s.collectionId, {
      stampId: s.stamps.stated,
      attributes: { color: "Grey Red" },
    });
    assert.deepEqual(
      written.map((p) => [p.field, p.status]),
      [["color", "filled"]]
    );
    const stored = await attributesOf(s.stamps.stated);
    assert.equal(stored.colorId, s.greyRed);
    // The perforation was not sent, so it still says what it said.
    assert.equal(stored.perforation, "11½");
  });

  it("refuses to write an unmapped word even when told to", async () => {
    const written = await overwriteColnectAttributes(s.userId, s.collectionId, {
      stampId: s.stamps.stated,
      attributes: { color: "Vermilion" },
    });
    assert.deepEqual(
      written.map((p) => [p.field, p.status]),
      [["color", "unmapped"]]
    );
    assert.equal((await attributesOf(s.stamps.stated)).colorId, s.greyRed);
  });

  it("refuses two values of one list mapped to the same Colnect word", async () => {
    await assert.rejects(
      setStampAttributeColnectValue(s.userId, "color", s.greyRed, " carmine "),
      /already mapped/
    );
    // …and clears one with a blank, which is the same state as never having mapped it.
    await setStampAttributeColnectValue(s.userId, "color", s.greyRed, "");
    assert.equal(
      (await prisma.stampColor.findUniqueOrThrow({ where: { id: s.greyRed } })).colnectValue,
      null
    );
    await setStampAttributeColnectValue(s.userId, "color", s.greyRed, "Grey Red");
  });
});
