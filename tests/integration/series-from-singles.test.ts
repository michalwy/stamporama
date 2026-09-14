import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer } from "../../src/lib/offers";
import { createTrade } from "../../src/lib/trades";
import { findSeriesRecombinations } from "../../src/lib/series-recombination";
import {
  DEFAULT_SERIES_CRITERIA,
  NO_MIXING,
  type SeriesCriteria,
} from "../../src/lib/series-recombination-rules";
import type { OfferState } from "../../src/lib/offer-rules";

// The series-recombination screen's read (#1210): which series one platform's single offers plus its
// available copies could complete.
//
// What is pinned here is what the pure rules cannot see: that *available* is the bulk-lot builder's
// own reading of the database, that the singles are read off the platform's real offer sets, that a
// bid anywhere and a composed set disqualify a copy, and that the names come back. Each case builds
// a series of its own, so the cases never see each other's copies.

const ts = Date.now();

describe("series from singles (#1210)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let platformId: string;
  let otherPlatformId: string;
  let partnerId: string;
  let mnhId: string;
  let usedId: string;
  let certId: string;
  let saleNo = 9500;
  let variantSubtypeId: string;
  let nextIssueNo = 9800;
  let nextStamp = 0;

  async function stamp(opts: { parentId?: string; subtypeId?: string } = {}): Promise<string> {
    nextStamp += 1;
    return (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp ${nextStamp}`,
          issuedYear: 1960,
          parentId: opts.parentId,
          subtypeId: opts.subtypeId,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      })
    ).id;
  }

  async function stamps(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) ids.push(await stamp());
    return ids;
  }

  /** A for-sale MNH copy in hand with no certificate, unless told otherwise. */
  async function copy(
    stampId: string,
    opts: { deliveryState?: string; conditionId?: string; certificateStatusId?: string } = {}
  ): Promise<string> {
    return (
      await createItem(userId, collectionId, {
        stampId,
        conditionId: opts.conditionId ?? mnhId,
        certificateStatusId: opts.certificateStatusId,
        forSale: true,
        deliveryState: opts.deliveryState ?? "delivered",
      })
    ).id;
  }

  /** An offer holding the given sets, put straight into its state — the read is under test, not the
   *  lifecycle's gates. */
  async function offer(
    sets: string[][],
    opts: { platformId?: string; state?: OfferState; inActiveBidding?: boolean } = {}
  ): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId: opts.platformId ?? platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    for (const itemIds of sets) await addOfferSet(userId, offerId, itemIds);
    await prisma.offer.update({
      where: { id: offerId },
      data: { state: opts.state ?? "active", inActiveBidding: opts.inActiveBidding ?? false },
    });
    return offerId;
  }

  async function checklist(stampIds: string[]): Promise<string> {
    const issue = await prisma.issue.create({
      data: { collectionId, issueNo: ++nextIssueNo, collectionAreaId: areaId, name: `Issue ${nextIssueNo}`, year: 1960 },
    });
    return (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId: issue.id,
          name: "Complete set",
          stamps: { create: stampIds.map((stampId, sortOrder) => ({ stampId, sortOrder })) },
        },
      })
    ).id;
  }

  async function listed(checklistId: string, onPlatform = platformId) {
    const result = await findSeriesRecombinations(userId, collectionId, onPlatform);
    return result.series.find((series) => series.checklistId === checklistId) ?? null;
  }

  async function listedWith(checklistId: string, criteria: SeriesCriteria) {
    const result = await findSeriesRecombinations(userId, collectionId, platformId, criteria);
    return result.series.find((series) => series.checklistId === checklistId) ?? null;
  }

  /** Sell the copy through a one-copy offer of its own, the offer then left in the given state —
   *  `sold` as the lifecycle leaves it, or still `active` as an offer nobody moved (#1263). */
  async function sell(itemId: string, offerState: OfferState, onPlatform = platformId): Promise<void> {
    const offerId = await offer([[itemId]], { state: offerState, platformId: onPlatform });
    const set = await prisma.offerSet.findFirstOrThrow({ where: { offerId }, select: { id: true } });
    const sale = await prisma.sale.create({
      data: { collectionId, saleNo: ++saleNo, platformId: onPlatform, soldAt: new Date(), currency: "EUR" },
    });
    const line = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId, offerSetId: set.id, price: "5.00" },
    });
    await prisma.saleLineItem.create({ data: { saleLineId: line.id, itemId } });
  }

  /** Give the copy to a partner in a closed trade (#644). */
  async function tradeAway(itemId: string): Promise<void> {
    const trade = await createTrade(userId, collectionId, { partnerId, currency: "EUR" });
    await prisma.tradeLine.create({
      data: { tradeId: trade.id, sectionId: trade.sections[0].id, side: "give", itemId },
    });
    await prisma.trade.update({ where: { id: trade.id }, data: { status: "closed" } });
  }

  async function writeOff(itemId: string): Promise<void> {
    await prisma.item.update({ where: { id: itemId }, data: { disposedAt: new Date() } });
  }

  before(async () => {
    userId = `test-user-recombine-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User recombine-${ts}`,
        email: `test-recombine-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-recombine-${ts}`, name: "Recombine", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;
    certId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Certificate", abbreviation: "Cert", sortOrder: 0 },
      })
    ).id;
    variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Gum variety", actsAsVariant: true, isDefault: true, sortOrder: 0 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    otherPlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Colnect", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    partnerId = (
      await prisma.contact.create({ data: { collectionId, name: "Anna", seller: false } })
    ).id;
  });

  after(async () => {
    // A sold copy's rows restrict its item and its set, so they go first.
    await prisma.saleLineItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.saleLine.deleteMany({ where: { sale: { collectionId } } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("lists #754's use case on its platform, naming the three singles — and on no other platform", async () => {
    const ids = await stamps(5);
    const setId = await checklist(ids);
    const singles = [
      await offer([[await copy(ids[0])]], { state: "active" }),
      await offer([[await copy(ids[1])]], { state: "paused" }),
      await offer([[await copy(ids[2])]], { state: "preparing" }),
    ];
    await copy(ids[3]);
    await copy(ids[4]);

    const series = await listed(setId);
    assert.ok(series, "listed on the platform the singles are on");
    assert.equal(series.checklistName, "Complete set");
    assert.equal(series.slots.length, 5);
    assert.deepEqual(
      series.slots.map((slot) => slot.stamp.stampId),
      ids,
      "the slots read in the checklist's order"
    );
    assert.deepEqual(
      series.slots.slice(0, 3).map((slot) => slot.fillers[0].offers.map((o) => o.offerId)),
      singles.map((id) => [id]),
      "each single names the offer holding it"
    );
    assert.deepEqual(
      series.slots.slice(0, 3).map((slot) => slot.fillers[0].offers[0].state),
      ["active", "paused", "preparing"]
    );
    assert.deepEqual(
      series.slots.slice(3).map((slot) => slot.fillers[0].offers),
      [[], []],
      "the two late arrivals are available"
    );
    assert.equal(series.offersToChange, 3);
    assert.equal(series.liveOffersToChange, 2, "active and paused are live; preparing is not");

    assert.equal(
      await listed(setId, otherPlatformId),
      null,
      "on another platform every copy is available, so the series needs no recombining there"
    );
  });

  it("does not list a series the available copies complete on their own", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    await copy(ids[0]);
    await copy(ids[1]);
    await offer([[await copy(ids[0])]]);
    assert.equal(await listed(setId), null);
  });

  it("does not list a series still missing a slot after the singles are counted", async () => {
    const ids = await stamps(3);
    const setId = await checklist(ids);
    await offer([[await copy(ids[0])]]);
    await copy(ids[1]);
    assert.equal(await listed(setId), null);
  });

  it("does not list a checklist of one stamp, whether its stamp is offered singly or available (#1257)", async () => {
    const [offeredStamp] = await stamps(1);
    const offeredSetId = await checklist([offeredStamp]);
    await offer([[await copy(offeredStamp)]]);

    const [availableStamp] = await stamps(1);
    const availableSetId = await checklist([availableStamp]);
    await copy(availableStamp);
    await offer([[await copy(availableStamp)]]);

    // A two-stamp series on the same platform in the same read is still listed, so the empty answers
    // above are the one-stamp rule and not a read that found nothing.
    const pair = await stamps(2);
    const pairSetId = await checklist(pair);
    await offer([[await copy(pair[0])]]);
    await copy(pair[1]);

    assert.equal(await listed(offeredSetId), null, "its stamp offered singly");
    assert.equal(await listed(availableSetId), null, "its stamp available");
    assert.ok(await listed(pairSetId), "a two-stamp series beside it is listed as before");
  });

  it("does not fill a slot with a copy in an offer in active bidding — here or on another platform (#334)", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    await copy(ids[0]);
    await offer([[await copy(ids[1])]], { inActiveBidding: true });
    assert.equal(await listed(setId), null, "under bid on this platform");

    const others = await stamps(2);
    const otherSetId = await checklist(others);
    await copy(others[0]);
    const both = await copy(others[1]);
    await offer([[both]]);
    await offer([[both]], { platformId: otherPlatformId, inActiveBidding: true });
    assert.equal(await listed(otherSetId), null, "under bid elsewhere");
  });

  it("does not fill a slot with a copy in a multi-copy set", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    await copy(ids[0]);
    const composed = await copy(ids[1]);
    await offer([[composed, await copy(await stamp())]]);
    assert.equal(await listed(setId), null);
  });

  it("does not fill a slot with a copy in a sold or withdrawn offer, though an open one would", async () => {
    // In transit, so the copy is not *available* either — the only way it could fill the slot is as a
    // single, which is exactly the question.
    for (const state of ["withdrawn", "sold"] as const) {
      const ids = await stamps(2);
      const setId = await checklist(ids);
      await copy(ids[0]);
      await offer([[await copy(ids[1], { deliveryState: "in_transit" })]], { state });
      assert.equal(await listed(setId), null, state);
    }

    const ids = await stamps(2);
    const setId = await checklist(ids);
    await copy(ids[0]);
    await offer([[await copy(ids[1], { deliveryState: "in_transit" })]], { state: "preparing" });
    assert.ok(await listed(setId), "the same copy alone in a Preparing offer does fill it");
  });

  it("lets a variant copy fill its parent's slot (#661)", async () => {
    const [parent, other] = await stamps(2);
    const variant = await stamp({ parentId: parent, subtypeId: variantSubtypeId });
    const setId = await checklist([parent, other]);
    const variantCopy = await copy(variant);
    await offer([[await copy(other)]]);

    const series = await listed(setId);
    assert.ok(series);
    assert.equal(series.slots[0].fillers[0].itemId, variantCopy);
    assert.equal(series.slots[0].fillers[0].variant?.stampId, variant, "named as the variant it is");
  });

  it("fills a slot with a copy promised in an agreed trade, and names the trade (#639)", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    const promised = await copy(ids[0]);
    await offer([[promised]]);
    await copy(ids[1]);
    const trade = await createTrade(userId, collectionId, { partnerId, currency: "EUR" });
    await prisma.tradeLine.create({
      data: { tradeId: trade.id, sectionId: trade.sections[0].id, side: "give", itemId: promised },
    });
    await prisma.trade.update({ where: { id: trade.id }, data: { status: "agreed" } });

    const series = await listed(setId);
    assert.ok(series, "a promise does not take the copy out");
    assert.equal(series.slots[0].fillers[0].promisedIn?.tradeId, trade.id);
    assert.equal(series.slots[0].fillers[0].promisedIn?.partnerName, "Anna");
  });

  it("does not fill a slot with a sold copy, whichever route would count it (#1263)", async () => {
    const routes = [
      // The sale closed the offer, so the copy sits in no open offer here and read as available.
      ["sold through an offer now Sold", (id: string) => sell(id, "sold")],
      // A sold copy in an offer left Active is still sold.
      ["sold through a single offer left Active", (id: string) => sell(id, "active")],
      // On this platform it was never offered at all.
      ["sold on another platform, its offer left Active", (id: string) => sell(id, "active", otherPlatformId)],
    ] as const;
    for (const [label, sale] of routes) {
      const ids = await stamps(2);
      const setId = await checklist(ids);
      await offer([[await copy(ids[0])]]);
      const leaving = await copy(ids[1]);
      assert.ok(await listed(setId), `${label}: listed while the copy is held`);
      await sale(leaving);
      assert.equal(await listed(setId), null, label);
    }
  });

  it("does not fill a slot with a copy traded away or written off, available or in an Active single (#1263)", async () => {
    for (const [label, leave] of [["traded away", tradeAway], ["written off", writeOff]] as const) {
      for (const singly of [false, true]) {
        const ids = await stamps(2);
        const setId = await checklist(ids);
        await offer([[await copy(ids[0])]]);
        const leaving = await copy(ids[1]);
        if (singly) await offer([[leaving]], { state: "active" });
        assert.ok(await listed(setId), `${label}, ${singly ? "single" : "available"}: listed while held`);
        await leave(leaving);
        assert.equal(await listed(setId), null, `${label}, ${singly ? "single" : "available"}`);
      }
    }
  });

  it("lists a series that stays complete without a sold copy, with only the copies still held (#1263)", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    await offer([[await copy(ids[0])]]);
    await sell(await copy(ids[1]), "sold");
    const kept = await copy(ids[1]);

    const series = await listed(setId);
    assert.ok(series);
    assert.deepEqual(series.slots[1].fillers.map((filler) => filler.itemId), [kept]);
  });

  it("proposes a checklist complete in two conditions as two cards, each naming its combination (#1265)", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    await offer([[await copy(ids[0])]]);
    await copy(ids[1]);
    await offer([[await copy(ids[0], { conditionId: usedId })]]);
    await copy(ids[1], { conditionId: usedId });

    const cards = (await findSeriesRecombinations(userId, collectionId, platformId)).series.filter(
      (series) => series.checklistId === setId
    );
    assert.deepEqual(
      cards.map((card) => card.combinationLabels),
      [
        ["Mint Never Hinged", "No certificate", "Single"],
        ["Used", "No certificate", "Single"],
      ],
      "one card per condition, in the conditions' order"
    );
    assert.deepEqual(
      cards.map((card) => card.slots.flatMap((slot) => slot.fillers.map((filler) => filler.condition))),
      [["MNH", "MNH"], ["U", "U"]],
      "neither card holds a copy of the other condition"
    );
    assert.notEqual(cards[0].key, cards[1].key);
    assert.deepEqual(cards[0].combination, { conditionId: mnhId, certificateStatusId: null, formatId: null });
  });

  it("mixes conditions only when asked, and a filter that removes a copy breaks the series (#1265)", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    await offer([[await copy(ids[0])]]);
    await copy(ids[1], { conditionId: usedId });
    const mixed: SeriesCriteria = { ...DEFAULT_SERIES_CRITERIA, mixing: { ...NO_MIXING, condition: true } };

    assert.equal(await listed(setId), null, "not by default");
    assert.deepEqual((await listedWith(setId, mixed))?.combinationLabels, ["No certificate", "Single"]);
    assert.equal(
      await listedWith(setId, { ...mixed, conditionIds: [mnhId] }),
      null,
      "complete only thanks to the used copy the filter leaves out"
    );
    assert.ok(await listedWith(setId, { ...mixed, conditionIds: [mnhId, usedId] }), "a filter keeping both");
  });

  it("keeps certificates apart unless certificate mixing is on, and filters on No certificate (#1265)", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    await offer([[await copy(ids[0], { certificateStatusId: certId })]]);
    await copy(ids[1]);
    const mixed: SeriesCriteria = { ...DEFAULT_SERIES_CRITERIA, mixing: { ...NO_MIXING, certificate: true } };

    assert.equal(await listed(setId), null);
    assert.equal(
      await listedWith(setId, { ...DEFAULT_SERIES_CRITERIA, mixing: { ...NO_MIXING, condition: true } }),
      null,
      "mixing another axis does not mix this one"
    );
    assert.deepEqual((await listedWith(setId, mixed))?.combinationLabels, ["Mint Never Hinged", "Single"]);
    assert.equal(await listedWith(setId, { ...mixed, certificateStatusIds: ["none"] }), null);
  });

  it("narrows the variant copies with the subtype filter (#1265)", async () => {
    const [parent, other] = await stamps(2);
    const variant = await stamp({ parentId: parent, subtypeId: variantSubtypeId });
    const setId = await checklist([parent, other]);
    await copy(variant);
    await offer([[await copy(other)]]);

    assert.ok(await listed(setId), "a variant copy still fills its parent's slot");
    assert.equal(await listedWith(setId, { ...DEFAULT_SERIES_CRITERIA, subtypeIds: ["none"] }), null);
    assert.ok(await listedWith(setId, { ...DEFAULT_SERIES_CRITERIA, subtypeIds: ["none", variantSubtypeId] }));
  });

  it("collapses identical candidates from one offer and names each copy's photos (#1266)", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    const alike = [await copy(ids[0]), await copy(ids[0]), await copy(ids[0])];
    const elsewhere = await copy(ids[0]);
    await offer(alike.map((itemId) => [itemId]));
    await offer([[elsewhere]]);
    await copy(ids[1]);
    const photo = await prisma.photo.create({
      data: {
        itemId: alike[1],
        role: "front",
        storageKey: `test/recombine-${ts}-front`,
        mime: "image/jpeg",
        width: 100,
        height: 100,
        sizeBytes: 1000,
      },
    });

    const series = await listed(setId);
    assert.ok(series);
    const itemNos = await prisma.item.findMany({ where: { id: { in: [...alike, elsewhere] } }, select: { id: true, itemNo: true } });
    const byNo = [...alike].sort(
      (a, b) => itemNos.find((row) => row.id === a)!.itemNo - itemNos.find((row) => row.id === b)!.itemNo
    );
    assert.deepEqual(
      series.slots[0].candidates.map((group) => group.itemIds),
      [byNo, [elsewhere]],
      "the three singles of one offer are one line, lowest number first; the other offer's copy is its own"
    );
    assert.equal(series.slots[0].fillers.length, 4, "the flat list still holds every copy");
    const photos = new Map(series.slots[0].fillers.map((filler) => [filler.itemId, filler.photos]));
    assert.deepEqual(photos.get(alike[1])?.map((p) => p.id), [photo.id]);
    assert.deepEqual(photos.get(alike[0]), [], "a copy with no photo says so with an empty list");
  });

  it("refuses a platform that is not one of the collection's", async () => {
    await assert.rejects(findSeriesRecombinations(userId, collectionId, partnerId));
  });
});
