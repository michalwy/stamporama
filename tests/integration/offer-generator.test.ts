import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer } from "../../src/lib/offers";
import {
  commitOfferGeneration,
  previewOfferGeneration,
  type GeneratorInput,
} from "../../src/lib/offer-generator";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";
import type { OfferState } from "../../src/lib/offer-rules";
import { formatItemNo } from "../../src/lib/item-number";

// Generating offers in bulk from the Copies list (#1287): the read and the write the pure rules cannot
// see. That *available* is the bulk-lot builder's reading of the database and the rest is counted by
// reason; that an existing offer is found by #732's members and receives the sets in the same
// transaction as the new offers, flagged when listed; and that a plan gone stale writes nothing. Each
// case builds stamps of its own and passes its own copies, so the cases never see each other.

const ts = Date.now();

describe("offer generator (#1287)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let platformId: string;
  let otherPlatformId: string;
  let mnhId: string;
  let usedId: string;
  let nextIssueNo = 9900;
  let nextStamp = 0;

  async function stamps(count: number, opts: { areaId?: string } = {}): Promise<string[]> {
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
              stampAreaLinks: { create: [{ collectionAreaId: opts.areaId ?? areaId, isPrimary: true }] },
            },
          })
        ).id
      );
    }
    return ids;
  }

  /** A for-sale MNH copy in hand, unless told otherwise. */
  async function copy(
    stampId: string,
    opts: { conditionId?: string; forSale?: boolean; deliveryState?: string } = {}
  ): Promise<string> {
    return (
      await createItem(userId, collectionId, {
        stampId,
        conditionId: opts.conditionId ?? mnhId,
        forSale: opts.forSale ?? true,
        deliveryState: opts.deliveryState ?? "delivered",
      })
    ).id;
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
          name: `Set ${nextIssueNo}`,
          stamps: { create: stampIds.map((stampId, sortOrder) => ({ stampId, sortOrder })) },
        },
      })
    ).id;
  }

  /** An offer holding the given sets, put straight into its state. */
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

  function ticked(itemIds: string[], extra: Partial<GeneratorInput> = {}): GeneratorInput {
    return {
      platformId,
      state: "preparing",
      mode: "checklists",
      packaging: "multi",
      itemIds,
      filters: {},
      targets: {},
      ...extra,
    };
  }

  async function offersHolding(itemIds: string[]) {
    return prisma.offer.findMany({
      where: { collectionId, sets: { some: { items: { some: { itemId: { in: itemIds } } } } } },
      select: {
        id: true,
        state: true,
        price: true,
        url: true,
        listingContentChangedAt: true,
        sets: { select: { items: { select: { itemId: true } } }, orderBy: { sortOrder: "asc" } },
      },
    });
  }

  before(async () => {
    userId = `test-user-generator-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User generator-${ts}`,
        email: `test-generator-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-generator-${ts}`, name: "Generator", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 } })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Colnect", platform: true, platformCurrency: "EUR" } })
    ).id;
    otherPlatformId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" } })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("packs two complete sets as one multi-quantity offer, and leaves the extra copy for singles", async () => {
    const [s1, s2] = await stamps(2);
    await checklist([s1, s2]);
    const a1 = await copy(s1);
    const a2 = await copy(s2);
    const b1 = await copy(s1);
    const b2 = await copy(s2);
    const extra = await copy(s1);
    const copies = [a1, a2, b1, b2, extra];

    const preview = await previewOfferGeneration(userId, collectionId, ticked(copies));
    assert.equal(preview.lines.length, 1);
    assert.equal(preview.lines[0].kind, "series");
    assert.equal(preview.lines[0].sets.length, 2);
    assert.deepEqual(preview.lines[0].target, { kind: "new" });
    assert.equal(preview.otherModeCopies, 1);
    assert.deepEqual(preview.totals, { newOffers: 1, changedOffers: 0, sets: 2, copies: 4 });
    assert.equal(preview.creationBlock, null);

    const result = await commitOfferGeneration(userId, collectionId, ticked(copies), preview.fingerprint);
    assert.deepEqual(result, { createdOffers: 1, changedOffers: 0, sets: 2, copies: 4 });
    const [created] = await offersHolding([a1]);
    assert.equal(created.state, "preparing");
    assert.equal(created.price.toFixed(2), "0.00", "no asking price, as quick offer mode");
    assert.equal(created.url, null);
    assert.deepEqual(
      created.sets.map((set) => set.items.map((i) => i.itemId).sort()),
      [[a1, a2].sort(), [b1, b2].sort()]
    );

    const singles = await previewOfferGeneration(userId, collectionId, ticked(copies, { mode: "singles" }));
    assert.equal(singles.lines.length, 1, "only the copy left out of the sets");
    assert.deepEqual(singles.skipped, [{ reason: "offered", label: singles.skipped[0]?.label, count: 4 }]);
  });

  it("makes an offer per set with separate packaging", async () => {
    const [s1, s2] = await stamps(2);
    await checklist([s1, s2]);
    const copies = [await copy(s1), await copy(s2), await copy(s1), await copy(s2)];
    const input = ticked(copies, { packaging: "separate" });
    const preview = await previewOfferGeneration(userId, collectionId, input);
    assert.equal(preview.lines.length, 2);
    await commitOfferGeneration(userId, collectionId, input, preview.fingerprint);
    assert.equal((await offersHolding(copies)).length, 2);
  });

  it("forms no set from a checklist only mixed conditions complete, nor from one of a single stamp", async () => {
    const [s1, s2, lone] = await stamps(3);
    await checklist([s1, s2]);
    await checklist([lone]);
    const copies = [await copy(s1), await copy(s2, { conditionId: usedId }), await copy(lone)];
    const series = await previewOfferGeneration(userId, collectionId, ticked(copies));
    assert.equal(series.lines.length, 0);
    const singles = await previewOfferGeneration(userId, collectionId, ticked(copies, { mode: "singles" }));
    assert.equal(singles.lines.length, 3);
  });

  it("adds a matching set to a listed offer with multi-quantity and flags it (#542) — and not with separate offers", async () => {
    const [s1, s2] = await stamps(2);
    await checklist([s1, s2]);
    const listedId = await offer([[await copy(s1), await copy(s2)]], { state: "active" });

    const separateCopies = [await copy(s1), await copy(s2)];
    const separate = await previewOfferGeneration(userId, collectionId, ticked(separateCopies, { packaging: "separate" }));
    assert.deepEqual(separate.lines[0].target, { kind: "new" }, "separate offers ignore the similar offer");

    const preview = await previewOfferGeneration(userId, collectionId, ticked(separateCopies));
    assert.deepEqual(preview.lines[0].target, { kind: "existing", offerId: listedId });
    assert.equal(preview.lines[0].resultingSetCount, 2);
    await commitOfferGeneration(userId, collectionId, ticked(separateCopies), preview.fingerprint);

    const [listed] = await offersHolding(separateCopies);
    assert.equal(listed.id, listedId, "no new offer: the sets went to the existing one");
    assert.equal(listed.sets.length, 2);
    assert.ok(listed.listingContentChangedAt, "a listed offer receiving sets is flagged as changed after listing");
  });

  it("never adds to an offer in active bidding and makes a new offer instead (#334)", async () => {
    const [s1] = await stamps(1);
    const biddingId = await offer([[await copy(s1)]], { state: "active", inActiveBidding: true });
    const single = await copy(s1);
    const preview = await previewOfferGeneration(userId, collectionId, ticked([single], { mode: "singles" }));
    assert.deepEqual(preview.lines[0].target, { kind: "new" });
    assert.deepEqual(preview.lines[0].biddingMatches.map((o) => o.offerId), [biddingId]);
    await commitOfferGeneration(userId, collectionId, ticked([single], { mode: "singles" }), preview.fingerprint);
    const holding = await offersHolding([single]);
    assert.equal(holding.length, 1);
    assert.notEqual(holding[0].id, biddingId);
    assert.equal(await prisma.offerSet.count({ where: { offerId: biddingId } }), 1, "the offer under bid is untouched");
  });

  it("counts the copies it skips, by reason", async () => {
    const [s1] = await stamps(1);
    const notForSale = await copy(s1, { forSale: false });
    const ordered = await copy(s1, { deliveryState: "ordered" });
    const setAside = await copy(s1);
    await prisma.itemPlatformExclusion.create({ data: { itemId: setAside, platformId } });
    const offered = await copy(s1);
    await offer([[offered]], { state: "preparing" });
    const underBid = await copy(s1);
    await offer([[underBid]], { platformId: otherPlatformId, state: "active", inActiveBidding: true });
    const writtenOff = await copy(s1);
    await prisma.item.update({ where: { id: writtenOff }, data: { disposedAt: new Date() } });
    const available = await copy(s1);

    const preview = await previewOfferGeneration(
      userId,
      collectionId,
      ticked([notForSale, ordered, setAside, offered, underBid, writtenOff, available], { mode: "singles" })
    );
    assert.equal(preview.askedCopies, 7);
    assert.deepEqual(
      preview.skipped.map((entry) => [entry.reason, entry.count]),
      [["gone", 1], ["not-for-sale", 1], ["not-in-hand", 1], ["set-aside", 1], ["offered", 1], ["in-bidding", 1]]
    );
    assert.deepEqual(preview.lines.map((line) => line.sets), [[[await itemNo(available)]]]);
  });

  it("reads the list's own filters when nothing is ticked", async () => {
    const otherArea = (await prisma.collectionArea.create({ data: { collectionId, name: "Filtered" } })).id;
    const [inside] = await stamps(1, { areaId: otherArea });
    const [outside] = await stamps(1);
    const wanted = await copy(inside);
    await copy(outside);
    const preview = await previewOfferGeneration(userId, collectionId, {
      ...ticked([], { mode: "singles" }),
      itemIds: null,
      filters: readItemFilters(new URLSearchParams(`areaIds=${otherArea}`)),
    });
    assert.equal(preview.askedCopies, 1);
    assert.deepEqual(preview.lines.map((line) => line.sets), [[[await itemNo(wanted)]]]);
  });

  it("refuses a plan gone stale, naming the copy, and writes nothing", async () => {
    const [s1, s2] = await stamps(2);
    const first = await copy(s1);
    const second = await copy(s2);
    const input = ticked([first, second], { mode: "singles" });
    const preview = await previewOfferGeneration(userId, collectionId, input);
    assert.equal(preview.lines.length, 2);

    await offer([[second]], { state: "preparing" });
    const named = `Copy ${formatItemNo(await itemNo(second))} has changed`;
    await assert.rejects(
      commitOfferGeneration(userId, collectionId, input, preview.fingerprint),
      (e: Error) => e.message.startsWith(named)
    );
    assert.equal((await offersHolding([first])).length, 0, "nothing was created for the copy still available");
  });

  it("refuses when the offer due to receive sets changed state, and writes nothing", async () => {
    const [s1] = await stamps(1);
    const targetId = await offer([[await copy(s1)]], { state: "active" });
    const single = await copy(s1);
    const input = ticked([single], { mode: "singles" });
    const preview = await previewOfferGeneration(userId, collectionId, input);
    assert.deepEqual(preview.lines[0].target, { kind: "existing", offerId: targetId });

    await prisma.offer.update({ where: { id: targetId }, data: { state: "paused" } });
    await assert.rejects(commitOfferGeneration(userId, collectionId, input, preview.fingerprint), /Offer #\d+ has changed/);
    assert.equal((await offersHolding([single])).length, 0);
  });

  it("creates nothing at all when the status cannot be started without a price", async () => {
    const [s1, s2] = await stamps(2);
    const copies = [await copy(s1), await copy(s2)];
    const input = ticked(copies, { mode: "singles", state: "ready" });
    const preview = await previewOfferGeneration(userId, collectionId, input);
    assert.ok(preview.creationBlock, "the preview says so before anything is confirmed");
    await assert.rejects(commitOfferGeneration(userId, collectionId, input, preview.fingerprint));
    assert.equal((await offersHolding(copies)).length, 0);
  });

  async function itemNo(itemId: string): Promise<number> {
    return (await prisma.item.findUniqueOrThrow({ where: { id: itemId }, select: { itemNo: true } })).itemNo;
  }
});
