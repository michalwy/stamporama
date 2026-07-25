import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  createOffer,
  duplicateOffer,
  addOfferSet,
  regenerateOfferText,
  patchOffer,
  getOfferDetail,
} from "../../src/lib/offers";

// The offer's generated description (#266) and seller-only private note (#267): produced at creation
// (and on duplicate) from the platform's own templates, regenerated per field over the offer's real
// set composition, and freely editable. The rendering rules themselves are unit-tested
// (`tests/unit/offer-listing-template.test.ts`); what is exercised here is the domain wiring.

describe("offer description + private note (#266, #267)", () => {
  let userId: string;
  let collectionId: string;
  /** Platform with all three templates configured. */
  let fullPlatformId: string;
  /** Platform with only a title template — no description, no private note. */
  let titleOnlyPlatformId: string;
  let mercuryId: string;
  let venusId: string;

  const DESCRIPTION_TEMPLATE = "{name} {year}\nCondition: {condition}\n\n{#set}- {catalog} {name}\n{/set}";
  const NOTE_TEMPLATE = "{#copy}{catalog} · {location}\n{/copy}";

  before(async () => {
    const ts = Date.now();
    userId = `test-user-listing-text-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User listing-text-${ts}`,
        email: `test-listing-text-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-listing-text-${ts}`,
        name: `Collection listing-text-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
        defaultLanguage: "en",
      },
    });
    collectionId = col.id;

    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Poland", titleName: "Poland" },
    });
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    const location = await prisma.location.create({
      data: { collectionId, name: "Stockbook A", assignable: true },
    });

    const mkStamp = async (name: string, number: string, year: number) => {
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name,
          issuedYear: year,
          stampAreaLinks: { create: [{ collectionAreaId: area.id, isPrimary: true }] },
          catalogNumbers: { create: [{ catalogVendorId: vendor.id, number }] },
        },
      });
      return (
        await createItem(userId, collectionId, {
          stampId: stamp.id,
          conditionId: condition.id,
          locationId: location.id,
          forSale: true,
        })
      ).id;
    };
    mercuryId = await mkStamp("Mercury", "12", 1850);
    venusId = await mkStamp("Venus", "13", 1851);

    fullPlatformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Allegro",
          platform: true,
          platformCurrency: "EUR",
          titleTemplate: "{catalog} {name}",
          descriptionTemplate: DESCRIPTION_TEMPLATE,
          privateNoteTemplate: NOTE_TEMPLATE,
        },
      })
    ).id;
    titleOnlyPlatformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Delcampe",
          platform: true,
          platformCurrency: "EUR",
          titleTemplate: "{catalog} {name}",
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function offerOn(platformId: string, seedItemIds?: string[]): Promise<string> {
    return createOffer(
      userId,
      collectionId,
      { platformId, url: null, price: "5.00", currency: "EUR", listingDate: null, state: "preparing" },
      seedItemIds ? { seedItemIds } : {}
    );
  }

  it("generates all three texts at creation from the platform's templates", async () => {
    const offerId = await offerOn(fullPlatformId, [mercuryId]);
    const detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.name, "Mi 12 Mercury");
    assert.equal(detail?.description, "Mercury 1850\nCondition: Used\n\n- Mi 12 Mercury");
    assert.equal(detail?.privateNote, "Mi 12 · Stockbook A");
  });

  it("generates nothing for a field the platform has no template for", async () => {
    const offerId = await offerOn(titleOnlyPlatformId, [mercuryId]);
    const detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.name, "Mi 12 Mercury");
    assert.equal(detail?.description, null);
    assert.equal(detail?.privateNote, null);
    // …and the detail read model says which fields can be regenerated at all.
    assert.deepEqual(detail?.regeneratable, { name: true, description: false, privateNote: false });
  });

  it("leaves every text null when the offer lists nothing yet", async () => {
    const detail = await getOfferDetail(userId, await offerOn(fullPlatformId));
    assert.equal(detail?.name, null);
    assert.equal(detail?.description, null);
    assert.equal(detail?.privateNote, null);
  });

  it("repeats a set block over the offer's real composition when regenerating", async () => {
    const offerId = await offerOn(fullPlatformId, [mercuryId]);
    await addOfferSet(userId, offerId, [venusId]);
    const description = await regenerateOfferText(userId, offerId, "description");
    assert.equal(
      description,
      "Mercury / Venus 1850–1851\nCondition: Used\n\n- Mi 12 Mercury\n- Mi 13 Venus"
    );
    assert.equal((await getOfferDetail(userId, offerId))?.description, description);
  });

  it("regenerates one field without disturbing the others", async () => {
    const offerId = await offerOn(fullPlatformId, [mercuryId]);
    await patchOffer(userId, offerId, { name: "Hand-written title", privateNote: "Hand-written note" });
    await regenerateOfferText(userId, offerId, "description");
    const detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.name, "Hand-written title");
    assert.equal(detail?.privateNote, "Hand-written note");
    assert.equal(detail?.description, "Mercury 1850\nCondition: Used\n\n- Mi 12 Mercury");
  });

  it("regenerating a field with no template clears it", async () => {
    const offerId = await offerOn(titleOnlyPlatformId, [mercuryId]);
    await patchOffer(userId, offerId, { description: "Written by hand" });
    assert.equal(await regenerateOfferText(userId, offerId, "description"), null);
    assert.equal((await getOfferDetail(userId, offerId))?.description, null);
  });

  it("edits and clears the texts in place", async () => {
    const offerId = await offerOn(fullPlatformId, [mercuryId]);
    await patchOffer(userId, offerId, { description: "Line one\nLine two" });
    assert.equal((await getOfferDetail(userId, offerId))?.description, "Line one\nLine two");
    await patchOffer(userId, offerId, { description: null });
    assert.equal((await getOfferDetail(userId, offerId))?.description, null);
  });

  it("gives a duplicate the *new* platform's wording", async () => {
    const source = await offerOn(fullPlatformId, [mercuryId]);
    const { id } = await duplicateOffer(userId, source, {
      platformId: titleOnlyPlatformId,
      url: null,
      price: "7.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    const detail = await getOfferDetail(userId, id);
    assert.equal(detail?.name, "Mi 12 Mercury");
    // The target platform has no description / note template, so the clone gets neither.
    assert.equal(detail?.description, null);
    assert.equal(detail?.privateNote, null);
  });
});
