import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { createSale, cancelSale } from "../../src/lib/sales";
import { createTrade } from "../../src/lib/trades";
import { createProposal } from "../../src/lib/proposals";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import {
  createFacebookPostPreviewToken,
  revokeFacebookPostPreviewToken,
  verifyFacebookPostPreviewToken,
} from "../../src/lib/facebook-post-preview";
import {
  createOfferSpecificationShareToken,
  revokeOfferSpecificationShareToken,
} from "../../src/lib/offer-specification-share";
import { createProposalShareToken, revokeProposalShareToken } from "../../src/lib/proposal-handout";
import { createSaleShareToken, revokeSaleShareToken } from "../../src/lib/sale-share";
import { createTradeShareToken, revokeTradeShareToken } from "../../src/lib/trade-share";
import {
  readShareLinkHistory,
  recordShareLinkVisit,
  sweepShareLinkVisits,
  type ShareLinkVisitor,
} from "../../src/lib/share-link-visits";
import { currentShareLink, summarizeShareLinkVisits, type ShareLinkKind } from "../../src/lib/share-link-visit-rules";

// A share link's visit history (#2557), against a real database: every opening of a link's page is
// recorded with its time, IP address and browser, newest first; the collector's own are marked; a new
// link keeps the old one's visits under *replaced*, a withdrawal under *withdrawn*, and an opening of
// either is recorded too; the same for all five kinds of link; a visit older than 90 days is gone.

const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const LAPTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

describe("a share link's visit history (#2557)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let facebookId: string;
  let platformId: string;
  let conditionId: string;
  let contactId: string;
  let groupId: string;

  const buyer = (ipAddress: string, userAgent: string): ShareLinkVisitor => ({ ipAddress, userAgent, userId: null });

  before(async () => {
    const ts = Date.now();
    userId = `test-user-visits-${ts}`;
    otherUserId = `test-user-visits-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: id, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-visits-${ts}`, name: `visits-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-visits-other-${ts}`, name: `visits-other-${ts}`, baseCurrency: "PLN", ownerId: otherUserId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN", titleLanguage: "pl" } })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Shop", platformCurrency: "PLN" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    contactId = (await prisma.contact.create({ data: { collectionId, name: "Jan", buyer: true } })).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki",
        url: "https://www.facebook.com/groups/2557",
        postTemplate: "{title} — start {startingPrice}",
      })
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  async function offerOnOneCopy(onPlatform: string): Promise<string> {
    const stamp = await prisma.stamp.create({ data: { collectionId, name: `Stamp ${Math.random()}` } });
    const item = await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true });
    const facebook = onPlatform === facebookId;
    return createOffer(
      userId,
      collectionId,
      {
        platformId: onPlatform,
        url: null,
        price: facebook ? "0.00" : "10.00",
        startingPrice: facebook ? "5.00" : null,
        currency: "PLN",
        listingDate: null,
        listingType: facebook ? "auction" : "fixed",
        ...(facebook ? { facebookGroupId: groupId, name: "Lot" } : {}),
      },
      { seedItemIds: [item.id] }
    );
  }

  /** A Ready Facebook offer is a post of one (#2116); its post is the link's subject. */
  async function readyPost(): Promise<string> {
    const offerId = await offerOnOneCopy(facebookId);
    await setOfferState(userId, offerId, "ready");
    const { facebookPostId } = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
    return facebookPostId!;
  }

  const history = (kind: ShareLinkKind, subjectId: string) => readShareLinkHistory(userId, collectionId, kind, subjectId);

  it("records every opening of a post preview link — two devices and a reload are three visits, newest first", async () => {
    const postId = await readyPost();
    const { token } = await createFacebookPostPreviewToken(userId, postId);
    const t0 = Date.now();
    assert.equal(await recordShareLinkVisit("post_preview", token, buyer("203.0.113.7", PHONE), new Date(t0)), true);
    await recordShareLinkVisit("post_preview", token, buyer("198.51.100.20", LAPTOP), new Date(t0 + 60_000));
    await recordShareLinkVisit("post_preview", token, buyer("198.51.100.20", LAPTOP), new Date(t0 + 120_000));

    const read = await history("post_preview", postId);
    assert.equal(read.links.length, 1);
    const [link] = read.links;
    assert.equal(link.status, "current");
    assert.deepEqual(
      link.visits.map((v) => [v.ipAddress, v.userAgent, v.own]),
      [
        ["198.51.100.20", LAPTOP, false],
        ["198.51.100.20", LAPTOP, false],
        ["203.0.113.7", PHONE, false],
      ]
    );
    assert.ok(link.visits[0].at > link.visits[2].at, "newest first");

    const summary = summarizeShareLinkVisits(link.visits);
    assert.equal(summary.visits, 3);
    assert.equal(summary.lastOpenedAt, new Date(t0 + 120_000).toISOString());
  });

  it("marks the collector's own opening as theirs and keeps it out of the dialog's count", async () => {
    const postId = await readyPost();
    const { token } = await createFacebookPostPreviewToken(userId, postId);
    await recordShareLinkVisit("post_preview", token, { ipAddress: "10.0.0.1", userAgent: LAPTOP, userId });
    // Somebody else signed in to this app is still a buyer here.
    await recordShareLinkVisit("post_preview", token, { ipAddress: "10.0.0.2", userAgent: PHONE, userId: otherUserId });

    const link = currentShareLink(await history("post_preview", postId))!;
    assert.deepEqual(link.visits.map((v) => v.own).sort(), [false, true]);
    const summary = summarizeShareLinkVisits(link.visits);
    assert.equal(summary.visits, 1);
    assert.equal(summary.ownVisits, 1);
  });

  it("keeps the old link's visits under *replaced* after a new link, and records an opening of the old address", async () => {
    const postId = await readyPost();
    const first = await createFacebookPostPreviewToken(userId, postId);
    await recordShareLinkVisit("post_preview", first.token, buyer("203.0.113.1", PHONE));
    const second = await createFacebookPostPreviewToken(userId, postId);
    assert.equal(await verifyFacebookPostPreviewToken(first.token, { touch: false }), null, "the old address is dead");
    // The buyer still holding the old address opens it: they see a notice, and the visit is recorded.
    assert.equal(await recordShareLinkVisit("post_preview", first.token, buyer("203.0.113.1", PHONE)), true);

    const read = await history("post_preview", postId);
    assert.deepEqual(
      read.links.map((l) => [l.status, l.visits.length]),
      [
        ["current", 0],
        ["replaced", 2],
      ]
    );
    assert.ok(read.links[1].endedAt, "the replaced link says when");
    await recordShareLinkVisit("post_preview", second.token, buyer("203.0.113.2", LAPTOP));
    assert.equal(currentShareLink(await history("post_preview", postId))!.visits.length, 1);
  });

  it("keeps a withdrawn link's visits under *withdrawn*, and records an opening of it", async () => {
    const postId = await readyPost();
    const { token } = await createFacebookPostPreviewToken(userId, postId);
    await recordShareLinkVisit("post_preview", token, buyer("203.0.113.3", PHONE));
    await revokeFacebookPostPreviewToken(userId, postId);
    assert.equal(await recordShareLinkVisit("post_preview", token, buyer("203.0.113.3", PHONE)), true);

    const read = await history("post_preview", postId);
    assert.deepEqual(
      read.links.map((l) => [l.status, l.visits.length]),
      [["withdrawn", 2]]
    );
  });

  it("records nothing for an address no link of that kind ever had", async () => {
    const postId = await readyPost();
    const { token } = await createFacebookPostPreviewToken(userId, postId);
    assert.equal(await recordShareLinkVisit("post_preview", "stmpf_invented", buyer("1.1.1.1", PHONE)), false);
    assert.equal(await recordShareLinkVisit("sale", token, buyer("1.1.1.1", PHONE)), false, "another kind's page");
    assert.equal(currentShareLink(await history("post_preview", postId))!.visits.length, 0);
  });

  it("works the same for a specification, a proposal, a sale and a trade link", async () => {
    const offerId = await offerOnOneCopy(platformId);
    const { proposalId } = await createProposal(userId, collectionId, contactId);
    const saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: "TX-VISITS",
      transactionUrl: null,
      soldAt: new Date(),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    const tradeId = (
      await createTrade(userId, collectionId, {
        partnerId: contactId,
        partnerName: null,
        currency: "PLN",
        notes: null,
        catalogVendorId: null,
        balanceByValue: false,
        countTolerance: 0,
        valueTolerancePct: 0,
        ownValueWarnPct: 25,
      })
    ).id;

    const kinds: Array<{
      kind: ShareLinkKind;
      subjectId: string;
      mint: () => Promise<{ token: string }>;
      revoke: () => Promise<void>;
    }> = [
      {
        kind: "offer_specification",
        subjectId: offerId,
        mint: () => createOfferSpecificationShareToken(userId, offerId),
        revoke: () => revokeOfferSpecificationShareToken(userId, offerId),
      },
      {
        kind: "proposal",
        subjectId: proposalId,
        mint: () => createProposalShareToken(userId, proposalId),
        revoke: () => revokeProposalShareToken(userId, proposalId),
      },
      {
        kind: "sale",
        subjectId: saleId,
        mint: () => createSaleShareToken(userId, saleId, { expiresAt: null }),
        revoke: () => revokeSaleShareToken(userId, saleId),
      },
      {
        kind: "trade",
        subjectId: tradeId,
        mint: () => createTradeShareToken(userId, tradeId, { showValues: false, expiresAt: null }),
        revoke: () => revokeTradeShareToken(userId, tradeId),
      },
    ];

    for (const { kind, subjectId, mint, revoke } of kinds) {
      const first = await mint();
      await recordShareLinkVisit(kind, first.token, buyer("192.0.2.1", PHONE));
      await recordShareLinkVisit(kind, first.token, { ipAddress: "192.0.2.9", userAgent: LAPTOP, userId });
      const second = await mint();
      await recordShareLinkVisit(kind, second.token, buyer("192.0.2.2", LAPTOP));
      await revoke();
      await recordShareLinkVisit(kind, second.token, buyer("192.0.2.2", LAPTOP));

      const read = await history(kind, subjectId);
      assert.deepEqual(
        read.links.map((l) => [l.status, l.visits.length, l.visits.filter((v) => v.own).length]),
        [
          ["withdrawn", 2, 0],
          ["replaced", 2, 1],
        ],
        kind
      );
    }
  });

  it("marks a cancelled sale's link withdrawn", async () => {
    const saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: "TX-CANCEL",
      transactionUrl: null,
      soldAt: new Date(),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    const { token } = await createSaleShareToken(userId, saleId, { expiresAt: null });
    await recordShareLinkVisit("sale", token, buyer("192.0.2.3", PHONE));
    await cancelSale(userId, saleId, { reason: "Not paid", offerOutcomes: {} });
    const read = await history("sale", saleId);
    assert.deepEqual(
      read.links.map((l) => l.status),
      ["withdrawn"]
    );
  });

  it("is read only by the collection's owner, and only for its own links", async () => {
    const postId = await readyPost();
    await createFacebookPostPreviewToken(userId, postId);
    await assert.rejects(() => readShareLinkHistory(otherUserId, collectionId, "post_preview", postId));
    assert.deepEqual(await readShareLinkHistory(otherUserId, otherCollectionId, "post_preview", postId), { links: [] });
  });

  it("removes a visit older than 90 days, and then a link that ended long ago with nothing to show", async () => {
    const postId = await readyPost();
    const now = new Date();
    const old = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);
    const first = await createFacebookPostPreviewToken(userId, postId);
    await recordShareLinkVisit("post_preview", first.token, buyer("192.0.2.4", PHONE), old);
    await recordShareLinkVisit("post_preview", first.token, buyer("192.0.2.5", PHONE), recent);
    const second = await createFacebookPostPreviewToken(userId, postId);
    await recordShareLinkVisit("post_preview", second.token, buyer("192.0.2.6", PHONE), old);
    // The first link ended long ago.
    await prisma.shareLink.updateMany({ where: { subjectId: postId, endReason: "replaced" }, data: { endedAt: old } });

    await sweepShareLinkVisits(now);
    let read = await history("post_preview", postId);
    assert.deepEqual(
      read.links.map((l) => [l.status, l.visits.map((v) => v.ipAddress)]),
      [
        ["current", []],
        ["replaced", ["192.0.2.5"]],
      ]
    );

    // Once its last visit is past the period too, the ended link goes; the current one stays.
    await sweepShareLinkVisits(new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000));
    read = await history("post_preview", postId);
    assert.deepEqual(
      read.links.map((l) => l.status),
      ["current"]
    );
    assert.equal(await prisma.shareLink.count({ where: { subjectId: postId } }), 1);
  });
});
