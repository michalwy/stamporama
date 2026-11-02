import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer } from "../../src/lib/offers";
import { readListedElsewhere, readProposalLotsListedElsewhere, swapProposalLotCopy } from "../../src/lib/listed-elsewhere";
import { commitOfferGeneration, previewOfferGeneration, type GeneratorInput } from "../../src/lib/offer-generator";
import { addProposalLots, convertProposalToSale, createProposal, getDirectPlatform } from "../../src/lib/proposals";

// Making an offer from a copy already in an open offer elsewhere names that offer and suggests a twin
// listed nowhere (#2339): the same stamp, condition and format, held and for sale, in no open offer —
// an exact one on faults and certificate first, else one whose difference is named. Swap puts the twin
// in the copy's place: in what the generator plans, and in a proposal's lot before *Convert to sale…*.
// Each case makes stamps of its own, so the cases never meet.

const ts = Date.now();

describe("A copy listed elsewhere and its twin listed nowhere (#2339)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let mintId: string;
  let usedId: string;
  let certifiedId: string;
  let thinId: string;
  let directId: string;
  let facebookId: string;
  let groupId: string;
  let shopId: string;
  let nextStamp = 0;
  let clock = Date.parse("2026-01-01T00:00:00.000Z");

  async function stamp(): Promise<string> {
    nextStamp += 1;
    return (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp ${nextStamp}`,
          issuedYear: 1960,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      })
    ).id;
  }

  /** A copy of `stampId`, added a minute after the one before — the Copies list's order. */
  async function copy(
    stampId: string,
    opts: { conditionId?: string; certificateStatusId?: string; faultIds?: string[]; forSale?: boolean } = {}
  ): Promise<string> {
    const id = (
      await createItem(userId, collectionId, {
        stampId,
        conditionId: opts.conditionId ?? mintId,
        forSale: opts.forSale ?? true,
        deliveryState: "delivered",
      })
    ).id;
    clock += 60_000;
    await prisma.item.update({
      where: { id },
      data: {
        createdAt: new Date(clock),
        certificateStatusId: opts.certificateStatusId ?? null,
        faults: { create: (opts.faultIds ?? []).map((faultId) => ({ faultId })) },
      },
    });
    return id;
  }

  async function itemNo(id: string): Promise<number> {
    return (await prisma.item.findUniqueOrThrow({ where: { id }, select: { itemNo: true } })).itemNo;
  }

  /** A Preparing offer of `itemIds`, one set each, on `platformId`. */
  async function offer(platformId: string, itemIds: string[]): Promise<string> {
    return createOffer(
      userId,
      collectionId,
      {
        platformId,
        url: null,
        price: "5.00",
        startingPrice: null,
        currency: "EUR",
        listingDate: null,
        ...(platformId === facebookId ? { facebookGroupId: groupId, listingType: "fixed" as const } : {}),
      },
      { seedItemIds: itemIds, seedPerCopy: true }
    );
  }

  function ticked(itemIds: string[], extra: Partial<GeneratorInput> = {}): GeneratorInput {
    return {
      platformId: shopId,
      mode: "singles",
      packaging: "multi",
      itemIds,
      filters: {},
      targets: {},
      skip: [],
      facebook: { facebookGroupId: null, endsAt: null },
      ...extra,
    };
  }

  before(async () => {
    userId = `test-user-listed-elsewhere-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Test User",
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-listed-elsewhere-${ts}`, name: "Listed elsewhere", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    mintId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Mint", abbreviation: "MNH", sortOrder: 0 } })
    ).id;
    usedId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 } })
    ).id;
    certifiedId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Certificate", abbreviation: "Cert", sortOrder: 0 },
      })
    ).id;
    thinId = (await prisma.fault.create({ data: { collectionId, name: "Thin", sortOrder: 0 } })).id;
    directId = (await getDirectPlatform(collectionId)).id;
    facebookId = (
      await prisma.platform.update({
        where: { collectionId_platformModule: { collectionId, platformModule: "facebook" } },
        data: { enabled: true, platformCurrency: "EUR" },
      })
    ).id;
    groupId = (
      await prisma.facebookGroup.create({
        data: { collectionId, platformId: facebookId, name: "Stamps for sale", url: "https://www.facebook.com/groups/1" },
      })
    ).id;
    shopId = (await prisma.platform.create({ data: { collectionId, name: "Shop", platformCurrency: "EUR" } })).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("names the offer and suggests the first exact twin listed nowhere, passing over a closer one that differs", async () => {
    const s = await stamp();
    const listed = await copy(s);
    // Added before the exact twin, so first in the Copies list — but with a fault the listed copy lacks.
    await copy(s, { faultIds: [thinId] });
    // Not twins, and ahead of it too: another condition, not for sale, and one already in an open offer.
    await copy(s, { conditionId: usedId });
    await copy(s, { forSale: false });
    const elsewhere = await copy(s);
    await offer(shopId, [elsewhere]);
    const exact = await copy(s);
    const facebookOffer = await offer(facebookId, [listed]);
    const fresh = await copy(await stamp());

    const [entry, ...rest] = await readListedElsewhere(userId, collectionId, [fresh, listed], { platformId: directId });
    assert.equal(rest.length, 0, "a copy in no open offer is not named");
    const facebookNo = (await prisma.offer.findUniqueOrThrow({ where: { id: facebookOffer }, select: { offerNo: true } }))
      .offerNo;
    assert.deepEqual(entry!.offers, [{ offerId: facebookOffer, offerNo: facebookNo, platformName: "Facebook" }]);
    assert.deepEqual(entry!.twin, { itemId: exact, itemNo: await itemNo(exact), difference: null });
    assert.equal(entry!.twinRow?.id, exact, "the twin's row comes with it, for the dialog to list");

    // The offer the copy is being sold from is not *elsewhere*.
    assert.deepEqual(
      await readListedElsewhere(userId, collectionId, [listed], { exceptOfferIds: [facebookOffer] }),
      []
    );
  });

  it("suggests a twin that differs only when no exact one is free, and names the difference", async () => {
    const s = await stamp();
    const listed = await copy(s, { certificateStatusId: certifiedId });
    const thin = await copy(s, { certificateStatusId: certifiedId, faultIds: [thinId] });
    await offer(facebookId, [listed]);
    const [entry] = await readListedElsewhere(userId, collectionId, [listed]);
    assert.deepEqual(entry!.twin, { itemId: thin, itemNo: await itemNo(thin), difference: "with Thin" });

    const s2 = await stamp();
    const certified = await copy(s2, { certificateStatusId: certifiedId });
    await copy(s2);
    await offer(facebookId, [certified]);
    const [second] = await readListedElsewhere(userId, collectionId, [certified]);
    assert.equal(second!.twin?.difference, "no certificate");
  });

  it("gives each listed copy a twin of its own, never one being made, and only names a copy with none", async () => {
    const s = await stamp();
    const [a, b] = [await copy(s), await copy(s)];
    const [twinA, twinB] = [await copy(s), await copy(s)];
    await offer(facebookId, [a, b]);
    const entries = await readListedElsewhere(userId, collectionId, [a, b]);
    assert.deepEqual(
      entries.map((entry) => entry.twin?.itemId),
      [twinA, twinB]
    );
    // Both twins are among the copies being made, so neither can stand in.
    const made = await readListedElsewhere(userId, collectionId, [a, b, twinA, twinB]);
    assert.deepEqual(
      made.map((entry) => entry.twin),
      [null, null]
    );
  });

  it("leaves out a twin set aside as never to be listed on the offer's platform", async () => {
    const s = await stamp();
    const listed = await copy(s);
    const twin = await copy(s);
    await offer(facebookId, [listed]);
    await prisma.itemPlatformExclusion.create({ data: { itemId: twin, platformId: shopId } });
    const [onShop] = await readListedElsewhere(userId, collectionId, [listed], { platformId: shopId });
    assert.equal(onShop!.twin, null);
    const [onDirect] = await readListedElsewhere(userId, collectionId, [listed], { platformId: directId });
    assert.equal(onDirect!.twin?.itemId, twin);
  });

  it("names the plan's listed copies in the generator's preview, and a swap plans and makes the twin", async () => {
    const s = await stamp();
    const listed = await copy(s);
    const twin = await copy(s);
    await offer(facebookId, [listed]);

    const preview = await previewOfferGeneration(userId, collectionId, ticked([listed]));
    assert.equal(preview.listedElsewhere.length, 1);
    assert.equal(preview.listedElsewhere[0]!.twin?.itemId, twin);

    const swapped = ticked([listed], { swaps: { [listed]: twin } });
    const after = await previewOfferGeneration(userId, collectionId, swapped);
    assert.deepEqual(
      after.lines.flatMap((line) => line.sets.flat().map((row) => row.id)),
      [twin]
    );
    assert.deepEqual(after.listedElsewhere, []);
    await commitOfferGeneration(userId, collectionId, swapped, after.fingerprint);
    const made = await prisma.offer.findFirstOrThrow({
      where: { collectionId, platformId: shopId, sets: { some: { items: { some: { itemId: twin } } } } },
      select: { sets: { select: { items: { select: { itemId: true } } } } },
    });
    assert.deepEqual(made.sets.flatMap((set) => set.items.map((i) => i.itemId)), [twin]);
  });

  it("swaps a proposal lot's listed copy for its twin before the sale, so the other offer keeps its copy", async () => {
    const s = await stamp();
    const listed = await copy(s);
    const twin = await copy(s);
    const other = await stamp();
    const elsewhereCopy = await copy(other);
    const facebookOffer = await offer(facebookId, [listed]);
    const contactId = (await prisma.contact.create({ data: { collectionId, name: "Anna Nowak" } })).id;
    const { proposalId } = await createProposal(userId, collectionId, contactId);
    const lot = await offer(directId, [listed]);
    await addProposalLots(userId, proposalId, [lot]);

    const [entry] = await readProposalLotsListedElsewhere(userId, proposalId, [lot]);
    assert.equal(entry!.offerId, lot);
    assert.equal(entry!.copies[0]!.itemId, listed);
    assert.equal(entry!.copies[0]!.twin?.itemId, twin);

    // Not a twin: another stamp. Refused by name, nothing changed.
    await assert.rejects(
      swapProposalLotCopy(userId, proposalId, lot, listed, elsewhereCopy),
      /can no longer stand in/
    );
    await swapProposalLotCopy(userId, proposalId, lot, listed, twin);
    const sets = await prisma.offerSet.findMany({ where: { offerId: lot }, select: { items: { select: { itemId: true } } } });
    assert.deepEqual(sets.flatMap((set) => set.items.map((i) => i.itemId)), [twin]);
    assert.deepEqual(await readProposalLotsListedElsewhere(userId, proposalId, [lot]), []);

    await convertProposalToSale(userId, proposalId, { lots: [{ offerId: lot, price: "5.00" }], target: { newSale: true } });
    const soldListed = await prisma.saleLineItem.count({ where: { itemId: listed } });
    const soldTwin = await prisma.saleLineItem.count({ where: { itemId: twin } });
    assert.deepEqual([soldListed, soldTwin], [0, 1], "the twin went out; the Facebook offer's copy did not");
    const facebook = await prisma.offer.findUniqueOrThrow({ where: { id: facebookOffer }, select: { state: true } });
    assert.equal(facebook.state, "preparing");
  });
});
