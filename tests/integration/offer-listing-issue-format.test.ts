import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, offerTranslationGaps } from "../../src/lib/offers";
import { saveEntityTranslation } from "../../src/lib/entity-translations";

// **A listing text names the stamp's issue format, in the listing's language (#2442)**, driven
// through the real generation: `{issueFormat}` / `{issueFormatAbbr}` over the stamp's issue format
// (#2439), each translated into the platform's language and falling back on its own, nothing at all
// on an ordinary stamp (#1692), and an untranslated one reported as a gap the in-place editor fills.
// The engine's rules are pinned in `tests/unit/offer-title-template.test.ts`.

describe("issue format in offer texts (#2442)", () => {
  const ts = Date.now();
  let userId: string;
  let collectionId: string;
  let polishPlatformId: string;
  let englishPlatformId: string;
  let sheetFormatId: string;
  let sheetCopy: string;
  let ordinaryCopy: string;

  before(async () => {
    userId = `test-user-offer-issue-format-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User offer-issue-format-${ts}`,
        email: `test-offer-issue-format-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-offer-issue-format-${ts}`,
          name: `Collection offer-issue-format-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "en",
        },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint", abbreviation: "*", sortOrder: 0 },
      })
    ).id;
    // The Polish name is translated and the abbreviation deliberately is not: the two fall back on
    // their own, as a format's do.
    sheetFormatId = (
      await prisma.stampIssueFormat.create({
        data: {
          collectionId,
          name: "Souvenir sheet",
          abbreviation: "Bl",
          sortOrder: 0,
          translations: { create: [{ language: "pl", name: "Blok", abbreviation: null }] },
        },
      })
    ).id;
    const mercury = (
      await prisma.stamp.create({ data: { collectionId, name: "Mercury", issueFormatId: sheetFormatId } })
    ).id;
    const venus = (await prisma.stamp.create({ data: { collectionId, name: "Venus" } })).id;

    polishPlatformId = (
      await prisma.platform.create({
        data: {
          collectionId,
          name: "Allegro",
          titleTemplate: "{name} - {issueFormat} - {issueFormatAbbr}",
          titleLanguage: "pl",
          descriptionTemplate: "{issueFormat}",
        },
      })
    ).id;
    englishPlatformId = (
      await prisma.platform.create({
        data: {
          collectionId,
          name: "Delcampe",
          titleTemplate: "{name} - {issueFormat} - {issueFormatAbbr}",
        },
      })
    ).id;
    sheetCopy = (await createItem(userId, collectionId, { stampId: mercury, conditionId, forSale: true })).id;
    ordinaryCopy = (await createItem(userId, collectionId, { stampId: venus, conditionId, forSale: true })).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function offer(platformId: string, itemIds: string[]): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
    });
    await addOfferSet(userId, offerId, itemIds);
    return offerId;
  }

  async function texts(offerId: string) {
    return prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { name: true, description: true },
    });
  }

  it("prints a souvenir sheet's issue format in the collection's own language", async () => {
    const { name } = await texts(await offer(englishPlatformId, [sheetCopy]));
    assert.equal(name, "Mercury - Souvenir sheet - Bl");
  });

  it("prints the translated name in another language, the abbreviation falling back on its own", async () => {
    const { name, description } = await texts(await offer(polishPlatformId, [sheetCopy]));
    assert.equal(name, "Mercury - Blok - Bl");
    assert.equal(description, "Blok");
  });

  it("prints nothing on an ordinary stamp, taking its separators with it", async () => {
    const { name, description } = await texts(await offer(polishPlatformId, [ordinaryCopy]));
    assert.equal(name, "Venus");
    // A description that resolves to nothing is stored as no description.
    assert.equal(description, null);
  });

  it("in a set, names the sheet once and lets the ordinary stamp contribute nothing", async () => {
    const { name } = await texts(await offer(englishPlatformId, [sheetCopy, ordinaryCopy]));
    assert.equal(name, "Mercury / Venus - Souvenir sheet - Bl");
  });

  it("reports the untranslated abbreviation as a gap, and filling it reaches the next text", async () => {
    const offerId = await offer(polishPlatformId, [sheetCopy]);
    const { gaps } = await offerTranslationGaps(userId, offerId);
    assert.deepEqual(
      gaps.filter((g) => g.entityType === "issueFormat"),
      [
        {
          field: "issueFormatAbbr",
          entityType: "issueFormat",
          entityId: sheetFormatId,
          entityField: "abbreviation",
          defaultValue: "Bl",
        },
      ]
    );

    await saveEntityTranslation(userId, collectionId, {
      entityType: "issueFormat",
      entityId: sheetFormatId,
      entityField: "abbreviation",
      language: "pl",
      value: "Bl.",
    });
    // The name written beside it is kept: a two-column row carries its sibling along.
    assert.deepEqual(
      await prisma.stampIssueFormatTranslation.findMany({
        where: { stampIssueFormatId: sheetFormatId },
        select: { language: true, name: true, abbreviation: true },
      }),
      [{ language: "pl", name: "Blok", abbreviation: "Bl." }]
    );
    const { name } = await texts(await offer(polishPlatformId, [sheetCopy]));
    assert.equal(name, "Mercury - Blok - Bl.");
    assert.deepEqual(
      (await offerTranslationGaps(userId, offerId)).gaps.filter((g) => g.entityType === "issueFormat"),
      []
    );
  });
});
