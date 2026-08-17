import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getDelcampePlatform, setDelcampePlatform } from "../../src/lib/delcampe";
import {
  createDelcampeListingProfile,
  deleteDelcampeListingProfile,
  getDelcampeOfferListingConfig,
  listDelcampeListingProfiles,
  resolveDelcampeListingProfileForOffer,
  setDefaultDelcampeListingProfile,
  setOfferDelcampeListingProfile,
  updateDelcampeListingProfile,
} from "../../src/lib/delcampe-listing-profile";
import {
  DELCAMPE_PROFILE_DEFAULTS,
  type DelcampeListingProfileValues,
} from "../../src/lib/delcampe-listing-profile-rules";

// Delcampe listing profiles (#608; ADR-0034) — what an Easy Uploader row carries that no offer knows
// about itself. The rules worth holding a database for are the ones the pure tests cannot reach: the
// first profile becoming the default on its own, the offer-level override falling back to it, and a
// delete releasing both references instead of being blocked by either.

function values(overrides: Partial<DelcampeListingProfileValues> = {}): DelcampeListingProfileValues {
  return {
    ...DELCAMPE_PROFILE_DEFAULTS,
    name: "Standard letter",
    shippingModel: "Fee template",
    ...overrides,
  };
}

describe("Delcampe listing profiles (#608)", () => {
  let userId: string;
  let collectionId: string;
  let delcampeId: string;
  let otherPlatformId: string;
  let offerId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-delcprof-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User delcprof-${ts}`,
        email: `test-delcprof-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-delcprof-${ts}`,
          name: `Collection delcprof-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    delcampeId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    otherPlatformId = (
      await prisma.contact.create({ data: { collectionId, name: "Colnect", platform: true } })
    ).id;
    offerId = (
      await prisma.offer.create({
        // Written straight to the table, so it bypasses `allocateOfferNumber` (#416) — a number well
        // past the collection's counter keeps it from colliding with one `createOffer` hands out.
        data: {
          collectionId,
          offerNo: 9101,
          platformId: delcampeId,
          currency: "EUR",
          price: "5.00",
          state: "preparing",
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("has nowhere to put a profile until a platform is named Delcampe", async () => {
    assert.equal(await getDelcampePlatform(userId, collectionId), null);
    const list = await listDelcampeListingProfiles(userId, collectionId);
    assert.deepEqual(list, {
      platformId: null,
      platformName: null,
      profiles: [],
      defaultProfileId: null,
    });
    await assert.rejects(
      () => createDelcampeListingProfile(userId, collectionId, values()),
      /no Delcampe platform/
    );
  });

  it("marks the platform, exclusively", async () => {
    await setDelcampePlatform(userId, collectionId, delcampeId);
    assert.equal((await getDelcampePlatform(userId, collectionId))?.id, delcampeId);
    await setDelcampePlatform(userId, collectionId, otherPlatformId);
    assert.equal((await getDelcampePlatform(userId, collectionId))?.id, otherPlatformId);
    await setDelcampePlatform(userId, collectionId, delcampeId);
  });

  it("makes the first profile the platform's default on its own", async () => {
    await createDelcampeListingProfile(userId, collectionId, values());
    const list = await listDelcampeListingProfiles(userId, collectionId);
    assert.equal(list.platformId, delcampeId);
    assert.equal(list.profiles.length, 1);
    assert.equal(list.defaultProfileId, list.profiles[0].id);
    assert.equal(list.profiles[0].isDefault, true);
    // The seeded Easy Uploader values survive the round trip as numbers, not `Decimal`s: this data
    // is read by a client component.
    assert.equal(list.profiles[0].renewDuration, 28);
    assert.equal(list.profiles[0].renewTotalCount, 99);
    assert.equal(list.profiles[0].minBidStepThreshold, 1);
    assert.equal(list.profiles[0].minBidStepBelow, 0.01);
    assert.equal(list.profiles[0].minBidStepAtOrAbove, 0.1);
  });

  it("does not promote the second profile, and refuses a duplicate name", async () => {
    await createDelcampeListingProfile(
      userId,
      collectionId,
      values({ name: "Heavy lot", shippingModel: "Parcel, tracked", minBidStepThreshold: 2.5 })
    );
    const list = await listDelcampeListingProfiles(userId, collectionId);
    assert.deepEqual(
      list.profiles.map((p) => p.name),
      ["Heavy lot", "Standard letter"]
    );
    assert.equal(list.profiles.find((p) => p.isDefault)?.name, "Standard letter");
    await assert.rejects(
      () => createDelcampeListingProfile(userId, collectionId, values({ name: "Heavy lot" })),
      /already exists/
    );
  });

  it("resolves the platform's default for an offer that names nothing", async () => {
    const resolved = await resolveDelcampeListingProfileForOffer(offerId);
    assert.equal(resolved?.name, "Standard letter");
    assert.equal(resolved?.isDefault, true);
  });

  it("lets one offer name another profile, and hand the choice back", async () => {
    const list = await listDelcampeListingProfiles(userId, collectionId);
    const heavy = list.profiles.find((p) => p.name === "Heavy lot")!;

    await setOfferDelcampeListingProfile(userId, offerId, heavy.id);
    let config = await getDelcampeOfferListingConfig(userId, offerId);
    assert.equal(config?.profile?.name, "Heavy lot");
    assert.equal(config?.profileIsOverride, true);
    assert.equal((await resolveDelcampeListingProfileForOffer(offerId))?.name, "Heavy lot");

    await setOfferDelcampeListingProfile(userId, offerId, null);
    config = await getDelcampeOfferListingConfig(userId, offerId);
    assert.equal(config?.profile?.name, "Standard letter");
    assert.equal(config?.profileIsOverride, false);
    assert.deepEqual(
      config?.profileOptions.map((o) => o.name),
      ["Heavy lot", "Standard letter"]
    );
  });

  it("refuses a profile belonging to another platform", async () => {
    const foreign = await prisma.delcampeListingProfile.create({
      data: {
        collectionId,
        platformId: otherPlatformId,
        name: "Not ours",
        shippingModel: "Fee template",
      },
    });
    await assert.rejects(
      () => setOfferDelcampeListingProfile(userId, offerId, foreign.id),
      /not one of this platform's/
    );
    await prisma.delcampeListingProfile.delete({ where: { id: foreign.id } });
  });

  it("draws no card at all for an offer on another platform", async () => {
    const offer = await prisma.offer.create({
      data: {
        collectionId,
        offerNo: 9102,
        platformId: otherPlatformId,
        currency: "EUR",
        price: "5.00",
      },
    });
    assert.equal(await getDelcampeOfferListingConfig(userId, offer.id), null);
    await prisma.offer.delete({ where: { id: offer.id } });
  });

  it("edits a profile in place without touching which one is the default", async () => {
    const before = await listDelcampeListingProfiles(userId, collectionId);
    const heavy = before.profiles.find((p) => p.name === "Heavy lot")!;
    await updateDelcampeListingProfile(
      userId,
      heavy.id,
      values({
        name: "Heavy lot",
        shippingModel: "Parcel, insured",
        renewDuration: 14,
        optionStrongTitle: true,
      })
    );
    const after = await listDelcampeListingProfiles(userId, collectionId);
    const edited = after.profiles.find((p) => p.id === heavy.id)!;
    assert.equal(edited.shippingModel, "Parcel, insured");
    assert.equal(edited.renewDuration, 14);
    assert.equal(edited.optionStrongTitle, true);
    assert.equal(after.defaultProfileId, before.defaultProfileId);
  });

  it("moves the default when asked, and reports what a delete released", async () => {
    const list = await listDelcampeListingProfiles(userId, collectionId);
    const heavy = list.profiles.find((p) => p.name === "Heavy lot")!;
    await setDefaultDelcampeListingProfile(userId, heavy.id);
    assert.equal((await listDelcampeListingProfiles(userId, collectionId)).defaultProfileId, heavy.id);

    // An offer pointing at it: deleting must release it rather than be blocked by it.
    await setOfferDelcampeListingProfile(userId, offerId, heavy.id);
    const { offersReleased } = await deleteDelcampeListingProfile(userId, heavy.id);
    assert.equal(offersReleased, 1);

    const after = await listDelcampeListingProfiles(userId, collectionId);
    assert.deepEqual(
      after.profiles.map((p) => p.name),
      ["Standard letter"]
    );
    // Nothing is promoted in its place — which settings the next upload carries is the collector's
    // decision, and a silently inherited default is how something unmeant gets listed.
    assert.equal(after.defaultProfileId, null);
    assert.equal(await resolveDelcampeListingProfileForOffer(offerId), null);
  });
});
