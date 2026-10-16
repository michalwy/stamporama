import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getColnectPlatform } from "../../src/lib/colnect";
import { getModulePlatform } from "../../src/lib/module-platform";
import {
  ensureModulePlatforms,
  getModulePlatformSettings,
  setPlatformEnabled,
  updatePlatform,
} from "../../src/lib/platforms";
import {
  ALLEGRO_PLATFORM_MODULE,
  COLNECT_PLATFORM_MODULE,
  DELCAMPE_PLATFORM_MODULE,
  MODULE_PLATFORMS,
} from "../../src/lib/platform-modules";

// The module platforms (#1955; ADR-0071): every collection holds exactly one platform per module,
// named after it and switched off until its page turns it on. What the Colnect page used to choose —
// which contact *is* Colnect — is now whether the Colnect platform is on, and a module switched off
// answers exactly as an unchosen one did: null, which every caller already treats as not set up.

describe("Module platforms (#1955)", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-modplat-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User modplat-${ts}`,
        email: `test-modplat-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-modplat-${ts}`,
          name: `Collection modplat-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("makes the five, once each, named after their modules and switched off", async () => {
    await ensureModulePlatforms(collectionId);
    await ensureModulePlatforms(collectionId);
    const rows = await prisma.platform.findMany({
      where: { collectionId },
      select: { name: true, platformModule: true, enabled: true, coverSymbols: true },
      orderBy: { name: "asc" },
    });
    assert.deepEqual(
      rows.map((r) => [r.platformModule, r.name, r.enabled]),
      [...MODULE_PLATFORMS]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => [m.module, m.name, false])
    );
    // Facebook's rules are why covering symbols exists (#1665), so its platform starts needing it.
    assert.deepEqual(
      rows.filter((r) => r.coverSymbols).map((r) => r.name),
      ["Facebook"]
    );
  });

  it("answers null while a module's platform is off — the state an unchosen platform used to be", async () => {
    assert.equal(await getColnectPlatform(userId, collectionId), null);
    assert.equal(await getModulePlatform(collectionId, "colnect"), null);
  });

  it("answers the platform once it is switched on, and null again once it is off", async () => {
    const colnect = await getModulePlatformSettings(userId, collectionId, "colnect");
    await setPlatformEnabled(userId, colnect.id, true);
    assert.deepEqual(await getColnectPlatform(userId, collectionId), {
      id: colnect.id,
      name: "Colnect",
    });
    await setPlatformEnabled(userId, colnect.id, false);
    assert.equal(await getColnectPlatform(userId, collectionId), null);
  });

  it("holds one platform per module — a second Colnect is refused by the database", async () => {
    await assert.rejects(() =>
      prisma.platform.create({
        data: { collectionId, name: "Another Colnect", platformModule: "colnect" },
      })
    );
  });

  it("saves Delcampe's private note and its cap empty, whatever is sent, and Allegro's as sent (#1957)", async () => {
    await ensureModulePlatforms(collectionId);
    const platformOf = (platformModule: string) =>
      prisma.platform.findFirstOrThrow({ where: { collectionId, platformModule }, select: { id: true } });
    const sent = { name: "ignored", privateNoteTemplate: "{#copy}{ref}{/copy}", maxPrivateNoteLength: 200 };

    const delcampe = await updatePlatform(userId, (await platformOf(DELCAMPE_PLATFORM_MODULE)).id, sent);
    assert.equal(delcampe.privateNoteTemplate, null);
    assert.equal(delcampe.maxPrivateNoteLength, null);

    const allegro = await updatePlatform(userId, (await platformOf(ALLEGRO_PLATFORM_MODULE)).id, sent);
    assert.equal(allegro.privateNoteTemplate, "{#copy}{ref}{/copy}");
    assert.equal(allegro.maxPrivateNoteLength, 200);
  });

  it("saves Colnect's listing type, starting price, format and title cap empty, and Allegro's as sent (#1959)", async () => {
    await ensureModulePlatforms(collectionId);
    const platformOf = (platformModule: string) =>
      prisma.platform.findFirstOrThrow({ where: { collectionId, platformModule }, select: { id: true } });
    const sent = {
      name: "ignored",
      defaultListingType: "auction",
      defaultStartingPrice: "5",
      descriptionFormat: "html",
      maxTitleLength: 80,
      maxDescriptionLength: 100,
      privateNoteTemplate: "{#copy}{ref}{/copy}",
    };

    const colnect = await updatePlatform(userId, (await platformOf(COLNECT_PLATFORM_MODULE)).id, sent);
    assert.equal(colnect.defaultListingType, null);
    assert.equal(colnect.defaultStartingPrice, null);
    assert.equal(colnect.descriptionFormat, "plain");
    assert.equal(colnect.maxTitleLength, null);
    // What Colnect does use is kept as sent.
    assert.equal(colnect.maxDescriptionLength, 100);
    assert.equal(colnect.privateNoteTemplate, "{#copy}{ref}{/copy}");

    const allegro = await updatePlatform(userId, (await platformOf(ALLEGRO_PLATFORM_MODULE)).id, sent);
    assert.equal(allegro.defaultListingType, "auction");
    assert.equal(allegro.defaultStartingPrice, "5.00");
    assert.equal(allegro.descriptionFormat, "html");
    assert.equal(allegro.maxTitleLength, 80);
  });

  it("refuses another owner", async () => {
    await assert.rejects(() => getColnectPlatform("someone-else", collectionId));
    await assert.rejects(() => getModulePlatformSettings("someone-else", collectionId, "colnect"));
  });
});
