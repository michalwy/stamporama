import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getFacebookPlatform, setFacebookPlatform } from "../../src/lib/facebook";
import {
  createFacebookGroup,
  deleteFacebookGroup,
  listFacebookGroups,
  readFacebookDefaults,
  setFacebookGroupArchived,
  updateFacebookDefaults,
  updateFacebookGroup,
} from "../../src/lib/facebook-groups";
import {
  FACEBOOK_BLANK_SETTINGS,
  FACEBOOK_GROUP_DEFAULTS,
  type FacebookGroupValues,
  type FacebookPostingSettings,
} from "../../src/lib/facebook-group-rules";

// Facebook as a platform with its groups (#1543; ADR-0061). The rules worth a database: the groups
// hang off whichever platform is marked Facebook, a group's settings survive the round trip as plain
// numbers, each setting is the group's own or follows Facebook's (#1661), archiving keeps a group and lists it apart, and a group an offer names cannot be deleted —
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
      defaults: FACEBOOK_BLANK_SETTINGS,
      groups: [],
    });
    await assert.rejects(
      () => createFacebookGroup(userId, collectionId, values()),
      /no Facebook platform/
    );
    await assert.rejects(
      () => updateFacebookDefaults(userId, collectionId, FACEBOOK_BLANK_SETTINGS),
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
        custom: ["postTemplate", "standingNote", "startingPrice", "bidIncrement", "auctionDays", "closingTime"],
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
    // Following Facebook, whose currency is the platform's own.
    assert.equal(group.currency, null);
    assert.deepEqual(group.custom, [
      "postTemplate",
      "standingNote",
      "startingPrice",
      "bidIncrement",
      "auctionDays",
      "closingTime",
    ]);
    assert.equal(group.archivedAt, null);
    assert.equal(group.offerCount, 0);
  });

  it("edits a group in place, and refuses a second group of the same name", async () => {
    const [group] = (await listFacebookGroups(userId, collectionId)).groups;
    await updateFacebookGroup(
      userId,
      group.id,
      values({ name: "Znaczki — aukcje", currency: "eur", custom: ["currency"], postTemplate: "kept?" })
    );
    const [edited] = (await listFacebookGroups(userId, collectionId)).groups;
    assert.equal(edited.currency, "EUR");
    assert.deepEqual(edited.custom, ["currency"]);
    // Switched back to Facebook's, so the group keeps no value of its own — sent or not.
    assert.equal(edited.postTemplate, "");
    assert.equal(edited.standingNote, "");
    assert.equal(edited.startingPriceMode, null);
    assert.equal(edited.startingPriceValue, null);
    assert.equal(edited.auctionDays, null);

    await assert.rejects(
      () => createFacebookGroup(userId, collectionId, values()),
      /already exists on this platform/
    );
    await assert.rejects(
      () => updateFacebookGroup(otherUserId, group.id, values()),
      /Collection not found/
    );
  });

  it("states Facebook's own settings, read as blank until then, and refuses another user (#1661)", async () => {
    assert.deepEqual(await readFacebookDefaults(facebookId), FACEBOOK_BLANK_SETTINGS);
    await updateFacebookDefaults(userId, collectionId, {
      postTemplate: " {description}\nStart {startingPrice} ",
      standingNote: "Wysyłka 7 zł.",
      startingPriceMode: "catalogPercent",
      startingPriceValue: 25,
      bidIncrement: 1,
      auctionDays: 7,
      closingTime: "9:00",
    });
    const expected: FacebookPostingSettings = {
      postTemplate: "{description}\nStart {startingPrice}",
      standingNote: "Wysyłka 7 zł.",
      startingPriceMode: "catalogPercent",
      startingPriceValue: 25,
      bidIncrement: 1,
      auctionDays: 7,
      closingTime: "09:00",
    };
    assert.deepEqual((await listFacebookGroups(userId, collectionId)).defaults, expected);
    // A second save edits the one row.
    await updateFacebookDefaults(userId, collectionId, { ...expected, bidIncrement: 2 });
    assert.equal((await readFacebookDefaults(facebookId)).bidIncrement, 2);
    assert.equal(await prisma.facebookDefaults.count({ where: { platformId: facebookId } }), 1);

    await assert.rejects(
      () => updateFacebookDefaults(otherUserId, collectionId, expected),
      /Collection not found/
    );
    await assert.rejects(
      () => updateFacebookDefaults(userId, collectionId, { ...expected, closingTime: "8pm" }),
      /time of day/
    );
  });

  it("starts a new group following Facebook throughout", async () => {
    const { id } = await createFacebookGroup(
      userId,
      collectionId,
      values({ name: "Nowa grupa", url: "https://www.facebook.com/groups/new", postTemplate: "ignored" })
    );
    const group = (await listFacebookGroups(userId, collectionId)).groups.find((g) => g.id === id);
    assert.deepEqual(group?.custom, []);
    assert.equal(group?.postTemplate, "");
    await deleteFacebookGroup(userId, id);
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
