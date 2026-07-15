import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { seedDemoData, wipeDemoData } from "../../src/lib/demo/index";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-${suffix}`, name: `Collection ${suffix}`, ownerId },
  });
}

describe("seedDemoData", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`demo-seed-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `demo-seed-${ts}`)).id;
    await prisma.$transaction((tx) => seedDemoData(collectionId, tx as never));
  });

  after(async () => {
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("seeds two catalog vendors", async () => {
    const vendors = await prisma.catalogVendor.findMany({
      where: { collectionId },
      orderBy: { name: "asc" },
    });
    assert.equal(vendors.length, 2);
    assert.equal(vendors[0].name, "Michel");
    assert.equal(vendors[0].abbreviation, "Mi");
    assert.equal(vendors[1].name, "Scott");
    assert.equal(vendors[1].abbreviation, "Sc");
  });

  it("seeds one catalog name per vendor", async () => {
    const vendors = await prisma.catalogVendor.findMany({
      where: { collectionId },
      include: { catalogNames: true },
      orderBy: { name: "asc" },
    });
    const michelNames = vendors[0].catalogNames;
    assert.equal(michelNames.length, 1);
    assert.equal(michelNames[0].name, "Michel Deutschland");
    assert.equal(michelNames[0].currency, "EUR");

    const scottNames = vendors[1].catalogNames;
    assert.equal(scottNames.length, 1);
    assert.equal(scottNames[0].name, "Scott US");
    assert.equal(scottNames[0].currency, "USD");
  });

  it("seeds Europe root area with Germany and France children", async () => {
    const areas = await prisma.collectionArea.findMany({
      where: { collectionId },
      orderBy: { name: "asc" },
    });
    assert.equal(areas.length, 3);
    const europe = areas.find((a) => a.name === "Europe");
    assert.ok(europe);
    assert.equal(europe.parentId, null);

    const children = areas.filter((a) => a.parentId === europe.id);
    const childNames = children.map((a) => a.name).sort();
    assert.deepEqual(childNames, ["France", "Germany"]);
  });
});

describe("wipeDemoData", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`demo-wipe-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `demo-wipe-${ts}`)).id;
    await prisma.$transaction((tx) => seedDemoData(collectionId, tx as never));
    await prisma.$transaction((tx) => wipeDemoData(collectionId, tx as never));
  });

  after(async () => {
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("removes all catalog vendors", async () => {
    const vendors = await prisma.catalogVendor.findMany({ where: { collectionId } });
    assert.equal(vendors.length, 0);
  });

  it("removes all catalog names", async () => {
    const vendors = await prisma.catalogVendor.findMany({ where: { collectionId } });
    const vendorIds = vendors.map((v) => v.id);
    const names = await prisma.catalogName.findMany({
      where: { vendorId: { in: vendorIds } },
    });
    assert.equal(names.length, 0);
  });

  it("removes all collection areas", async () => {
    const areas = await prisma.collectionArea.findMany({ where: { collectionId } });
    assert.equal(areas.length, 0);
  });

  it("leaves the collection itself intact", async () => {
    const collection = await prisma.collection.findUnique({ where: { id: collectionId } });
    assert.ok(collection);
  });
});
