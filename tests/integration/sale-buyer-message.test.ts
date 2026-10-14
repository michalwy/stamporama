import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer } from "../../src/lib/offers";
import { setFacebookPlatform } from "../../src/lib/facebook";
import { createFacebookGroup, updateFacebookDefaults } from "../../src/lib/facebook-groups";
import { FACEBOOK_BLANK_SETTINGS, FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { readSaleBuyerMessage } from "../../src/lib/sale-buyer-message";

// The message to a buyer after a sale (#1815): which template a sale is written from, and the sale's
// own figures in it. Off Facebook it is the platform contact's; on Facebook the group's when every
// offer of the sale is from that one group (its own, or the default it follows), and Facebook's
// default otherwise. No template is no message. The placeholders' wording is the pure half,
// `tests/unit/buyer-message-rules.test.ts`.

describe("The message to a buyer (#1815)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let delcampeId: string;
  let silentId: string;
  let stampId: string;
  let conditionId: string;
  let ownGroupId: string;
  let followingGroupId: string;
  let buyerId: string;
  let saleNo = 0;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-buyermsg-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-buyermsg-${ts}`, name: `buyermsg-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.contact.create({
        data: { collectionId, name: "Facebook", platform: true, platformCurrency: "PLN" },
      })
    ).id;
    delcampeId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Delcampe",
          platform: true,
          platformCurrency: "EUR",
          buyerMessageTemplate: "Sale {sale} for {buyer}: {itemsTotal}\n{shippingOptions}",
        },
      })
    ).id;
    silentId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true, platformCurrency: "PLN" } })
    ).id;
    await setFacebookPlatform(userId, collectionId, facebookId);
    // The Delcampe letter is sent by a service that costs the collector less than the buyer pays: the
    // message lists the buyer's price (#1909).
    const carrier = await prisma.carrier.create({ data: { collectionId, name: "La Poste" } });
    const service = await prisma.carrierService.create({
      data: { collectionId, carrierId: carrier.id, name: "Lettre", cost: "1.80", currency: "EUR" },
    });
    await prisma.shippingOption.createMany({
      data: [
        { collectionId, platformId: delcampeId, name: "Letter", price: "2.50", currency: "EUR", serviceId: service.id },
        { collectionId, platformId: facebookId, name: "Registered letter", price: "12.00", currency: "PLN" },
      ],
    });
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Jan Kowalski", buyer: true } })).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;

    await updateFacebookDefaults(userId, collectionId, {
      ...FACEBOOK_BLANK_SETTINGS,
      buyerMessageTemplate: "Facebook: {items}\nTotal {total}",
    });
    const group = (name: string, own: string | null) =>
      createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name,
        url: `https://www.facebook.com/groups/${name}`,
        buyerMessageTemplate: own ?? "",
        custom: own === null ? [] : ["buyerMessageTemplate"],
      });
    ownGroupId = (await group("own", "Own group: {items}\n{shipping}\nTotal {total}")).id;
    followingGroupId = (await group("following", null)).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** An offer of one copy, named, at `price`, on `platformId` — in `groupId` on Facebook. */
  async function offer(name: string, price: string, platformId: string, groupId: string | null = null) {
    const itemId = (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId,
        url: null,
        name,
        price,
        currency: platformId === delcampeId ? "EUR" : "PLN",
        listingDate: null,
        state: "preparing",
        facebookGroupId: groupId,
        ...(groupId ? { listingType: "fixed" as const } : {}),
      },
      { seedItemIds: [itemId] }
    );
    const row = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { offerNo: true, price: true, sets: { select: { id: true } } },
    });
    return { offerId, offerNo: row.offerNo, setId: row.sets[0].id, price: row.price.toFixed(2) };
  }

  /** A sale of these offers, recorded directly: the message reads the sale, not how it was made. */
  async function sale(
    platformId: string,
    offers: Awaited<ReturnType<typeof offer>>[],
    extra: { shippingOptionName?: string; buyerHandling?: string; buyerPaidTotal?: string } = {}
  ): Promise<string> {
    const created = await prisma.sale.create({
      data: {
        collectionId,
        saleNo: ++saleNo,
        platformId,
        buyerId,
        soldAt: new Date("2026-10-11"),
        currency: platformId === delcampeId ? "EUR" : "PLN",
        ...extra,
      },
      select: { id: true },
    });
    for (const o of offers) {
      await prisma.saleLine.create({
        data: { saleId: created.id, offerId: o.offerId, offerSetId: o.setId, price: o.price },
      });
    }
    return created.id;
  }

  it("writes a sale off Facebook from its platform's template", async () => {
    const a = await offer("Austria 1850", "15.00", delcampeId);
    const id = await sale(delcampeId, [a]);
    const message = await readSaleBuyerMessage(userId, id);
    assert.deepEqual(message, {
      text: `Sale ${saleNo} for Jan Kowalski: 15 EUR\nLetter — 2.50 EUR`,
      source: "Delcampe",
    });
  });

  it("has no message where the platform has no template, and none for another user", async () => {
    const a = await offer("Poland 1860", "5.00", silentId);
    assert.equal(await readSaleBuyerMessage(userId, await sale(silentId, [a])), null);
    const b = await offer("Austria 1850", "15.00", delcampeId);
    assert.equal(await readSaleBuyerMessage("someone-else", await sale(delcampeId, [b])), null);
  });

  it("takes the group's own template when every offer is from that group, with the shipping in the total", async () => {
    const a = await offer("Mercury", "20.00", facebookId, ownGroupId);
    const b = await offer("Eagle", "10.50", facebookId, ownGroupId);
    const before = await readSaleBuyerMessage(userId, await sale(facebookId, [a, b]));
    assert.deepEqual(before, {
      text: `Own group: #${a.offerNo} Mercury\n#${b.offerNo} Eagle\n\nTotal 30.50 PLN`,
      source: "own",
    });
    // An option chosen, and the postage worked out from the total the buyer paid (#205).
    const chosen = await readSaleBuyerMessage(
      userId,
      await sale(facebookId, [a, b], { shippingOptionName: "Registered letter", buyerPaidTotal: "42.50" })
    );
    assert.equal(
      chosen?.text,
      `Own group: #${a.offerNo} Mercury\n#${b.offerNo} Eagle\nRegistered letter — 12 PLN\nTotal 42.50 PLN`
    );
  });

  it("takes Facebook's template for a group that follows it, and for a sale across groups", async () => {
    const own = await offer("Mercury", "20.00", facebookId, ownGroupId);
    const following = await offer("Eagle", "10.00", facebookId, followingGroupId);
    const followed = await readSaleBuyerMessage(
      userId,
      await sale(facebookId, [following], { shippingOptionName: "Registered letter", buyerHandling: "12.00" })
    );
    assert.deepEqual(followed, { text: `Facebook: #${following.offerNo} Eagle\nTotal 22 PLN`, source: "Facebook" });
    const across = await readSaleBuyerMessage(userId, await sale(facebookId, [own, following]));
    assert.equal(across?.source, "Facebook");
    assert.equal(across?.text, `Facebook: #${own.offerNo} Mercury\n#${following.offerNo} Eagle\nTotal 30 PLN`);
  });

  it("has no message on Facebook once the template it would use is blank", async () => {
    const following = await offer("Eagle", "10.00", facebookId, followingGroupId);
    const id = await sale(facebookId, [following]);
    await updateFacebookDefaults(userId, collectionId, { ...FACEBOOK_BLANK_SETTINGS });
    try {
      assert.equal(await readSaleBuyerMessage(userId, id), null);
    } finally {
      await updateFacebookDefaults(userId, collectionId, {
        ...FACEBOOK_BLANK_SETTINGS,
        buyerMessageTemplate: "Facebook: {items}\nTotal {total}",
      });
    }
  });
});
