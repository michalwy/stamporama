import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getFacebookPlatform, setFacebookPlatform } from "../../src/lib/facebook";
import {
  createFacebookGroup,
  deleteFacebookGroup,
  listFacebookGroups,
  setFacebookGroupArchived,
  updateFacebookGroup,
} from "../../src/lib/facebook-groups";
import {
  FACEBOOK_GROUP_DEFAULTS,
  type FacebookGroupValues,
} from "../../src/lib/facebook-group-rules";

// Facebook as a platform with its groups (#1543; ADR-0061). The rules worth a database: the groups
// hang off whichever platform is marked Facebook, a group's settings survive the round trip as plain
// numbers, archiving keeps a group and lists it apart, and a group an offer names cannot be deleted —
// by the domain's refusal and by the foreign key behind it.

function values(overrides: Partial<FacebookGroupValues> = {}): FacebookGroupValues {
  return {
    ...FACEBOOK_GROUP_DEFAULTS,
    name: "Znaczki — aukcje",
    url: "https://www.facebook.com/groups/123456",
    ...overrides,
  };
}

describe("Facebook groups (#1543)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let facebookId: string;
  let otherPlatformId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbgroups-${ts}`;
    otherUserId = `test-user-fbgroups-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-fbgroups-${ts}`,
          name: `Collection fbgroups-${ts}`,
          baseCurrency: "PLN",
          ownerId: userId,
        },
      })
    ).id;
    facebookId = (
      await prisma.contact.create({
        data: { collectionId, name: "Facebook", platform: true, platformCurrency: "PLN" },
      })
    ).id;
    otherPlatformId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;
  });

  after(async () => {
    // Offers restrict their group and their platform, so they go first.
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("has nowhere to put a group until a platform is named Facebook", async () => {
    assert.equal(await getFacebookPlatform(userId, collectionId), null);
    assert.deepEqual(await listFacebookGroups(userId, collectionId), {
      platformId: null,
      platformName: null,
      platformCurrency: null,
      groups: [],
    });
    await assert.rejects(
      () => createFacebookGroup(userId, collectionId, values()),
      /no Facebook platform/
    );
  });

  it("marks the platform, exclusively, and refuses a contact that is not a platform", async () => {
    await setFacebookPlatform(userId, collectionId, facebookId);
    assert.equal((await getFacebookPlatform(userId, collectionId))?.id, facebookId);
    await setFacebookPlatform(userId, collectionId, otherPlatformId);
    assert.equal((await getFacebookPlatform(userId, collectionId))?.id, otherPlatformId);
    await setFacebookPlatform(userId, collectionId, facebookId);
    assert.equal(
      await prisma.contact.count({ where: { collectionId, platformModule: "facebook" } }),
      1
    );

    const person = await prisma.contact.create({ data: { collectionId, name: "A buyer", buyer: true } });
    await assert.rejects(() => setFacebookPlatform(userId, collectionId, person.id), /Platform not found/);
  });

  it("refuses another user's collection", async () => {
    await assert.rejects(() => getFacebookPlatform(otherUserId, collectionId), /Collection not found/);
    await assert.rejects(() => listFacebookGroups(otherUserId, collectionId), /Collection not found/);
  });

  it("stores a group's settings and reads them back as plain values", async () => {
    const { id } = await createFacebookGroup(
      userId,
      collectionId,
      values({
        postTemplate: "Lot {lot}\n{description}\nStart {startingPrice}",
        standingNote: "Wysyłka 7 zł, przelew w 3 dni.",
        startingPriceMode: "catalogPercent",
        startingPriceValue: 30,
        bidIncrement: 1,
        auctionDays: 7,
        closingTime: "20:00",
      })
    );
    const list = await listFacebookGroups(userId, collectionId);
    assert.equal(list.platformId, facebookId);
    assert.equal(list.platformCurrency, "PLN");
    assert.equal(list.groups.length, 1);
    const group = list.groups[0];
    assert.equal(group.id, id);
    assert.equal(group.postTemplate, "Lot {lot}\n{description}\nStart {startingPrice}");
    assert.equal(group.standingNote, "Wysyłka 7 zł, przelew w 3 dni.");
    assert.equal(group.startingPriceMode, "catalogPercent");
    assert.equal(group.startingPriceValue, 30);
    assert.equal(group.bidIncrement, 1);
    assert.equal(group.auctionDays, 7);
    assert.equal(group.closingTime, "20:00");
    // Null is the platform's own currency.
    assert.equal(group.currency, null);
    assert.equal(group.archivedAt, null);
    assert.equal(group.offerCount, 0);
  });

  it("edits a group in place, and refuses a second group of the same name", async () => {
    const [group] = (await listFacebookGroups(userId, collectionId)).groups;
    await updateFacebookGroup(userId, group.id, values({ name: "Znaczki — aukcje", currency: "eur" }));
    const [edited] = (await listFacebookGroups(userId, collectionId)).groups;
    assert.equal(edited.currency, "EUR");
    // Cleared with the rest: an edit states the whole group.
    assert.equal(edited.startingPriceMode, null);
    assert.equal(edited.startingPriceValue, null);

    await assert.rejects(
      () => createFacebookGroup(userId, collectionId, values()),
      /already exists on this platform/
    );
    await assert.rejects(
      () => updateFacebookGroup(otherUserId, group.id, values()),
      /Collection not found/
    );
  });

  it("archives a group, lists it after the groups in use, and brings it back", async () => {
    const { id } = await createFacebookGroup(
      userId,
      collectionId,
      values({ name: "Archiwalna grupa", url: "https://www.facebook.com/groups/old" })
    );
    await createFacebookGroup(
      userId,
      collectionId,
      values({ name: "Zzz ostatnia", url: "https://www.facebook.com/groups/zzz" })
    );
    await setFacebookGroupArchived(userId, id, true);
    let list = await listFacebookGroups(userId, collectionId);
    // In use by name, then the archived — "Archiwalna" sorts first by name and still comes last.
    assert.deepEqual(
      list.groups.map((g) => [g.name, g.archivedAt !== null]),
      [
        ["Znaczki — aukcje", false],
        ["Zzz ostatnia", false],
        ["Archiwalna grupa", true],
      ]
    );

    await setFacebookGroupArchived(userId, id, false);
    list = await listFacebookGroups(userId, collectionId);
    assert.ok(list.groups.every((g) => g.archivedAt === null));
  });

  it("deletes a group no offer names", async () => {
    const { id } = await createFacebookGroup(
      userId,
      collectionId,
      values({ name: "Do usunięcia", url: "https://www.facebook.com/groups/gone" })
    );
    await deleteFacebookGroup(userId, id);
    assert.equal(await prisma.facebookGroup.findUnique({ where: { id } }), null);
  });

  it("refuses to delete a group an offer names — archive it instead", async () => {
    const [group] = (await listFacebookGroups(userId, collectionId)).groups;
    await prisma.offer.create({
      // Written straight to the table, past `allocateOfferNumber` (#416), at a number well beyond
      // the collection's counter.
      data: {
        collectionId,
        offerNo: 9301,
        platformId: facebookId,
        facebookGroupId: group.id,
        currency: "PLN",
        price: "10.00",
        state: "preparing",
        listingType: "auction",
      },
    });

    const [counted] = (await listFacebookGroups(userId, collectionId)).groups.filter(
      (g) => g.id === group.id
    );
    assert.equal(counted.offerCount, 1);

    await assert.rejects(
      () => deleteFacebookGroup(userId, group.id),
      /has 1 offer, so it cannot be deleted — archive it instead/
    );
    // The key behind the refusal: a delete that skipped the domain still cannot orphan the offer.
    await assert.rejects(() => prisma.facebookGroup.delete({ where: { id: group.id } }));

    // Archiving is the way out, and leaves the offer naming it.
    await setFacebookGroupArchived(userId, group.id, true);
    const offer = await prisma.offer.findFirstOrThrow({ where: { collectionId, offerNo: 9301 } });
    assert.equal(offer.facebookGroupId, group.id);
  });
});
