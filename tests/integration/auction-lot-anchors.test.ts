import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { resolveAuctionLotAnchors, toBidLines } from "../../src/lib/auction-lot-anchors";
import { recommendBid } from "../../src/lib/bid-recommendation";

// Auction lot line anchors (#510; ADR-0029 §1, §5, §7) and the learned ratio behind them (#520).
//
// The ladder's arithmetic is unit-tested in `realization-ratio.test.ts` and the market side in
// `market-value.test.ts`; what earns a real database here is the ordering — that a key with a
// recorded result is anchored on it whatever the catalogue says, that one without falls to
// catalogue × the ratio learned from *other* stamps, that a line with neither is reported rather
// than zeroed, and that a line whose figure cannot reach the sale's currency is unconvertible and
// not unpriced.
//
// The collection's base currency and every sale's are EUR unless a test says otherwise, so no
// exchange rate is fetched. The one foreign-currency case uses a currency no feed quotes, which is
// exactly the "no rate to be had" state the unconvertible flag exists for.

describe("auction lot line anchors (#510)", () => {
  let userId: string;
  let collectionId: string;
  let sellerId: string;
  let platformId: string;
  let conditionId: string;
  let editionId: string;
  let areaId: string;
  let issueId: string;

  /** Priced 50.00 MNH — the stamp with recorded results of its own. */
  let recordedStampId: string;
  /** Priced 40.00 MNH, never sold — the one the learned ratio has to price. */
  let plainStampId: string;
  /** No catalogue price and no result: unanchored. */
  let unknownStampId: string;
  /** Priced 100.00 MNH each, and what the ratio evidence is built from. */
  const evidenceStampIds: string[] = [];

  let seq = 0;
  let nextItemNo = 1;

  async function price(stampId: string, amount: string) {
    await prisma.stampCatalogPrice.create({
      data: {
        stampId,
        catalogEditionId: editionId,
        conditionId,
        certificateStatusId: null,
        formatId: null,
        price: amount,
        currency: "EUR",
      },
    });
  }

  async function stamp(name: string, issuedYear: number | null = 1950): Promise<string> {
    const s = await prisma.stamp.create({ data: { collectionId, name, issuedYear } });
    await prisma.stampCollectionArea.create({
      data: { stampId: s.id, collectionAreaId: areaId, isPrimary: true },
    });
    await prisma.issueMember.create({ data: { issueId, stampId: s.id } });
    return s.id;
  }

  async function sale(currency = "EUR"): Promise<string> {
    const row = await prisma.auctionSale.create({
      data: { collectionId, sellerId, platformId, name: `Sale ${++seq}`, currency },
    });
    return row.id;
  }

  interface LotSpec {
    saleId: string;
    finalPrice?: string | null;
    status?: string;
    lines: { stampId: string; quantity?: number }[];
  }

  async function lot(spec: LotSpec): Promise<string> {
    const row = await prisma.auctionLot.create({
      data: {
        auctionSaleId: spec.saleId,
        auctionLotNo: 9500 + ++seq,
        lotNo: String(seq),
        endsAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        status: spec.status ?? "closed",
        finalPrice: spec.finalPrice ?? null,
        lines: {
          create: spec.lines.map((l) => ({
            stampId: l.stampId,
            conditionId,
            certificateStatusId: null,
            formatId: null,
            quantity: l.quantity ?? 1,
          })),
        },
      },
    });
    return row.id;
  }

  /** One copy held, in hand — the state the ownership count is about. */
  async function addCopy(stampId: string) {
    await prisma.item.create({
      data: {
        collectionId,
        itemNo: nextItemNo++,
        stampId,
        conditionId,
        deliveryState: "delivered",
        inCollection: true,
      },
    });
  }

  /** Three single-line results at half catalogue — enough to carry a bucket (`MIN_RATIO_SAMPLE`). */
  async function recordHalfCatalogueEvidence(saleId: string) {
    for (const stampId of evidenceStampIds) {
      await lot({ saleId, finalPrice: "50.00", lines: [{ stampId }] });
    }
  }

  // Every test starts from no evidence, so a ladder level is never inherited from the test before.
  beforeEach(async () => {
    await prisma.auctionLot.deleteMany({ where: { auctionSale: { collectionId } } });
    await prisma.item.deleteMany({ where: { collectionId } });
  });

  before(async () => {
    const ts = Date.now();
    userId = `test-user-anchors-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User anchors-${ts}`,
        email: `test-anchors-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-anchors-${ts}`,
        name: `Collection anchors-${ts}`,
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

    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 9201, collectionAreaId: areaId, name: "Definitives", year: 1950 },
      })
    ).id;

    recordedStampId = await stamp("Recorded");
    await price(recordedStampId, "50.00");
    plainStampId = await stamp("Plain");
    await price(plainStampId, "40.00");
    unknownStampId = await stamp("Unknown");

    for (const n of [1, 2, 3]) {
      const id = await stamp(`Evidence ${n}`);
      await price(id, "100.00");
      evidenceStampIds.push(id);
    }

    sellerId = (await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })).id;
    platformId = (await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })).id;
  });

  after(async () => {
    // Sales first: `AuctionLotLine.stampId` is `Restrict`, so dropping the collection would race its
    // own cascades — the stamps go one way and the lines the other.
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("anchors a line on the market median for its key, whatever the catalogue says", async () => {
    const saleId = await sale();
    // Two results at 30 and 20: a median of 25 against a catalogue value of 50.
    await lot({ saleId, finalPrice: "30.00", lines: [{ stampId: recordedStampId }] });
    await lot({ saleId, finalPrice: "20.00", lines: [{ stampId: recordedStampId }] });
    const targetId = await lot({
      saleId,
      status: "open",
      lines: [{ stampId: recordedStampId, quantity: 2 }],
    });

    const anchors = await resolveAuctionLotAnchors(collectionId, [targetId]);
    const [line] = anchors.get(targetId)!.lines;
    assert.equal(line.source, "market");
    assert.equal(line.anchor, 25);
    assert.equal(line.unconvertible, false);
    assert.equal(line.market?.median, "25.00");
    assert.equal(line.market?.n, 2);
    // The catalogue figure is still reported — it is evidence, it just is not the anchor.
    assert.equal(line.catalogueValue, "50.00");
    assert.equal(line.ratio, null);
  });

  it("anchors an unrecorded line on catalogue × the ratio learned from other stamps", async () => {
    const saleId = await sale();
    await recordHalfCatalogueEvidence(saleId);
    const targetId = await lot({ saleId, status: "open", lines: [{ stampId: plainStampId }] });

    const anchors = await resolveAuctionLotAnchors(collectionId, [targetId]);
    const [line] = anchors.get(targetId)!.lines;
    assert.equal(line.source, "catalogue");
    assert.equal(line.market, null);
    assert.equal(line.catalogueValue, "40.00");
    assert.equal(line.ratio?.ratio, 0.5);
    assert.equal(line.ratio?.n, 3);
    // Same area, same condition, and 1950 is inside its own ±2 window.
    assert.equal(line.ratio?.level, "area-condition-period");
    assert.deepEqual([line.ratio?.fromYear, line.ratio?.toYear], [1948, 1952]);
    assert.equal(line.ratio?.bucketLabel, "Poland, MNH, 1948–1952");
    assert.equal(line.anchor, 20);
  });

  it("falls back to the configured percentage while nothing has been recorded", async () => {
    const saleId = await sale();
    const targetId = await lot({ saleId, status: "open", lines: [{ stampId: plainStampId }] });

    const anchors = await resolveAuctionLotAnchors(collectionId, [targetId]);
    const [line] = anchors.get(targetId)!.lines;
    assert.equal(line.ratio?.level, "fallback");
    assert.equal(line.ratio?.n, 0);
    // `bidFallbackPercent` defaults to 100, so the anchor is the catalogue value unchanged — which
    // is exactly what #370's catalogue quick fill already writes (ADR-0029 §9).
    assert.equal(line.ratio?.ratio, 1);
    assert.equal(line.anchor, 40);
  });

  it("reports a line with neither anchor rather than pricing it at zero", async () => {
    const saleId = await sale();
    const targetId = await lot({ saleId, status: "open", lines: [{ stampId: unknownStampId }] });

    const anchors = await resolveAuctionLotAnchors(collectionId, [targetId]);
    const [line] = anchors.get(targetId)!.lines;
    assert.equal(line.source, null);
    assert.equal(line.anchor, null);
    assert.equal(line.unconvertible, false);
    assert.equal(line.market, null);
    assert.equal(line.catalogueValue, null);
    assert.equal(line.ratio, null);
  });

  it("reports a line it cannot convert as unconvertible, not as unpriced", async () => {
    // A currency no feed quotes: the catalogue value exists in EUR and cannot reach the sale.
    const saleId = await sale("XTS");
    const targetId = await lot({ saleId, status: "open", lines: [{ stampId: plainStampId }] });

    const anchors = await resolveAuctionLotAnchors(collectionId, [targetId]);
    const lot0 = anchors.get(targetId)!;
    assert.equal(lot0.currency, "XTS");
    const [line] = lot0.lines;
    assert.equal(line.source, "catalogue");
    assert.equal(line.unconvertible, true);
    assert.equal(line.anchor, null);
    // The ratio is still stated: it is what the figure *would* be multiplied by.
    assert.ok(line.ratio);
  });

  it("counts the copies already held of the line's stamp × condition, without moving a figure", async () => {
    const saleId = await sale();
    await addCopy(plainStampId);
    await addCopy(plainStampId);
    const targetId = await lot({
      saleId,
      status: "open",
      lines: [{ stampId: plainStampId }, { stampId: unknownStampId }],
    });

    const anchors = await resolveAuctionLotAnchors(collectionId, [targetId]);
    const lines = anchors.get(targetId)!.lines;
    assert.equal(lines.find((l) => l.stampId === plainStampId)!.owned, 2);
    assert.equal(lines.find((l) => l.stampId === unknownStampId)!.owned, 0);
    // Ownership is evidence: the anchor is the fallback figure either way (ADR-0029 §7).
    assert.equal(lines.find((l) => l.stampId === plainStampId)!.anchor, 40);
  });

  it("hands #509 a mixed lot's lines, each anchored its own way", async () => {
    const saleId = await sale();
    await recordHalfCatalogueEvidence(saleId);
    await lot({ saleId, finalPrice: "30.00", lines: [{ stampId: recordedStampId }] });
    const targetId = await lot({
      saleId,
      status: "open",
      lines: [
        { stampId: recordedStampId, quantity: 2 },
        { stampId: plainStampId },
        { stampId: unknownStampId },
      ],
    });

    const anchors = await resolveAuctionLotAnchors(collectionId, [targetId]);
    const recommendation = recommendBid(toBidLines(anchors.get(targetId)!.lines), {
      bidFloorPercent: 75,
      bidCeilingPercent: 125,
    });
    // 2 × 30 (market) + 1 × 40 × 0.5 (catalogue × ratio), with the third line unanchored.
    assert.equal(recommendation.fair?.allIn, "80.00");
    assert.equal(recommendation.floor?.allIn, "60.00");
    assert.equal(recommendation.walkAway?.allIn, "100.00");
    assert.equal(recommendation.marketLines, 1);
    assert.equal(recommendation.catalogueLines, 1);
    assert.equal(recommendation.unanchoredLines, 1);
    assert.equal(recommendation.unconvertibleLines, 0);
  });

  it("resolves a whole page of lots in one pass", async () => {
    const saleId = await sale();
    const first = await lot({ saleId, status: "open", lines: [{ stampId: plainStampId }] });
    const second = await lot({ saleId, status: "open", lines: [{ stampId: recordedStampId }] });
    // A lot nothing has been entered against is absent, not an empty entry.
    const empty = await lot({ saleId, status: "open", lines: [] });

    const anchors = await resolveAuctionLotAnchors(collectionId, [first, second, empty]);
    assert.equal(anchors.size, 2);
    assert.equal(anchors.get(first)!.lines.length, 1);
    assert.equal(anchors.get(second)!.lines.length, 1);
    assert.equal(anchors.get(empty), undefined);
  });
});
