import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createAuctionLot,
  createAuctionLotLine,
  createAuctionSale,
  deleteAuctionLotLine,
  getAuctionLotComposition,
  getAuctionSaleDetail,
  listAuctionLots,
  resolveAuctionLineStamps,
  updateAuctionLotLine,
} from "../../src/lib/auctions";

// Auction lot composition and catalogue value (#353; ADR-0021 §7).
//
// What earns a real database here is that the value is **not computed in this module at all**: it
// comes from the copy valuation, so what these tests actually check is that the three rules it owns
// still reach an auction lot — the unknown-variant rollup (#238), format pricing (ADR-0020), and
// quantity — and that the figure lands on the lot row, the lot's own read and the parcel total.
//
// The collection's base currency and the sale's are both EUR so no exchange rate is fetched: the
// conversion path has its own coverage in `exchange-rates.test.ts`, and a network call in here would
// make the suite fail offline.

describe("auction lot composition (#353)", () => {
  let userId: string;
  let collectionId: string;
  let saleId: string;
  let lotId: string;
  let conditionId: string;
  let usedConditionId: string;
  let attestId: string;
  let pairFormatId: string;
  let blockFormatId: string;
  let editionId: string;
  let issueId: string;
  let areaId: string;
  /** Priced 10.00 at MNH. */
  let plainStampId: string;
  /** No price of its own; two variant children at 30 and 20 — the rollup takes 20. */
  let umbrellaStampId: string;
  /** Priced 8.00 as a single, with a ×2.5 pair factor and an explicit block price of 50. */
  let multipleStampId: string;

  const hourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);

  async function price(
    stampId: string,
    conditionIdArg: string,
    amount: string,
    formatId: string | null = null,
    certificateStatusId: string | null = null
  ) {
    await prisma.stampCatalogPrice.create({
      data: {
        stampId,
        catalogEditionId: editionId,
        conditionId: conditionIdArg,
        certificateStatusId,
        formatId,
        price: amount,
        currency: "EUR",
      },
    });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-auclines-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User auclines-${ts}`,
        email: `test-auclines-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-auclines-${ts}`,
        name: `Collection auclines-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Europa", currency: "EUR" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedConditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;
    attestId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Fotoattest", abbreviation: "FA", sortOrder: 0 },
      })
    ).id;
    pairFormatId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Pair", abbreviation: "Pr", sortOrder: 0 },
      })
    ).id;
    blockFormatId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Block of four", abbreviation: "Blk4", sortOrder: 1 },
      })
    ).id;

    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        data: { collectionId, collectionAreaId: areaId, name: "Definitives", year: 1950 },
      })
    ).id;

    const variantSubtype = await prisma.stampSubtype.create({
      data: { collectionId, name: "Variant", actsAsVariant: true, isDefault: true, sortOrder: 0 },
    });

    async function stamp(name: string, parentId?: string, subtypeId?: string): Promise<string> {
      const s = await prisma.stamp.create({
        data: { collectionId, name, parentId, subtypeId },
      });
      await prisma.stampCollectionArea.create({
        data: { stampId: s.id, collectionAreaId: areaId, isPrimary: true },
      });
      await prisma.issueMember.create({ data: { issueId, stampId: s.id } });
      return s.id;
    }

    plainStampId = await stamp("Plain");
    await price(plainStampId, conditionId, "10.00");

    umbrellaStampId = await stamp("Umbrella");
    const variantA = await stamp("Umbrella A", umbrellaStampId, variantSubtype.id);
    const variantB = await stamp("Umbrella B", umbrellaStampId, variantSubtype.id);
    await price(variantA, conditionId, "30.00");
    await price(variantB, conditionId, "20.00");

    multipleStampId = await stamp("Multiple");
    await price(multipleStampId, conditionId, "8.00");
    // An explicit price for the block; the pair gets only a factor.
    await price(multipleStampId, conditionId, "50.00", blockFormatId);
    await prisma.stampFormatFactor.create({
      data: { collectionId, formatId: pairFormatId, factor: "2.5" },
    });

    const sellerId = (
      await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })
    ).id;
    const platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
    saleId = await createAuctionSale(userId, collectionId, {
      sellerId,
      platformId,
      name: "Parcel",
      url: null,
      endsAt: null,
      currency: "EUR",
      shippingCost: "15.00",
      premiumPercent: "10.00",
      premiumFixed: "2.00",
    });
    lotId = await createAuctionLot(userId, collectionId, {
      auctionSaleId: saleId,
      lotNo: "1",
      url: null,
      title: "A lot",
      endsAt: hourFromNow(),
      startingPrice: null,
      currentBid: "100.00",
      myBid: null,
      maxBid: null,
      notes: null,
    });
  });

  after(async () => {
    // Sales first: `AuctionLotLine.stampId` is `Restrict`, so dropping the collection would race
    // its own cascades — the stamps go one way and the lines the other. Deleting the sales takes
    // the lots and their lines with it and leaves nothing pointing at a stamp.
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("starts with an empty composition rather than a zero value", async () => {
    const composition = await getAuctionLotComposition(userId, lotId);
    assert.equal(composition.lineCount, 0);
    // Not "0.00": a lot nobody has described is unanswered, not worthless.
    assert.equal(composition.catalogValue, null);
    assert.equal(composition.headroom, null);
    // 100 + 10% + 2, shipping excluded — it belongs to the parcel.
    assert.equal(composition.allIn, "112.00");
  });

  it("values a line at its condition and multiplies by quantity", async () => {
    const lineId = await createAuctionLotLine(userId, lotId, {
      stampId: plainStampId,
      conditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: 3,
    });
    const composition = await getAuctionLotComposition(userId, lotId);
    assert.equal(composition.catalogValue, "30.00");
    assert.equal(composition.quantity, 3);
    const line = composition.lines.find((l) => l.id === lineId);
    assert.ok(line);
    assert.equal(line.unitValue, "10.00");
    assert.equal(line.lineValue, "30.00");
    assert.equal(line.unpriced, false);
    assert.equal(line.uncertain, false);
    // Headroom is measured against the all-in cost, never the hammer price: 30 − 112.
    assert.equal(composition.headroom, "-82.00");
  });

  it("counts an unpriced line without dropping it, and prices it once a value exists", async () => {
    const lineId = await createAuctionLotLine(userId, lotId, {
      stampId: plainStampId,
      conditionId: usedConditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    let composition = await getAuctionLotComposition(userId, lotId);
    assert.equal(composition.unpricedLines, 1);
    // The priced line still counts; the total simply leaves the gap out and reports it.
    assert.equal(composition.catalogValue, "30.00");
    assert.equal(composition.lines.find((l) => l.id === lineId)?.unpriced, true);

    // Exactly what the quick-price dialog writes from the line's price slot.
    await price(plainStampId, usedConditionId, "4.00");
    composition = await getAuctionLotComposition(userId, lotId);
    assert.equal(composition.unpricedLines, 0);
    assert.equal(composition.catalogValue, "34.00");

    await deleteAuctionLotLine(userId, lineId);
  });

  it("rolls an unknown-variant umbrella up from its cheapest child, marked uncertain", async () => {
    const lineId = await createAuctionLotLine(userId, lotId, {
      stampId: umbrellaStampId,
      conditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    const composition = await getAuctionLotComposition(userId, lotId);
    const line = composition.lines.find((l) => l.id === lineId);
    assert.ok(line);
    // 20, not 30: pointing a line at the umbrella says "one of these", and the cheapest is the
    // honest reading of that (#238).
    assert.equal(line.unitValue, "20.00");
    assert.equal(line.uncertain, true);
    assert.equal(line.unknownVariant, true);
    assert.equal(composition.uncertain, true);

    await deleteAuctionLotLine(userId, lineId);
  });

  it("prices a multiple by its format, and leaves one with neither price nor factor unpriced", async () => {
    // Explicit price for the format wins.
    const blockLine = await createAuctionLotLine(userId, lotId, {
      stampId: multipleStampId,
      conditionId,
      certificateStatusId: null,
      formatId: blockFormatId,
      quantity: 1,
    });
    // No explicit price: the single's 8.00 × the 2.5 pair factor.
    const pairLine = await createAuctionLotLine(userId, lotId, {
      stampId: multipleStampId,
      conditionId,
      certificateStatusId: null,
      formatId: pairFormatId,
      quantity: 1,
    });
    let composition = await getAuctionLotComposition(userId, lotId);
    assert.equal(composition.lines.find((l) => l.id === blockLine)?.unitValue, "50.00");
    assert.equal(composition.lines.find((l) => l.id === pairLine)?.unitValue, "20.00");

    // Move the pair to a condition with no single price and no factor of its own: the multiple is
    // then unpriced, never valued at the single's figure.
    await updateAuctionLotLine(userId, pairLine, {
      stampId: multipleStampId,
      conditionId: usedConditionId,
      certificateStatusId: null,
      formatId: pairFormatId,
      quantity: 1,
    });
    composition = await getAuctionLotComposition(userId, lotId);
    assert.equal(composition.lines.find((l) => l.id === pairLine)?.unpriced, true);

    await deleteAuctionLotLine(userId, blockLine);
    await deleteAuctionLotLine(userId, pairLine);
  });

  it("carries the value onto the lot row and into the parcel total", async () => {
    const { items } = await listAuctionLots(userId, collectionId, { saleId });
    const row = items.find((l) => l.id === lotId);
    assert.ok(row);
    assert.equal(row.lineCount, 1);
    assert.equal(row.catalogValue, "30.00");
    // Named after what it holds when the collector typed no title (#353). This lot has one, so the
    // derived name rides alongside rather than replacing it. These test stamps carry no catalog
    // numbers, so the name falls back to the stamp — the collapsing itself is unit-tested.
    assert.equal(row.title, "A lot");
    assert.equal(row.derivedTitle, "Plain · Definitives (1950)");
    assert.equal(row.headroom, "-82.00");
    assert.equal(row.catalogUncertain, false);

    const sale = await getAuctionSaleDetail(userId, saleId);
    assert.equal(sale.summary.catalogTotal, "30.00");
    assert.equal(sale.summary.unvaluedCount, 0);
    // The parcel adds shipping once: 30 − (112 + 15).
    assert.equal(sale.summary.headroom, "-97.00");
    assert.equal(sale.lots.find((l) => l.id === lotId)?.catalogValue, "30.00");
  });

  it("matches the certificate exactly, as a copy does", async () => {
    const lineId = await createAuctionLotLine(userId, lotId, {
      stampId: plainStampId,
      conditionId,
      certificateStatusId: attestId,
      formatId: null,
      quantity: 1,
    });
    let composition = await getAuctionLotComposition(userId, lotId);
    // The 10.00 recorded at "no certificate" is a different row and must not stand in: a lot sold
    // with an Attest is worth a different figure, which is the whole reason the column exists.
    assert.equal(composition.lines.find((l) => l.id === lineId)?.unpriced, true);

    await price(plainStampId, conditionId, "45.00", null, attestId);
    composition = await getAuctionLotComposition(userId, lotId);
    const line = composition.lines.find((l) => l.id === lineId);
    assert.equal(line?.unitValue, "45.00");
    assert.equal(line?.certificateStatusId, attestId);

    await deleteAuctionLotLine(userId, lineId);
  });

  it("creates a lot together with its composition in one operation", async () => {
    const newLotId = await createAuctionLot(userId, collectionId, {
      auctionSaleId: saleId,
      lotNo: "2",
      url: null,
      title: "Captured with contents",
      endsAt: hourFromNow(),
      startingPrice: null,
      currentBid: "10.00",
      myBid: null,
      maxBid: null,
      notes: null,
      lines: [
        { stampId: plainStampId, conditionId, certificateStatusId: null, formatId: null, quantity: 2 },
        {
          stampId: multipleStampId,
          conditionId,
          certificateStatusId: null,
          formatId: blockFormatId,
          quantity: 1,
        },
      ],
    });
    const composition = await getAuctionLotComposition(userId, newLotId);
    assert.equal(composition.lineCount, 2);
    // 2 × 10 + 1 × 50.
    assert.equal(composition.catalogValue, "70.00");

    await prisma.auctionLot.delete({ where: { id: newLotId } });
  });

  it("writes no lot at all when one of its lines is bad", async () => {
    const otherCol = await prisma.collection.create({
      data: {
        slug: `col-auclines-bad-${Date.now()}`,
        name: "Other",
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    const foreign = await prisma.stamp.create({
      data: { collectionId: otherCol.id, name: "Foreign" },
    });
    const before = await prisma.auctionLot.count({ where: { auctionSaleId: saleId } });
    await assert.rejects(() =>
      createAuctionLot(userId, collectionId, {
        auctionSaleId: saleId,
        lotNo: "3",
        url: null,
        title: "Should not exist",
        endsAt: hourFromNow(),
        startingPrice: null,
        currentBid: null,
        myBid: null,
        maxBid: null,
        notes: null,
        lines: [
          { stampId: plainStampId, conditionId, certificateStatusId: null, formatId: null, quantity: 1 },
          { stampId: foreign.id, conditionId, certificateStatusId: null, formatId: null, quantity: 1 },
        ],
      })
    );
    // The composition is checked before anything is written, so a refused line leaves no lot behind
    // for the collector to find and wonder about.
    assert.equal(await prisma.auctionLot.count({ where: { auctionSaleId: saleId } }), before);
    await prisma.collection.delete({ where: { id: otherCol.id } });
  });

  it("expands a whole issue to its required members, and refuses one with none", async () => {
    // Only two of the issue's stamps are marked required for completeness; the rest are members
    // all the same, and a "complete series" lot is the required ones.
    await prisma.issueMember.updateMany({
      where: { issueId, stampId: { in: [plainStampId, multipleStampId] } },
      data: { requiredForCompleteness: true },
    });
    const stampIds = await resolveAuctionLineStamps(collectionId, { issueId });
    assert.deepEqual([...stampIds].sort(), [plainStampId, multipleStampId].sort());

    // A single stamp resolves to itself — the shortcut is the only thing that fans out.
    assert.deepEqual(await resolveAuctionLineStamps(collectionId, { stampId: plainStampId }), [
      plainStampId,
    ]);

    const emptyIssue = await prisma.issue.create({
      data: { collectionId, collectionAreaId: areaId, name: "Nothing required", year: 1960 },
    });
    // Silence here would create a lot line for nothing at all, so it is refused out loud.
    await assert.rejects(() => resolveAuctionLineStamps(collectionId, { issueId: emptyIssue.id }));
    await assert.rejects(() => resolveAuctionLineStamps(collectionId, {}));

    await prisma.issue.delete({ where: { id: emptyIssue.id } });
    await prisma.issueMember.updateMany({
      where: { issueId },
      data: { requiredForCompleteness: false },
    });
  });

  it("refuses a line pointing outside the collection", async () => {
    const otherCol = await prisma.collection.create({
      data: {
        slug: `col-auclines-other-${Date.now()}`,
        name: "Other",
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    const foreign = await prisma.stamp.create({
      data: { collectionId: otherCol.id, name: "Foreign" },
    });
    await assert.rejects(() =>
      createAuctionLotLine(userId, lotId, {
        stampId: foreign.id,
        conditionId,
        certificateStatusId: null,
        formatId: null,
        quantity: 1,
      })
    );
    await prisma.collection.delete({ where: { id: otherCol.id } });
  });
});
