import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  createOffer,
  addOfferSet,
  addOfferSetsPerCopy,
  regenerateOfferText,
  previewOfferTitle,
  getOfferDetail,
} from "../../src/lib/offers";

// Per-offer title language (#297) and fallback reporting (#298), end to end over real translation
// rows. The per-field fallback rules themselves are unit-tested (`tests/unit/translations.test.ts`,
// `tests/unit/offer-title-template.test.ts`); what is exercised here is that the generation paths —
// adding a set, adding sets per copy, regenerating, previewing — honour an override language, and
// that the preview reports exactly the tokens that rendered untranslated text.

describe("per-offer title language + fallback flags (#297, #298)", () => {
  let userId: string;
  let collectionId: string;
  let plPlatformId: string;
  let enPlatformId: string;
  let copyId: string;
  let secondCopyId: string;

  const TEMPLATE = "{name} {condition} {area}";

  before(async () => {
    const ts = Date.now();
    userId = `test-user-title-lang-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User title-lang-${ts}`,
        email: `test-title-lang-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-title-lang-${ts}`,
        name: `Collection title-lang-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
        defaultLanguage: "en",
      },
    });
    collectionId = col.id;

    // Area with a Polish title name; stamp with a Polish name; condition translated in name only,
    // so `{condition}` renders Polish while a hypothetical `{conditionAbbr}` would fall back.
    const area = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "Poland",
        titleName: "Poland",
        translations: { create: [{ language: "pl", titleName: "Polska" }] },
      },
    });
    const stamp = await prisma.stamp.create({
      data: {
        collectionId,
        name: "Mercury",
        translations: { create: [{ language: "pl", name: "Merkury" }] },
        stampAreaLinks: { create: [{ collectionAreaId: area.id, isPrimary: true }] },
      },
    });
    // A second stamp with no Polish name at all — its `{name}` falls back.
    const untranslated = await prisma.stamp.create({
      data: {
        collectionId,
        name: "Pegasus",
        stampAreaLinks: { create: [{ collectionAreaId: area.id, isPrimary: true }] },
      },
    });
    const condition = await prisma.stampCondition.create({
      data: {
        collectionId,
        name: "Used",
        abbreviation: "U",
        sortOrder: 0,
        translations: { create: [{ language: "pl", name: "Kasowane" }] },
      },
    });

    plPlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Allegro", platform: true, titleTemplate: TEMPLATE, titleLanguage: "pl" },
      })
    ).id;
    enPlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, titleTemplate: TEMPLATE, titleLanguage: "en" },
      })
    ).id;

    const mk = async (stampId: string) =>
      (await createItem(userId, collectionId, { stampId, conditionId: condition.id, forSale: true })).id;
    copyId = await mk(stamp.id);
    secondCopyId = await mk(untranslated.id);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** A fresh offer on `platformId`, with no sets yet. */
  async function offerOn(platformId: string): Promise<string> {
    return createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
  }

  it("titles a set in the platform's own language by default", async () => {
    const offerId = await offerOn(plPlatformId);
    await addOfferSet(userId, offerId, [copyId]);
    const detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.sets[0].title, "Merkury Kasowane Polska");
  });

  it("titles a set in the language the compose dialog overrides with", async () => {
    const offerId = await offerOn(plPlatformId);
    // The collection's default language — chosen explicitly, against a Polish platform.
    await addOfferSet(userId, offerId, [copyId], null, null);
    const detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.sets[0].title, "Mercury Used Poland");
  });

  it("applies the override to per-copy adds too", async () => {
    const offerId = await offerOn(enPlatformId);
    await addOfferSetsPerCopy(userId, offerId, [copyId, secondCopyId], "pl");
    const detail = await getOfferDetail(userId, offerId);
    assert.deepEqual(
      detail?.sets.map((s) => s.title),
      // The second stamp has no Polish name — it falls back, silently, to `Pegasus`.
      ["Merkury Kasowane Polska", "Pegasus Kasowane Polska"]
    );
  });

  it("regenerates the offer title in an overridden language, leaving the platform untouched", async () => {
    const offerId = await offerOn(enPlatformId);
    await addOfferSet(userId, offerId, [copyId]);
    assert.equal(await regenerateOfferText(userId, offerId, "name"), "Mercury Used Poland");
    assert.equal(await regenerateOfferText(userId, offerId, "name", "pl"), "Merkury Kasowane Polska");
    // Nothing about the choice is stored — the platform still lists in English.
    const platform = await prisma.contact.findUniqueOrThrow({ where: { id: enPlatformId } });
    assert.equal(platform.titleLanguage, "en");
    assert.equal((await getOfferDetail(userId, offerId))?.name, "Merkury Kasowane Polska");
  });

  it("previews the exact title an add would produce, with nothing written", async () => {
    const offerId = await offerOn(plPlatformId);
    const preview = await previewOfferTitle(userId, offerId, [copyId]);
    assert.equal(preview?.segments.map((s) => s.text).join(""), "Merkury Kasowane Polska");
    assert.deepEqual(preview?.fallbackTokens, []);
    assert.equal((await getOfferDetail(userId, offerId))?.sets.length, 0);
  });

  it("flags the tokens that rendered untranslated text", async () => {
    const offerId = await offerOn(plPlatformId);
    const preview = await previewOfferTitle(userId, offerId, [secondCopyId]);
    assert.deepEqual(preview?.fallbackTokens, ["{name}"]);
    assert.deepEqual(
      preview?.segments,
      [
        { text: "Pegasus", fellBack: true },
        { text: " Kasowane Polska", fellBack: false },
      ]
    );
  });

  it("flags nothing when the offer is generated in the collection's default language", async () => {
    const offerId = await offerOn(enPlatformId);
    const preview = await previewOfferTitle(userId, offerId, [copyId, secondCopyId]);
    assert.deepEqual(preview?.fallbackTokens, []);
    assert.equal(preview?.segments.every((s) => !s.fellBack), true);
  });

  it("previews nothing when the platform has no title template", async () => {
    const bare = await prisma.contact.create({
      data: { collectionId, name: "Flea market", platform: true },
    });
    const offerId = await offerOn(bare.id);
    assert.equal(await previewOfferTitle(userId, offerId, [copyId]), null);
  });
});
