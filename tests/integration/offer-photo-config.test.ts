import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createOffer,
  duplicateOffer,
  getOfferDetail,
  updateOfferPhotoConfig,
} from "../../src/lib/offers";
import { updateContact } from "../../src/lib/contacts";

// Offer photo configuration on two levels (#308): the platform holds what it accepts (limits, read
// live) plus the defaults a new offer is seeded from, and the offer holds its own copy of sides,
// tile label template and collage numbers. The parsing rules are unit-tested
// (`tests/unit/offer-photo-config.test.ts`); what is exercised here is the domain wiring — above all
// that changing a platform never reaches back into an offer already prepared.

describe("offer photo configuration (#308)", () => {
  let userId: string;
  let collectionId: string;
  /** Platform with photo defaults and a default collage template. */
  let configuredPlatformId: string;
  /** Platform with nothing configured — offers on it start with no collage numbers. */
  let barePlatformId: string;
  let templateId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-photo-config-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User photo-config-${ts}`,
        email: `test-photo-config-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-photo-config-${ts}`,
        name: `Collection photo-config-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
        defaultLanguage: "en",
      },
    });
    collectionId = col.id;

    templateId = (
      await prisma.collageTemplate.create({
        data: {
          collectionId,
          name: "Small definitives",
          rows: 5,
          columns: 4,
          gapPercent: 5,
          background: "#f0f0f0",
          labelPercent: 14,
        },
      })
    ).id;

    configuredPlatformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Allegro",
          platform: true,
          platformCurrency: "EUR",
          maxPhotos: 8,
          maxPhotoEdge: 1600,
          maxPhotoFileSizeMib: 10,
          photoSides: "both",
          tileLabelLeftTemplate: "{catalog}",
          defaultCollageTemplateId: templateId,
        },
      })
    ).id;
    barePlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

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

  it("seeds a new offer from the platform's defaults and its collage template", async () => {
    const detail = await getOfferDetail(userId, await offerOn(configuredPlatformId));
    assert.equal(detail?.photoConfig.photoSides, "both");
    assert.equal(detail?.photoConfig.photoLabelLeftTemplate, "{catalog}");
    assert.deepEqual(detail?.photoConfig.collage, {
      collageGridMode: "fixed",
      collageRows: 5,
      collageColumns: 4,
      collageGapPercent: 5,
      collageBackground: "#f0f0f0",
      collageLabelPercent: 14,
    });
  });

  it("reads the platform's limits live rather than from the offer", async () => {
    const offerId = await offerOn(configuredPlatformId);
    assert.deepEqual((await getOfferDetail(userId, offerId))?.platformPhotoLimits, {
      maxPhotos: 8,
      maxPhotoEdge: 1600,
      maxPhotoFileSizeMib: 10,
    });

    await prisma.contact.update({ where: { id: configuredPlatformId }, data: { maxPhotos: 4 } });
    assert.equal((await getOfferDetail(userId, offerId))?.platformPhotoLimits.maxPhotos, 4);
    await prisma.contact.update({ where: { id: configuredPlatformId }, data: { maxPhotos: 8 } });
  });

  it("leaves the collage numbers unset when the platform has no default template", async () => {
    const detail = await getOfferDetail(userId, await offerOn(barePlatformId));
    assert.equal(detail?.photoConfig.collage, null);
    assert.equal(detail?.photoConfig.photoLabelLeftTemplate, null);
    // The default side, not a null — an offer always photographs something.
    assert.equal(detail?.photoConfig.photoSides, "front");
  });

  it("does not touch a prepared offer when the platform's defaults change", async () => {
    const offerId = await offerOn(configuredPlatformId);
    await prisma.contact.update({
      where: { id: configuredPlatformId },
      data: { photoSides: "front", tileLabelLeftTemplate: "{name}" },
    });
    await prisma.collageTemplate.update({ where: { id: templateId }, data: { rows: 9 } });

    const detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.photoConfig.photoSides, "both");
    assert.equal(detail?.photoConfig.photoLabelLeftTemplate, "{catalog}");
    assert.equal(detail?.photoConfig.collage?.collageRows, 5);

    // Restore, so the ordering of the remaining cases doesn't depend on this one.
    await prisma.contact.update({
      where: { id: configuredPlatformId },
      data: { photoSides: "both", tileLabelLeftTemplate: "{catalog}" },
    });
    await prisma.collageTemplate.update({ where: { id: templateId }, data: { rows: 5 } });
  });

  it("seeds a duplicate from the platform it is cloned onto", async () => {
    const source = await offerOn(configuredPlatformId);
    const { id } = await duplicateOffer(userId, source, {
      platformId: barePlatformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    const detail = await getOfferDetail(userId, id);
    assert.equal(detail?.photoConfig.photoSides, "front");
    assert.equal(detail?.photoConfig.collage, null);
  });

  it("replaces the offer's configuration, and clears the collage numbers", async () => {
    const offerId = await offerOn(configuredPlatformId);
    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "back",
      preferSingles: false,
      photoLabelLeftTemplate: "{name}",
      photoLabelRightTemplate: null,
      collage: {
        collageGridMode: "fixed",
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 8,
        collageBackground: "#000000",
        collageLabelPercent: 0,
      },
    });
    let detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.photoConfig.photoSides, "back");
    assert.equal(detail?.photoConfig.collage?.collageRows, 2);

    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "front",
      preferSingles: false,
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: null,
    });
    detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.photoConfig.photoLabelLeftTemplate, null);
    assert.equal(detail?.photoConfig.collage, null);
  });

  it("keeps a platform deletable-free of its template: deleting the template only clears the default", async () => {
    const doomed = await prisma.collageTemplate.create({
      data: { collectionId, name: "Doomed", rows: 2, columns: 2, gapPercent: 8, labelPercent: 0 },
    });
    await prisma.contact.update({
      where: { id: barePlatformId },
      data: { defaultCollageTemplateId: doomed.id },
    });
    await prisma.collageTemplate.delete({ where: { id: doomed.id } });
    const platform = await prisma.contact.findUniqueOrThrow({ where: { id: barePlatformId } });
    assert.equal(platform.defaultCollageTemplateId, null);
  });

  it("ignores a collage template from another collection", async () => {
    const other = await prisma.collection.create({
      data: {
        slug: `col-photo-config-other-${Date.now()}`,
        name: "Other collection",
        baseCurrency: "EUR",
        ownerId: userId,
        defaultLanguage: "en",
      },
    });
    const foreign = await prisma.collageTemplate.create({
      data: { collectionId: other.id, name: "Foreign", rows: 2, columns: 2, gapPercent: 8, labelPercent: 0 },
    });
    const saved = await updateContact(userId, barePlatformId, {
      name: "Delcampe",
      platform: true,
      defaultCollageTemplateId: foreign.id,
    });
    assert.equal(saved.defaultCollageTemplateId, null);
    await prisma.collection.delete({ where: { id: other.id } });
  });
});
