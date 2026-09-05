import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import { createTrade } from "../../src/lib/trades";
import {
  buildLotProposal,
  commitLotProposal,
  getLotPoolSummary,
} from "../../src/lib/lot-builder";
import type { LotBuilderCriteria, LotBuilderRequest } from "../../src/lib/lot-builder-criteria";
import type { OfferState } from "../../src/lib/offer-rules";

// The bulk-lot builder's server half (#759): the candidate pool, the readout over the same `where`,
// the proposal, and the commit.
//
// What is pinned here is everything the pure rules (#758) cannot see. That the pool is the
// `notOfferedPlatformId` branch **whole** — all four availability clauses, and a copy promised in an
// agreed trade deliberately still in it (#639). That the summary and the pool answer over one set.
// That the proposal re-reads rather than trusting a client, and the commit re-plans rather than
// being handed a plan (#717) — the one behaviour a unit test cannot reach, since it is about the
// database changing under an open wizard. And that the offer that comes out is an ordinary
// `preparing` offer with **one** set, in the picked order (ADR-0013 §2, #306).

const ts = Date.now();

describe("the bulk-lot builder's pool, proposal and commit (#759)", () => {
  let userId: string;
  let collectionId: string;
  let editionId: string;
  let platformId: string;
  let otherPlatformId: string;
  let partnerId: string;
  let mnhId: string;
  let usedId: string;
  let variantSubtypeId: string;
  /** Three sibling areas under one root, so each concern draws on a pool of its own. */
  let rootAreaId: string;
  let poolAreaId: string;
  let pickAreaId: string;
  let commitAreaId: string;

  let nextIssueNo = 9700;

  async function area(name: string, parentId: string | null, catalogNameId: string) {
    return (
      await prisma.collectionArea.create({
        data: { collectionId, name, parentId, primaryCatalogNameId: catalogNameId },
      })
    ).id;
  }

  interface StampSpec {
    year?: number | null;
    price?: string | null;
    parentId?: string;
    subtypeId?: string;
  }

  async function stamp(areaId: string, name: string, spec: StampSpec = {}): Promise<string> {
    const row = await prisma.stamp.create({
      data: {
        collectionId,
        name,
        issuedYear: spec.year === undefined ? 1955 : spec.year,
        parentId: spec.parentId,
        subtypeId: spec.subtypeId,
        stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
      },
    });
    if (spec.price) {
      await prisma.stampCatalogPrice.create({
        data: {
          stampId: row.id,
          catalogEditionId: editionId,
          conditionId: mnhId,
          certificateStatusId: null,
          formatId: null,
          price: spec.price,
          currency: "EUR",
        },
      });
    }
    return row.id;
  }

  /** One for-sale copy in hand — the state every availability clause is measured against. */
  async function copy(
    stampId: string,
    opts: { conditionId?: string; deliveryState?: string; forSale?: boolean } = {}
  ): Promise<string> {
    const item = await createItem(userId, collectionId, {
      stampId,
      conditionId: opts.conditionId ?? mnhId,
      forSale: opts.forSale ?? true,
      deliveryState: opts.deliveryState ?? "delivered",
    });
    return item.id;
  }

  /** An offer on a platform holding one copy, left in the given state. */
  async function offerHolding(
    itemId: string,
    opts: { platformId?: string; state?: "preparing" | "ready" | "active" | "withdrawn" } = {}
  ): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId: opts.platformId ?? platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [itemId]);
    if (opts.state && opts.state !== "preparing") {
      for (const step of stepsTo(opts.state)) await setOfferState(userId, offerId, step);
    }
    return offerId;
  }

  /** The offer graph is stepped through, never jumped (#188). */
  function stepsTo(state: OfferState): OfferState[] {
    if (state === "ready") return ["ready"];
    if (state === "active") return ["ready", "active"];
    if (state === "withdrawn") return ["withdrawn"];
    return [];
  }

  function criteria(overrides: Partial<LotBuilderCriteria> = {}): LotBuilderCriteria {
    return {
      platformId,
      areaId: null,
    areaSubtree: true,
      yearFrom: null,
      yearTo: null,
      conditionIds: [],
      formatIds: [],
      maxCatalogValue: null,
      countMin: null,
      countMax: null,
      valueMin: null,
      valueMax: null,
      series: "neutral",
      maxPerStamp: null,
      duplicates: "neutral",
    nameTemplate: null,
    descriptionTemplate: null,
      ...overrides,
    };
  }

  function request(
    overrides: Omit<Partial<LotBuilderRequest>, "criteria"> & {
      criteria?: Partial<LotBuilderCriteria>;
    } = {}
  ): LotBuilderRequest {
    const { criteria: criteriaOverrides, ...rest } = overrides;
    return {
      criteria: criteria(criteriaOverrides),
      seed: "seed-1",
      pinnedItemIds: [],
      rejectedItemIds: [],
      ...rest,
    };
  }

  const poolIds = async (over: Partial<LotBuilderCriteria>) =>
    new Set(
      (
        await buildLotProposal(
          userId,
          collectionId,
          // No target, no cap, every copy pinned to nothing: the plan reports the pool by picking
          // nothing, so the pool itself is read through the summary. Ids come from a wide count
          // target instead, which takes everything the pool holds.
          request({ criteria: { ...over, countMin: 1000 } })
        )
      ).plan.itemIds
    );

  before(async () => {
    userId = `test-user-lotbuild-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User lotbuild-${ts}`,
        email: `test-lotbuild-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-lotbuild-${ts}`, name: "Lots", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Europa", currency: "EUR" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;

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
    variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: {
          collectionId,
          name: "Gum variety",
          actsAsVariant: true,
          isDefault: true,
          sortOrder: 0,
        },
      })
    ).id;

    rootAreaId = await area("Poland", null, catalogName.id);
    poolAreaId = await area("Availability", rootAreaId, catalogName.id);
    pickAreaId = await area("Picking", rootAreaId, catalogName.id);
    commitAreaId = await area("Committing", rootAreaId, catalogName.id);

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
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  // ── The candidate pool ────────────────────────────────────────────────────────────────────────

  describe("the pool is `notOfferedPlatformId` whole (#259/#334/#506)", () => {
    let free: string;
    let onThisPlatform: string;
    let onClosedOfferHere: string;
    let onAnotherPlatform: string;
    let biddingElsewhere: string;
    let notDelivered: string;
    let setAside: string;
    let notForSale: string;
    let promised: string;

    before(async () => {
      const s = async (name: string) => stamp(poolAreaId, name, { price: "2.00" });

      free = await copy(await s("Free"));
      onThisPlatform = await copy(await s("Listed here"));
      await offerHolding(onThisPlatform);
      onClosedOfferHere = await copy(await s("Withdrawn here"));
      await offerHolding(onClosedOfferHere, { state: "withdrawn" });
      onAnotherPlatform = await copy(await s("Listed elsewhere"));
      await offerHolding(onAnotherPlatform, { platformId: otherPlatformId });
      biddingElsewhere = await copy(await s("Under bid elsewhere"));
      const bidding = await offerHolding(biddingElsewhere, {
        platformId: otherPlatformId,
        state: "active",
      });
      await prisma.offer.update({ where: { id: bidding }, data: { inActiveBidding: true } });
      notDelivered = await copy(await s("Never arrived"), { deliveryState: "not_delivered" });
      setAside = await copy(await s("Set aside"));
      await prisma.itemPlatformExclusion.create({
        data: { itemId: setAside, platformId },
      });
      notForSale = await copy(await s("Not for sale"), { forSale: false });

      promised = await copy(await s("Promised"));
      const trade = await createTrade(userId, collectionId, { partnerId, currency: "EUR" });
      await prisma.tradeLine.create({
        data: {
          tradeId: trade.id,
          sectionId: trade.sections[0].id,
          side: "give",
          itemId: promised,
        },
      });
      await prisma.trade.update({ where: { id: trade.id }, data: { status: "agreed" } });
    });

    it("keeps a copy nothing has claimed, and one whose offer here is closed", async () => {
      const ids = await poolIds({ areaId: poolAreaId });
      assert.ok(ids.has(free), "a free copy is in the pool");
      assert.ok(ids.has(onClosedOfferHere), "a withdrawn offer releases its copy (#259)");
    });

    it("keeps a copy listed on another platform — multi-platform listing is expected (#165)", async () => {
      const ids = await poolIds({ areaId: poolAreaId });
      assert.ok(ids.has(onAnotherPlatform));
    });

    it("drops a copy already on a non-terminal offer here, and one under bid anywhere", async () => {
      const ids = await poolIds({ areaId: poolAreaId });
      assert.equal(ids.has(onThisPlatform), false, "#259");
      assert.equal(ids.has(biddingElsewhere), false, "a bid commits the copy everywhere (#334)");
    });

    it("drops a copy that never arrived, one set aside for this platform, and one not for sale", async () => {
      const ids = await poolIds({ areaId: poolAreaId });
      assert.equal(ids.has(notDelivered), false, "not in hand");
      assert.equal(ids.has(setAside), false, "#506");
      assert.equal(ids.has(notForSale), false, "`notOfferedPlatformId` implies `forSale`");
    });

    it("keeps a copy promised in an agreed trade, and reports it instead (#639)", async () => {
      const proposal = await buildLotProposal(
        userId,
        collectionId,
        request({ criteria: { areaId: poolAreaId, countMin: 1000 } })
      );
      assert.ok(proposal.plan.itemIds.includes(promised), "a draft competes for nothing");
      assert.deepEqual(
        proposal.tradeCommitments.map((c) => c.itemId),
        [promised],
        "and the proposal names it, as the offer screen does at every state"
      );
    });
  });

  // ── The readout ───────────────────────────────────────────────────────────────────────────────

  describe("the pool summary answers over the same `where` as the pool", () => {
    let base: string;
    let variant: string;
    let seriesIds: string[];

    before(async () => {
      // `226` and its variant child: two copies of one *thing*, whatever the pile is counted by.
      base = await stamp(pickAreaId, "226", { price: "3.00", year: 1955 });
      variant = await stamp(pickAreaId, "226y", {
        price: "3.00",
        year: 1955,
        parentId: base,
        subtypeId: variantSubtypeId,
      });
      await copy(base);
      await copy(base);
      await copy(variant);

      // A two-slot series the pool can assemble whole, one of whose stamps is unpriced.
      seriesIds = [
        await stamp(pickAreaId, "300", { price: "4.00", year: 1960 }),
        await stamp(pickAreaId, "301", { price: null, year: 1960 }),
      ];
      for (const id of seriesIds) await copy(id);

      // Outside the year span the picking tests use, so it only ever shows up unfiltered.
      await copy(await stamp(pickAreaId, "900", { price: "1.00", year: 1975 }));

      const issue = await prisma.issue.create({
        data: {
          collectionId,
          issueNo: ++nextIssueNo,
          collectionAreaId: pickAreaId,
          name: "Numerals",
          year: 1960,
        },
      });
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId: issue.id,
          name: "Complete set",
          stamps: { create: seriesIds.map((stampId) => ({ stampId })) },
        },
      });
    });

    it("counts copies, rolls duplicates up through variants, and names the unpriced", async () => {
      const summary = await getLotPoolSummary(userId, collectionId, criteria({ areaId: pickAreaId }));
      assert.equal(summary.copies, 6);
      // `226` ×2 + `226y` ×1 is **one** pile (#758's `duplicateKey`), plus `300`, `301` and `900`.
      assert.equal(summary.stamps, 4);
      assert.equal(summary.unpricedCopies, 1, "the `301` copy carries no price");
      assert.equal(summary.catalogValue, 3 + 3 + 3 + 4 + 1);
      assert.equal(summary.baseCurrency, "EUR");
    });

    it("counts the checklists the pool can assemble whole (#661)", async () => {
      const summary = await getLotPoolSummary(userId, collectionId, criteria({ areaId: pickAreaId }));
      assert.equal(summary.completeChecklists, 1);
    });

    it("states the exact ceiling the duplicate cap leaves, not an estimate", async () => {
      const capped = await getLotPoolSummary(
        userId,
        collectionId,
        criteria({ areaId: pickAreaId, maxPerStamp: 1 })
      );
      // Σ min(pile, 1): the three-deep `226` pile contributes one, the three singles one each.
      assert.equal(capped.capBoundedCapacity, 4);
      const uncapped = await getLotPoolSummary(
        userId,
        collectionId,
        criteria({ areaId: pickAreaId })
      );
      assert.equal(uncapped.capBoundedCapacity, uncapped.copies);
    });

    it("narrows by the year span, the condition and the area subtree", async () => {
      const span = await getLotPoolSummary(
        userId,
        collectionId,
        criteria({ areaId: pickAreaId, yearFrom: 1958, yearTo: 1965 })
      );
      assert.equal(span.copies, 2, "only the 1960 series");

      const used = await getLotPoolSummary(
        userId,
        collectionId,
        criteria({ areaId: pickAreaId, conditionIds: [usedId] })
      );
      assert.equal(used.copies, 0, "every copy here is MNH");

      const root = await getLotPoolSummary(userId, collectionId, criteria({ areaId: rootAreaId }));
      assert.ok(root.copies > span.copies, "the root reads its whole subtree");

      // The rail's *this area only* toggle (#385) is a criterion here rather than a resolved list of
      // ids, because the commit re-plans from the query string alone (#717). Without it the control
      // was drawn on this screen and changed nothing.
      const rootAlone = await getLotPoolSummary(
        userId,
        collectionId,
        criteria({ areaId: rootAreaId, areaSubtree: false })
      );
      assert.ok(
        rootAlone.copies < root.copies,
        "narrowed to the area alone, the pool drops its sub-areas"
      );
    });

    // #773: a lot is counted into an envelope now, so the pool takes only what has arrived — unlike
    // the shared *not offered on X* worklist, which keeps the in-flight states because a listing can
    // be written ahead of a parcel.
    it("takes only copies that are in hand", async () => {
      const before = await getLotPoolSummary(userId, collectionId, criteria({ areaId: poolAreaId }));
      const stampId = await stamp(poolAreaId, `In transit ${ts}`, { price: "1.00" });
      const inTransit = await createItem(userId, collectionId, {
        stampId,
        conditionId: mnhId,
        forSale: true,
        deliveryState: "in_transit",
      });
      const after = await getLotPoolSummary(userId, collectionId, criteria({ areaId: poolAreaId }));
      assert.equal(after.copies, before.copies, "a copy still in the post is not in the pool");

      await prisma.item.update({ where: { id: inTransit.id }, data: { deliveryState: "delivered" } });
      const delivered = await getLotPoolSummary(userId, collectionId, criteria({ areaId: poolAreaId }));
      assert.equal(delivered.copies, before.copies + 1, "and is the moment it arrives");
    });

    it("agrees with the pool the proposal is picked from", async () => {
      const proposal = await buildLotProposal(
        userId,
        collectionId,
        request({ criteria: { areaId: pickAreaId } })
      );
      const summary = await getLotPoolSummary(userId, collectionId, criteria({ areaId: pickAreaId }));
      assert.deepEqual(proposal.summary, summary);
    });
  });

  // ── The proposal ──────────────────────────────────────────────────────────────────────────────

  describe("the proposal", () => {
    it("is reproducible under a seed, and re-rolls under a new one", async () => {
      const ask = (seed: string) =>
        buildLotProposal(
          userId,
          collectionId,
          request({ seed, criteria: { areaId: pickAreaId, countMin: 2 } })
        );
      const first = await ask("seed-a");
      assert.deepEqual((await ask("seed-a")).plan.itemIds, first.plan.itemIds);
      // Not an assertion about *which* copies a re-roll takes — only that the seed is what decides.
      const rolled = await ask("seed-b");
      assert.equal(rolled.plan.itemIds.length, first.plan.itemIds.length);
    });

    it("takes the pins first and enriches the picked copies in pick order", async () => {
      const pinned = (
        await buildLotProposal(
          userId,
          collectionId,
          request({ criteria: { areaId: pickAreaId, countMin: 100 } })
        )
      ).plan.itemIds.slice(-2);
      const proposal = await buildLotProposal(
        userId,
        collectionId,
        request({ criteria: { areaId: pickAreaId, countMin: 3 }, pinnedItemIds: pinned })
      );
      assert.deepEqual(proposal.plan.itemIds.slice(0, 2), pinned);
      assert.deepEqual(
        proposal.copies.map((c) => c.id),
        proposal.plan.itemIds,
        "the display read keeps the order the pick chose (#306)"
      );
    });

    it("suggests texts from the criteria and the copies actually picked", async () => {
      const proposal = await buildLotProposal(
        userId,
        collectionId,
        request({
          criteria: {
            areaId: pickAreaId,
            yearFrom: 1958,
            yearTo: 1965,
            conditionIds: [mnhId],
            countMin: 1,
            series: "preferComplete",
          },
        })
      );
      // The series is atomic, so a target of one lands at two — and the title says two.
      assert.equal(proposal.plan.itemIds.length, 2);
      assert.equal(proposal.suggested.name, "Picking 1958–1965, 2 stamps");
      assert.match(proposal.suggested.description, /2 different stamps, including 1 complete set\./);
      assert.match(proposal.suggested.description, /Conditions: Mint Never Hinged\./);
      assert.equal(
        /catalogue|catalog/i.test(proposal.suggested.description),
        false,
        "no value claim in a text that is frozen the moment it is stored"
      );
    });

    it("names a pinned copy the pool no longer holds rather than releasing it (#314)", async () => {
      const spare = await copy(await stamp(pickAreaId, "Pinned then listed", { price: "2.00" }));
      await offerHolding(spare);
      const proposal = await buildLotProposal(
        userId,
        collectionId,
        request({ criteria: { areaId: pickAreaId, countMin: 1 }, pinnedItemIds: [spare] })
      );
      assert.equal(proposal.plan.itemIds.includes(spare), false);
      assert.deepEqual(
        proposal.missingPinned.map((m) => m.itemId),
        [spare]
      );
      assert.equal(proposal.missingPinned[0].stampName, "Pinned then listed");
    });
  });

  // ── The commit ────────────────────────────────────────────────────────────────────────────────

  describe("the commit", () => {
    let commitStamps: string[];

    before(async () => {
      commitStamps = [];
      // Generous on purpose: each test below commits, and a committed lot's copies leave the pool.
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
        const id = await stamp(commitAreaId, `Lot ${n}`, { price: "2.00", year: 1955 });
        commitStamps.push(id);
        await copy(id);
      }
    });

    const setsOf = (offerId: string) =>
      prisma.offerSet.findMany({
        where: { offerId },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          items: { orderBy: { itemId: "asc" }, select: { itemId: true, sortOrder: true } },
        },
      });

    it("creates a preparing offer holding one set, in the picked order", async () => {
      const ask = request({ criteria: { areaId: commitAreaId, countMin: 3 } });
      const proposal = await buildLotProposal(userId, collectionId, ask);
      const result = await commitLotProposal(userId, collectionId, {
        ...ask,
        name: null,
        description: null,
      });

      const offer = await prisma.offer.findUniqueOrThrow({
        where: { id: result.offerId },
        select: { state: true, platformId: true, nameEdited: true, descriptionEdited: true },
      });
      assert.equal(offer.state, "preparing");
      assert.equal(offer.platformId, platformId);
      assert.equal(offer.nameEdited, false, "a blank title leaves the platform's template alone");
      assert.equal(offer.descriptionEdited, false);

      const sets = await setsOf(result.offerId);
      assert.equal(sets.length, 1, "a bulk lot is one indivisible thing (ADR-0013 §2)");
      assert.equal(result.copies, 3);
      assert.deepEqual(
        sets[0].items.map((i) => i.itemId).sort(),
        [...proposal.plan.itemIds].sort(),
        "holding exactly what the pick chose"
      );
      // Within the set the copies start **derived** — catalog order, as on every other seeded offer
      // (#306). A seeded shuffle is nobody's hand-correction, and writing it as one would freeze a
      // random order over the catalog's.
      assert.deepEqual(
        sets[0].items.map((i) => i.sortOrder),
        [null, null, null]
      );
    });

    it("stores the wizard's texts as the collector's own, off the template (#380)", async () => {
      const ask = request({ seed: "texts", criteria: { areaId: commitAreaId, countMin: 1 } });
      const result = await commitLotProposal(userId, collectionId, {
        ...ask,
        name: "Poland 1955, 1 stamp",
        description: "Bulk lot of 1 stamp from Poland.",
      });
      const offer = await prisma.offer.findUniqueOrThrow({
        where: { id: result.offerId },
        select: { name: true, description: true, nameEdited: true, descriptionEdited: true },
      });
      assert.equal(offer.name, "Poland 1955, 1 stamp");
      assert.equal(offer.description, "Bulk lot of 1 stamp from Poland.");
      // The flag means *do not regenerate this*, and regeneration is what produces a title past the
      // platform's cap (#403) — which since #636 blocks the way to `ready`.
      assert.equal(offer.nameEdited, true);
      assert.equal(offer.descriptionEdited, true);
    });

    it("re-plans rather than trusting the proposal the client is holding (#717)", async () => {
      const spare = await copy(await stamp(commitAreaId, "Taken in between", { price: "2.00" }));
      const ask = request({
        seed: "replan",
        criteria: { areaId: commitAreaId, countMin: 1 },
        pinnedItemIds: [spare],
      });
      const proposal = await buildLotProposal(userId, collectionId, ask);
      assert.ok(proposal.plan.itemIds.includes(spare), "the wizard saw it as listable");

      // …and while the wizard sat open, the copy went onto another listing here.
      await offerHolding(spare);

      const result = await commitLotProposal(userId, collectionId, {
        ...ask,
        name: null,
        description: null,
      });
      const [set] = await setsOf(result.offerId);
      assert.equal(
        set.items.some((i) => i.itemId === spare),
        false,
        "the commit re-read the pool"
      );
      assert.deepEqual(
        result.missingPinned.map((m) => m.itemId),
        [spare],
        "and says so rather than silently releasing the pin"
      );
    });

    it("drains the pool on its own — a committed lot's copies stop being listable here", async () => {
      const before = await getLotPoolSummary(
        userId,
        collectionId,
        criteria({ areaId: commitAreaId })
      );
      const ask = request({ seed: "drain", criteria: { areaId: commitAreaId, countMin: 1 } });
      const result = await commitLotProposal(userId, collectionId, {
        ...ask,
        name: null,
        description: null,
      });
      const after = await getLotPoolSummary(
        userId,
        collectionId,
        criteria({ areaId: commitAreaId })
      );
      assert.equal(after.copies, before.copies - result.copies, "with nothing stored to make it so");
    });

    it("refuses a lot that came out empty rather than creating a set-less draft", async () => {
      await assert.rejects(
        () =>
          commitLotProposal(userId, collectionId, {
            ...request({ criteria: { areaId: commitAreaId, conditionIds: [usedId], countMin: 5 } }),
            name: null,
            description: null,
          }),
        /came out empty/
      );
    });
  });
});
