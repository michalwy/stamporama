import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, previewOfferTitle, offerTranslationGaps } from "../../src/lib/offers";
import { saveEntityTranslation } from "../../src/lib/entity-translations";

// Filling a missing translation from where the generated title needs it (#299/#300): the gaps the
// preview reports name real entity rows, and writing one is an ordinary entity mutation that the
// next generation picks up. The pure "which gaps does this template surface" rules are unit-tested
// (`tests/unit/offer-title-template.test.ts`); this is about the entity identity and the save.

describe("translation gaps + in-place filling (#299, #300)", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let platformId: string;
  let rootAreaId: string;
  let leafAreaId: string;
  let stampId: string;
  let issueId: string;
  let conditionId: string;
  let certificateStatusId: string;
  let copyId: string;

  const TEMPLATE = "{name} {condition} {conditionAbbr} {certificate} {area} {issueName}";

  before(async () => {
    const ts = Date.now();
    userId = `test-user-gaps-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User gaps-${ts}`,
        email: `test-gaps-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-gaps-${ts}`,
        name: `Collection gaps-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
        defaultLanguage: "en",
      },
    });
    collectionId = col.id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-gaps-other-${ts}`,
          name: `Other gaps-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "en",
        },
      })
    ).id;

    // The area title rolls up from the root, so `{area}` renders the *root's* title name — the row a
    // missing Polish `{area}` has to be written on, not the leaf the copy sits in.
    rootAreaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Europe", titleName: "Europe" },
      })
    ).id;
    leafAreaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", parentId: rootAreaId },
      })
    ).id;
    stampId = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: "Mercury",
          stampAreaLinks: { create: [{ collectionAreaId: leafAreaId, isPrimary: true }] },
        },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        data: {
          collectionId,
          // Past the collection's counter: this row bypasses `allocateEntityNumber` (#432).
          issueNo: 9001,
          collectionAreaId: leafAreaId,
          name: "First Issue",
          members: { create: [{ stampId }] },
          checklists: { create: [{ collectionId, name: "Complete set", sortOrder: 0, stamps: { create: [{ stampId }] } }] },
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: {
          collectionId,
          name: "Used",
          abbreviation: "U",
          sortOrder: 0,
          // Only the name is translated — the abbreviation is a gap of its own on the same entity.
          translations: { create: [{ language: "pl", name: "Kasowane" }] },
        },
      })
    ).id;
    certificateStatusId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Photo certificate", abbreviation: "cert.", sortOrder: 0 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Allegro",
          platform: true,
          titleTemplate: TEMPLATE,
          titleLanguage: "pl",
        },
      })
    ).id;
    copyId = (
      await createItem(userId, collectionId, {
        stampId,
        conditionId,
        certificateStatusId,
        forSale: true,
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function offer(): Promise<string> {
    return createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
  }

  /** The preview's gaps as `entityType:entityField` → the entity row they point at. */
  async function gapsByField(offerId: string): Promise<Map<string, { id: string; value: string }>> {
    const preview = await previewOfferTitle(userId, offerId, [copyId]);
    return new Map(
      (preview?.gaps ?? []).map((g) => [
        `${g.entityType}:${g.entityField}`,
        { id: g.entityId, value: g.defaultValue },
      ])
    );
  }

  it("names the entity row behind every untranslated token", async () => {
    const gaps = await gapsByField(await offer());
    assert.deepEqual(
      [...gaps.keys()].sort(),
      // The certificate status is untranslated in both its fields, but the template renders only
      // `{certificate}` — a gap no generated text shows is not a gap here.
      ["area:titleName", "certificateStatus:name", "condition:abbreviation", "issue:name", "stamp:name"]
    );
    assert.deepEqual(gaps.get("stamp:name"), { id: stampId, value: "Mercury" });
    assert.deepEqual(gaps.get("issue:name"), { id: issueId, value: "First Issue" });
    assert.deepEqual(gaps.get("condition:abbreviation"), { id: conditionId, value: "U" });
  });

  it("points an {area} gap at the ancestor whose title rolled up, not the copy's own area", async () => {
    const gaps = await gapsByField(await offer());
    assert.deepEqual(gaps.get("area:titleName"), { id: rootAreaId, value: "Europe" });
    assert.notEqual(rootAreaId, leafAreaId);
  });

  it("does not list the condition name, which is translated", async () => {
    const gaps = await gapsByField(await offer());
    assert.equal(gaps.has("condition:name"), false);
  });

  it("filling a gap changes the generated title and drops it from the list", async () => {
    const offerId = await offer();
    await saveEntityTranslation(userId, collectionId, {
      entityType: "stamp",
      entityId: stampId,
      entityField: "name",
      language: "pl",
      value: "Merkury",
    });
    const preview = await previewOfferTitle(userId, offerId, [copyId]);
    assert.match(preview?.segments.map((s) => s.text).join("") ?? "", /^Merkury Kasowane/);
    assert.equal((await gapsByField(offerId)).has("stamp:name"), false);
    // …and it is the same row the stamp's own translations dialog writes.
    assert.deepEqual(
      await prisma.stampTranslation.findMany({ where: { stampId }, select: { language: true, name: true } }),
      [{ language: "pl", name: "Merkury" }]
    );
  });

  it("leaves the entity's other fields and languages alone", async () => {
    await saveEntityTranslation(userId, collectionId, {
      entityType: "condition",
      entityId: conditionId,
      entityField: "abbreviation",
      language: "pl",
      value: "Kas.",
    });
    const row = await prisma.stampConditionTranslation.findUniqueOrThrow({
      where: { stampConditionId_language: { stampConditionId: conditionId, language: "pl" } },
    });
    // Filling the abbreviation must not have cleared the name that was already translated.
    assert.equal(row.name, "Kasowane");
    assert.equal(row.abbreviation, "Kas.");
  });

  it("clearing the last field of a language drops the row, as the entity's own form does", async () => {
    await saveEntityTranslation(userId, collectionId, {
      entityType: "certificateStatus",
      entityId: certificateStatusId,
      entityField: "name",
      language: "pl",
      value: "Atest",
    });
    await saveEntityTranslation(userId, collectionId, {
      entityType: "certificateStatus",
      entityId: certificateStatusId,
      entityField: "name",
      language: "pl",
      value: "   ",
    });
    assert.deepEqual(
      await prisma.certificateStatusTranslation.findMany({ where: { certificateStatusId } }),
      []
    );
  });

  it("collects the gaps of every generated text over the offer's own composition", async () => {
    const offerId = await offer();
    await addOfferSet(userId, offerId, [copyId]);
    await prisma.contact.update({
      where: { id: platformId },
      // A description template naming a token the title does not use.
      data: { titleTemplate: "{name}", descriptionTemplate: "{#set}{issueName}{/set}" },
    });
    const { language, gaps } = await offerTranslationGaps(userId, offerId);
    assert.equal(language, "pl");
    assert.deepEqual(
      gaps.map((g) => `${g.entityType}:${g.entityField}`).sort(),
      ["issue:name"] // `{name}` was filled above; `{condition}` etc. are no longer rendered.
    );
    await prisma.contact.update({
      where: { id: platformId },
      data: { titleTemplate: TEMPLATE, descriptionTemplate: null },
    });
  });

  it("refuses an entity that belongs to another collection", async () => {
    await assert.rejects(
      saveEntityTranslation(userId, otherCollectionId, {
        entityType: "stamp",
        entityId: stampId,
        entityField: "name",
        language: "pl",
        value: "Merkury",
      }),
      /not found or access denied/i
    );
  });

  it("refuses the collection's own default language and an unknown field", async () => {
    await assert.rejects(
      saveEntityTranslation(userId, collectionId, {
        entityType: "stamp",
        entityId: stampId,
        entityField: "name",
        language: "en",
        value: "Mercury",
      }),
      /default language/i
    );
    await assert.rejects(
      saveEntityTranslation(userId, collectionId, {
        entityType: "stamp",
        entityId: stampId,
        entityField: "abbreviation",
        language: "pl",
        value: "M",
      }),
      /unknown translatable field/i
    );
  });
});
