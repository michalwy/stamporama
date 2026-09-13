import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer } from "../../src/lib/offers";
import { composeSeriesOffer, findSeriesRecombinations } from "../../src/lib/series-recombination";
import { formatItemNo } from "../../src/lib/item-number";
import type { OfferState } from "../../src/lib/offer-rules";

// Composing a series out of single offers (#1211): one new Preparing offer holding the series as one
// set, each chosen single's one-copy set taken out of its offer, an emptied offer withdrawn, a live
// offer that kept something flagged — and a chosen copy that stopped being a candidate refusing the
// whole commit, with nothing written. Each case builds a series of its own.

const ts = Date.now();

describe("compose a series offer out of single offers (#1211)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let platformId: string;
  let mnhId: string;
  let nextIssueNo = 9900;
  let nextStamp = 0;

  async function stamps(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      nextStamp += 1;
      ids.push(
        (
          await prisma.stamp.create({
            data: {
              collectionId,
              name: `Stamp ${nextStamp}`,
              issuedYear: 1960,
              stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
            },
          })
        ).id
      );
    }
    return ids;
  }

  async function copy(stampId: string): Promise<string> {
    return (
      await createItem(userId, collectionId, {
        stampId,
        conditionId: mnhId,
        forSale: true,
        deliveryState: "delivered",
      })
    ).id;
  }

  /** An offer holding the given sets, put straight into its state — the compose is under test, not
   *  the lifecycle's gates. */
  async function offer(sets: string[][], state: OfferState = "active"): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    for (const itemIds of sets) await addOfferSet(userId, offerId, itemIds);
    await prisma.offer.update({ where: { id: offerId }, data: { state } });
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

  async function offerRow(offerId: string) {
    return prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: {
        state: true,
        platformId: true,
        closedAt: true,
        listingContentChangedAt: true,
        sets: {
          select: { items: { select: { itemId: true }, orderBy: { sortOrder: "asc" } } },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  }

  /** Everything a refused commit must leave exactly as it was. */
  async function snapshot() {
    return {
      offers: await prisma.offer.findMany({
        where: { collectionId },
        select: { id: true, state: true, listingContentChangedAt: true },
        orderBy: { id: "asc" },
      }),
      sets: await prisma.offerSet.count({ where: { offer: { collectionId } } }),
    };
  }

  before(async () => {
    userId = `test-user-compose-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User compose-${ts}`,
        email: `test-compose-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-compose-${ts}`, name: "Compose", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("#754's use case: one new Preparing offer with the five copies, the three singles withdrawn", async () => {
    const ids = await stamps(5);
    const setId = await checklist(ids);
    const copies = [await copy(ids[0]), await copy(ids[1]), await copy(ids[2]), await copy(ids[3]), await copy(ids[4])];
    const singles = [
      await offer([[copies[0]]], "active"),
      await offer([[copies[1]]], "paused"),
      await offer([[copies[2]]], "preparing"),
    ];
    assert.ok((await findSeriesRecombinations(userId, collectionId, platformId)).series.some((s) => s.checklistId === setId));

    const result = await composeSeriesOffer(userId, collectionId, {
      platformId,
      checklistId: setId,
      picks: Object.fromEntries(ids.map((stampId, i) => [stampId, copies[i]])),
    });

    const created = await offerRow(result.offerId);
    assert.equal(created.state, "preparing");
    assert.equal(created.platformId, platformId);
    assert.equal(created.sets.length, 1, "one set: a series is one sellable unit");
    assert.deepEqual(
      created.sets[0].items.map((item) => item.itemId).sort(),
      [...copies].sort(),
      "the set holds all five copies"
    );
    for (const singleId of singles) {
      const single = await offerRow(singleId);
      assert.equal(single.sets.length, 0, "the single lost its set");
      assert.equal(single.state, "withdrawn", "and, being empty, is withdrawn");
      assert.ok(single.closedAt, "closed as a withdrawal by hand is");
    }
    assert.deepEqual(
      { copies: result.copies, withdrawn: result.withdrawnOffers, live: result.withdrawnLiveOffers },
      { copies: 5, withdrawn: 3, live: 2 }
    );
  });

  it("leaves a single offer's other sets and its state; a live one is flagged as changed (#542)", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    const [first, second] = [await copy(ids[0]), await copy(ids[1])];
    const keptLive = await copy((await stamps(1))[0]);
    const keptDraft = await copy((await stamps(1))[0]);
    const live = await offer([[first], [keptLive]], "active");
    const draft = await offer([[second], [keptDraft]], "preparing");

    const result = await composeSeriesOffer(userId, collectionId, {
      platformId,
      checklistId: setId,
      picks: { [ids[0]]: first, [ids[1]]: second },
    });

    const liveRow = await offerRow(live);
    assert.equal(liveRow.state, "active");
    assert.deepEqual(liveRow.sets.map((set) => set.items.map((item) => item.itemId)), [[keptLive]]);
    assert.ok(liveRow.listingContentChangedAt, "a live offer that lost a set is flagged");

    const draftRow = await offerRow(draft);
    assert.equal(draftRow.state, "preparing");
    assert.deepEqual(draftRow.sets.map((set) => set.items.map((item) => item.itemId)), [[keptDraft]]);
    assert.equal(draftRow.listingContentChangedAt, null, "a draft has no listing to fall out of step");

    assert.deepEqual(
      { withdrawn: result.withdrawnOffers, changedLive: result.changedLiveOffers },
      { withdrawn: 0, changedLive: 1 }
    );
  });

  it("composes the copy the collector picked where a slot had several candidates", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    const availableFirst = await copy(ids[0]);
    const singleFirst = await copy(ids[0]);
    const holding = await offer([[singleFirst]], "active");
    const second = await copy(ids[1]);
    const secondOffer = await offer([[second]], "ready");

    const result = await composeSeriesOffer(userId, collectionId, {
      platformId,
      checklistId: setId,
      picks: { [ids[0]]: singleFirst, [ids[1]]: second },
    });

    const created = await offerRow(result.offerId);
    assert.deepEqual(
      created.sets[0].items.map((item) => item.itemId).sort(),
      [singleFirst, second].sort(),
      "the picked single, not the available copy"
    );
    assert.equal((await offerRow(holding)).state, "withdrawn");
    assert.equal((await offerRow(secondOffer)).state, "withdrawn");
    assert.equal(
      await prisma.offerSetItem.count({ where: { itemId: availableFirst } }),
      0,
      "the copy not picked is left alone"
    );
  });

  it("leaves a single's offer untouched when the available copy is picked instead", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    const availableFirst = await copy(ids[0]);
    const holding = await offer([[await copy(ids[0])]], "active");
    const second = await copy(ids[1]);
    await offer([[second]], "active");

    await composeSeriesOffer(userId, collectionId, {
      platformId,
      checklistId: setId,
      picks: { [ids[0]]: availableFirst, [ids[1]]: second },
    });

    const holdingRow = await offerRow(holding);
    assert.equal(holdingRow.state, "active");
    assert.equal(holdingRow.sets.length, 1);
    assert.equal(holdingRow.listingContentChangedAt, null);
  });

  it("refuses, naming the copy, when a chosen copy went into active bidding since — and writes nothing (#334)", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    const bid = await copy(ids[0]);
    const bidOffer = await offer([[bid]], "active");
    const second = await copy(ids[1]);
    await offer([[second]], "preparing");
    // The screen was opened with the series listed…
    assert.ok((await findSeriesRecombinations(userId, collectionId, platformId)).series.some((s) => s.checklistId === setId));
    // …and then a bid arrived.
    await prisma.offer.update({ where: { id: bidOffer }, data: { inActiveBidding: true } });
    const itemNo = (await prisma.item.findUniqueOrThrow({ where: { id: bid }, select: { itemNo: true } })).itemNo;

    const before = await snapshot();
    await assert.rejects(
      composeSeriesOffer(userId, collectionId, {
        platformId,
        checklistId: setId,
        picks: { [ids[0]]: bid, [ids[1]]: second },
      }),
      (error: Error) => error.message.includes(formatItemNo(itemNo)) && /Nothing was changed/.test(error.message)
    );
    assert.deepEqual(await snapshot(), before, "no offer created, no set taken out, no state changed");
  });

  it("refuses a slot left without a chosen copy, and writes nothing", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    const first = await copy(ids[0]);
    await copy(ids[1]);
    await copy(ids[1]);
    await offer([[first]], "active");

    const before = await snapshot();
    await assert.rejects(
      composeSeriesOffer(userId, collectionId, { platformId, checklistId: setId, picks: { [ids[0]]: first } }),
      /Choose which copy fills/
    );
    assert.deepEqual(await snapshot(), before);
  });
});
