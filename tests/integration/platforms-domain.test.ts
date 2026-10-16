import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createPlatform,
  deletePlatform,
  ensureModulePlatforms,
  getModulePlatformSettings,
  listPlatforms,
  PlatformInUseError,
  PlatformNameTakenError,
  resolvePlatform,
  searchPlatforms,
  setPlatformEnabled,
  updatePlatform,
} from "../../src/lib/platforms";

// Platforms as their own entity (#1955; ADR-0071): Settings → Platforms adds, renames, edits and
// deletes the generic ones, delete refused while anything names one; the module platforms keep their
// names and cannot be deleted; and a platform switched off is offered by no picker for a new record
// while every record naming it keeps showing it.

describe("Platforms (#1955)", () => {
  const ts = Date.now();
  const userId = `test-user-platforms-${ts}`;
  let collectionId: string;

  before(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User platforms-${ts}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-platforms-${ts}`, name: "Platforms", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    await ensureModulePlatforms(collectionId);
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("adds a generic platform, switched on, with its settings", async () => {
    const ebay = await createPlatform(userId, collectionId, {
      name: "  eBay ",
      platformCurrency: "USD",
      market: "us",
      defaultListingType: "auction",
      defaultStartingPrice: "1.5",
      maxPhotos: 12,
    });
    assert.equal(ebay.name, "eBay");
    assert.equal(ebay.platformModule, null);
    assert.equal(ebay.enabled, true);
    assert.equal(ebay.platformCurrency, "USD");
    assert.equal(ebay.market, "US");
    assert.equal(ebay.defaultStartingPrice, "1.50");
    assert.equal(ebay.maxPhotos, 12);
  });

  it("refuses a name taken — by another platform, or by a module platform in any case", async () => {
    await assert.rejects(() => createPlatform(userId, collectionId, { name: "eBay" }), PlatformNameTakenError);
    await assert.rejects(() => createPlatform(userId, collectionId, { name: "allegro" }), PlatformNameTakenError);
    await assert.rejects(() => createPlatform(userId, collectionId, { name: " Colnect " }), PlatformNameTakenError);
    await assert.rejects(() => createPlatform(userId, collectionId, { name: "  " }));
  });

  it("renames and edits a generic platform, and keeps a module platform's name", async () => {
    const forum = await createPlatform(userId, collectionId, { name: "Forum" });
    const renamed = await updatePlatform(userId, forum.id, { name: "Stamp forum", platformCurrency: "PLN" });
    assert.equal(renamed.name, "Stamp forum");
    assert.equal(renamed.platformCurrency, "PLN");
    await assert.rejects(
      () => updatePlatform(userId, forum.id, { name: "Delcampe" }),
      PlatformNameTakenError
    );

    const delcampe = await getModulePlatformSettings(userId, collectionId, "delcampe");
    const saved = await updatePlatform(userId, delcampe.id, {
      name: "Something else",
      platformCurrency: "EUR",
      enabled: true,
    });
    assert.equal(saved.name, "Delcampe");
    assert.equal(saved.platformCurrency, "EUR");
    assert.equal(saved.enabled, true);
  });

  it("lists the generic platforms for Settings → Platforms, and the module ones apart", async () => {
    assert.deepEqual(
      (await listPlatforms(userId, collectionId, "generic")).map((p) => p.name).sort(),
      ["Stamp forum", "eBay"].sort()
    );
    assert.equal((await listPlatforms(userId, collectionId, "module")).length, 5);
  });

  it("refuses to delete a platform an offer names, or any module platform, and deletes one nothing names", async () => {
    const ebay = (await listPlatforms(userId, collectionId, "generic")).find((p) => p.name === "eBay")!;
    await prisma.offer.create({
      data: { collectionId, offerNo: 1, platformId: ebay.id, price: "1.00", currency: "USD" },
    });
    assert.equal((await listPlatforms(userId, collectionId, "generic")).find((p) => p.id === ebay.id)!.referenceCount, 1);
    await assert.rejects(() => deletePlatform(userId, ebay.id), PlatformInUseError);

    const delcampe = await getModulePlatformSettings(userId, collectionId, "delcampe");
    await assert.rejects(() => deletePlatform(userId, delcampe.id), PlatformInUseError);

    const forum = (await listPlatforms(userId, collectionId, "generic")).find((p) => p.name === "Stamp forum")!;
    await prisma.shippingOption.create({
      data: { collectionId, platformId: forum.id, name: "Letter", price: "5.00", currency: "PLN" },
    });
    await deletePlatform(userId, forum.id);
    assert.equal(await prisma.platform.count({ where: { id: forum.id } }), 0);
    // What the platform owned goes with it.
    assert.equal(await prisma.shippingOption.count({ where: { platformId: forum.id } }), 0);
  });

  it("offers a switched-off platform in no picker, while a record naming it still shows it", async () => {
    const ebay = (await listPlatforms(userId, collectionId, "generic")).find((p) => p.name === "eBay")!;
    assert.ok((await searchPlatforms(userId, collectionId, "e")).some((p) => p.id === ebay.id));
    // A module platform not switched on is not offered either.
    assert.ok(!(await searchPlatforms(userId, collectionId, "")).some((p) => p.name === "Allegro"));
    assert.ok((await searchPlatforms(userId, collectionId, "")).some((p) => p.name === "Delcampe"));

    await setPlatformEnabled(userId, ebay.id, false);
    assert.ok(!(await searchPlatforms(userId, collectionId, "")).some((p) => p.id === ebay.id));
    const offer = await prisma.offer.findFirstOrThrow({
      where: { collectionId, platformId: ebay.id },
      select: { platform: { select: { name: true } } },
    });
    assert.equal(offer.platform.name, "eBay");
  });

  it("resolves a typed platform name, creating a generic platform for a new one", async () => {
    const delcampe = await getModulePlatformSettings(userId, collectionId, "delcampe");
    assert.equal(await resolvePlatform(collectionId, { name: "DELCAMPE" }), delcampe.id);
    const created = await resolvePlatform(collectionId, { name: "Philasearch shop" });
    assert.ok(created);
    const row = await prisma.platform.findUniqueOrThrow({ where: { id: created } });
    assert.equal(row.platformModule, null);
    assert.equal(row.enabled, true);
    assert.equal(await resolvePlatform(collectionId, { name: "philasearch shop" }), created);
    // An id of another collection is not honoured; nothing at all is null.
    assert.equal(await resolvePlatform(collectionId, { id: "no-such-platform" }), null);
  });

  it("refuses another owner", async () => {
    await assert.rejects(() => listPlatforms("someone-else", collectionId));
    await assert.rejects(() => createPlatform("someone-else", collectionId, { name: "X" }));
    const ebay = (await listPlatforms(userId, collectionId, "generic")).find((p) => p.name === "eBay")!;
    await assert.rejects(() => updatePlatform("someone-else", ebay.id, { name: "Y" }));
    await assert.rejects(() => setPlatformEnabled("someone-else", ebay.id, true));
    await assert.rejects(() => deletePlatform("someone-else", ebay.id));
  });
});
