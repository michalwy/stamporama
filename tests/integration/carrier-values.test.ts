import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createItem,
  getHoldingsValuation,
  getItemListItem,
  updateItem,
  valuateItemsByIds,
} from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import {
  getCarrierValuation,
  previewPieceValue,
  setPieceValuation,
} from "../../src/lib/carrier-values";
import { updateStampFormat } from "../../src/lib/stamp-formats";
import { setAreaValuationMethod, setCollectionValuationMethod } from "../../src/lib/valuation-methods";
import { convertRecordedPieceValues } from "../../src/lib/piece-value-conversion";
import { COVER_FORMATS } from "../../src/lib/cover-kind";
import { createTrade } from "../../src/lib/trades";
import { addTradeGiveLines } from "../../src/lib/trade-lines";
import { readTradeBalance } from "../../src/lib/trade-valuation";

// A piece valued by its method (#2359; ADR-0076), against a real database.
//
// The rules — each method, each franking, EF/MeF/MiF, a missing price, which area decides — are
// pinned in `tests/unit/piece-valuation.test.ts`. What only a database can show is that they reach
// every reader: a piece's prices are read at the right keys (its stamps' used prices, the reserved
// cover rows), a format given a kind takes its prices with it, the method is resolved from the copy,
// the area and the collection, the holdings total and the trade read the computed figure, and a value
// recorded before #2359 moves onto the modifier with the piece's worth unchanged.

const ts = Date.now();

describe("a piece valued by its method (#2359)", () => {
  let userId: string;
  let collectionId: string;
  let vendorId: string;
  let areaId: string;
  let mnhId: string;
  let blk4Id: string;
  let coverId: string;
  let mi200: string;
  let mi201: string;
  let mi205: string;
  let mi210: string;
  /** Mi 200 twice loose, Mi 200 as a block of four, Mi 201 (no price) and Mi 205, on a Cover. */
  let carrierId: string;
  /** An ordinary copy of Mi 205, so every total has a catalogue figure beside the piece. */
  let ordinaryId: string;
  const cover = new Map<string, string>();
  let editionId: string;

  async function stamp(name: string, prices: { amount: string; formatId?: string }[]) {
    const row = await prisma.stamp.create({
      data: {
        collectionId,
        name,
        stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
      },
    });
    for (const p of prices) {
      await prisma.stampCatalogPrice.create({
        data: {
          stampId: row.id,
          catalogEditionId: editionId,
          conditionId: mnhId,
          certificateStatusId: null,
          formatId: p.formatId ?? null,
          price: p.amount,
          currency: "EUR",
        },
      });
    }
    return row.id;
  }

  async function valueOf(itemId: string) {
    return (await getItemListItem(userId, itemId)).value;
  }

  before(async () => {
    userId = `test-user-piece-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User piece-${ts}`,
        email: `test-piece-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-piece-${ts}`, name: "Covers", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const catalogName = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Europa", currency: "EUR" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2026 } })
    ).id;
    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
      })
    ).id;
    await prisma.collectionAreaCatalog.create({
      data: { collectionAreaId: areaId, catalogNameId: catalogName.id },
    });
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    blk4Id = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Block of 4", abbreviation: "Blk4", sortOrder: 0 },
      })
    ).id;
    coverId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Cover", abbreviation: "Cov", sortOrder: 1 },
      })
    ).id;
    for (const [i, f] of COVER_FORMATS.entries()) {
      const row = await prisma.stampFormat.create({
        data: { collectionId, name: f.name, abbreviation: f.abbreviation, sortOrder: i, coverKind: f.coverKind },
      });
      cover.set(f.coverKind, row.id);
    }

    // Mi 200 carries a price as the Cover format too — the trap a piece valued as its leading stamp,
    // in its own format, would walk straight into; once Cover has a kind it is Mi 200's EF price,
    // which the typed EF price already fills.
    mi200 = await stamp("Mi 200", [
      { amount: "10.00" },
      { amount: "55.00", formatId: blk4Id },
      { amount: "300.00", formatId: coverId },
      { amount: "40.00", formatId: cover.get("cover_ef") },
      { amount: "60.00", formatId: cover.get("cover_mef") },
      { amount: "30.00", formatId: cover.get("cover_mif") },
    ]);
    mi201 = await stamp("Mi 201", []);
    mi205 = await stamp("Mi 205", [{ amount: "4.00" }]);
    // Priced only on the Cover format: that price moves to its EF when Cover gets its kind.
    mi210 = await stamp("Mi 210", [{ amount: "8.00" }, { amount: "25.00", formatId: coverId }]);

    carrierId = (await createItem(userId, collectionId, { stampId: mi200, conditionId: mnhId })).id;
    await prisma.item.update({ where: { id: carrierId }, data: { formatId: coverId } });
    await setItemStamps(userId, carrierId, [
      { stampId: mi200, quantity: 2 },
      { stampId: mi200, formatId: blk4Id },
      { stampId: mi201 },
      { stampId: mi205 },
    ]);
    ordinaryId = (await createItem(userId, collectionId, { stampId: mi205, conditionId: mnhId })).id;
  });

  after(async () => {
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("values a piece whose format has no kind at the sum of used prices, partial where one is missing", async () => {
    const v = await valueOf(carrierId);
    // 2 × 10 loose + 55 as a block + nothing for Mi 201 + 4 — never the Cover format's 300.
    assert.equal(v.amount, "79.00");
    assert.equal(v.piece?.rule, "sum_of_used");
    assert.equal(v.piece?.kind, null);
    assert.equal(v.piece?.partial, true);
    assert.deepEqual(v.piece?.missing.map((m) => [m.stampId, m.price]), [[mi201, "used"]]);

    const read = await getCarrierValuation(userId, carrierId);
    assert.equal(read.multiStamp, true);
    assert.equal(read.value?.amount, "79.00");
    // How it was reached (#2353): each stamp's used price as a term, the missing one with no unit,
    // and every entry's prices carried beside it under the entry's own id.
    assert.deepEqual(
      read.value?.piece?.terms.map((t) => [t.stampId, t.price, t.unit, t.percent, t.times]),
      [
        [mi200, "used", 10, 100, 2],
        [mi200, "used", 55, 100, 1],
        [mi201, "used", null, 100, 1],
        [mi205, "used", 4, 100, 1],
      ]
    );
    assert.deepEqual(
      read.value?.piece?.components.map((c) => c.id),
      read.components.map((c) => c.id)
    );
  });

  it("moves a format's own prices to Cover EF when it is given the kind On cover", async () => {
    await updateStampFormat(userId, coverId, { name: "Cover", abbreviation: "Cov", pieceKind: "on_cover" });
    const prices = await prisma.stampCatalogPrice.findMany({
      where: { stampId: { in: [mi200, mi210] }, formatId: { in: [coverId, cover.get("cover_ef")!] } },
      select: { stampId: true, formatId: true, price: true },
    });
    assert.deepEqual(
      prices.map((p) => [p.stampId, p.formatId, p.price?.toString()]).sort(),
      [
        [mi200, cover.get("cover_ef"), "40"],
        [mi210, cover.get("cover_ef"), "25"],
      ].sort()
    );
  });

  it("values a rate-correct MiF cover under Michel, the collection's default, at the highest MiF price", async () => {
    const v = await valueOf(carrierId);
    assert.equal(v.amount, "30.00");
    assert.equal(v.piece?.method, "michel");
    assert.deepEqual(v.piece?.methodSource, { kind: "collection" });
    assert.equal(v.piece?.usage, "mif");
    // Mi 201 and Mi 205 have no MiF price: either could have been the highest.
    assert.equal(v.piece?.partial, true);
  });

  it("follows the franking", async () => {
    await setPieceValuation(userId, carrierId, { franking: "not_posted" });
    assert.equal((await valueOf(carrierId)).amount, "79.00");
    await setPieceValuation(userId, carrierId, { franking: "philatelic_posted" });
    // The most expensive used price (Mi 200's 10) + 15 %.
    assert.equal((await valueOf(carrierId)).amount, "11.50");
    await setPieceValuation(userId, carrierId, { franking: "rate_correct" });
  });

  it("previews the value of a piece not yet written, by the franking chosen (#2353)", async () => {
    const stamps = [
      { stampId: mi200, quantity: 1, formatId: null },
      { stampId: mi205, quantity: 1, formatId: null },
    ];
    const input = { conditionId: mnhId, formatId: coverId, stamps, itemId: null };
    const rateCorrect = await previewPieceValue(userId, collectionId, { ...input, franking: "rate_correct" });
    // MiF: Mi 200's 30; Mi 205 has no MiF price, so it is partial.
    assert.equal(rateCorrect?.amount, "30.00");
    assert.equal(rateCorrect?.piece?.usage, "mif");
    assert.equal(rateCorrect?.piece?.partial, true);
    assert.deepEqual(
      rateCorrect?.piece?.components.map((c) => [c.stampId, c.used, c.coverMif]),
      [
        [mi200, 10, 30],
        [mi205, 4, null],
      ]
    );
    const notPosted = await previewPieceValue(userId, collectionId, { ...input, franking: "not_posted" });
    assert.equal(notPosted?.amount, "14.00");

    // A correction reads the copy's own franking.
    await setPieceValuation(userId, carrierId, { franking: "not_posted" });
    const corrected = await previewPieceValue(userId, collectionId, {
      ...input,
      franking: null,
      itemId: carrierId,
    });
    assert.equal(corrected?.piece?.franking, "not_posted");
    await setPieceValuation(userId, carrierId, { franking: "rate_correct" });

    // One stamp once on no format is not a piece; nothing is previewed.
    assert.equal(
      await previewPieceValue(userId, collectionId, {
        ...input,
        formatId: null,
        stamps: [stamps[0]],
        franking: "rate_correct",
      }),
      null
    );
    await assert.rejects(() =>
      previewPieceValue("someone-else", collectionId, { ...input, franking: "rate_correct" })
    );
  });

  it("takes the method of the most expensive stamp's area, and a copy's own wins", async () => {
    await setCollectionValuationMethod(userId, collectionId, "sum_of_used");
    await setAreaValuationMethod(userId, areaId, "fischer");
    // 50 % of Mi 200's ⊠ 30 for one loose copy, then the other loose one at 10, the block at 55 and
    // Mi 205 at 4; Mi 201 has neither price.
    const fischer = await valueOf(carrierId);
    assert.equal(fischer.amount, "84.00");
    assert.deepEqual(fischer.piece?.methodSource, { kind: "area", areaId });
    const inherited = { method: "fischer", areaId, areaName: "Poland" };
    assert.deepEqual(fischer.piece?.inherited, inherited);

    await setPieceValuation(userId, carrierId, { method: "fischer_fp_fw_fm" });
    const own = await valueOf(carrierId);
    assert.equal(own.amount, "30.00");
    assert.deepEqual(own.piece?.methodSource, { kind: "copy" });
    // What *As inherited* names stays the area's while the copy has its own (#2369).
    assert.deepEqual(own.piece?.inherited, inherited);

    await setPieceValuation(userId, carrierId, { method: null });
    await setAreaValuationMethod(userId, areaId, null);
    const fromCollection = await valueOf(carrierId);
    assert.deepEqual(fromCollection.piece?.inherited, {
      method: "sum_of_used",
      areaId: null,
      areaName: null,
    });
    await setCollectionValuationMethod(userId, collectionId, "michel");
  });

  it("previews by the method chosen in identification, and a correction reads the copy's own (#2369)", async () => {
    const stamps = [
      { stampId: mi200, quantity: 1, formatId: null },
      { stampId: mi205, quantity: 1, formatId: null },
    ];
    const input = { conditionId: mnhId, formatId: coverId, stamps, franking: "rate_correct" as const };
    const chosen = await previewPieceValue(userId, collectionId, {
      ...input,
      itemId: null,
      method: "sum_of_used",
    });
    assert.equal(chosen?.amount, "14.00");
    assert.deepEqual(chosen?.piece?.methodSource, { kind: "copy" });
    assert.equal(chosen?.piece?.inherited.method, "michel");
    const asInherited = await previewPieceValue(userId, collectionId, {
      ...input,
      itemId: null,
      method: null,
    });
    assert.equal(asInherited?.amount, "30.00");
    assert.deepEqual(asInherited?.piece?.methodSource, { kind: "collection" });

    await setPieceValuation(userId, carrierId, { method: "sum_of_used" });
    const corrected = await previewPieceValue(userId, collectionId, { ...input, itemId: carrierId });
    assert.equal(corrected?.piece?.method, "sum_of_used");
    await setPieceValuation(userId, carrierId, { method: null });
  });

  it("values one stamp once on a cover at its EF price, and still counts it", async () => {
    const single = await createItem(userId, collectionId, { stampId: mi210, conditionId: mnhId });
    await updateItem(userId, single.id, { formatId: coverId });
    const v = await valueOf(single.id);
    assert.equal(v.amount, "25.00");
    assert.equal(v.piece?.usage, "ef");
    const row = await getItemListItem(userId, single.id);
    assert.equal(row.multiStamp, false);
    await prisma.item.delete({ where: { id: single.id } });
  });

  it("reads the computed value in the holdings total and the copies by id", async () => {
    const holdings = await getHoldingsValuation(userId, collectionId, {});
    assert.equal(holdings.totalBaseAmount, "34.00");
    assert.equal(holdings.pricedCount, 2);

    const byId = await valuateItemsByIds(collectionId, [carrierId, ordinaryId]);
    assert.equal(byId.get(carrierId)!.amount, "30.00");
    assert.equal(byId.get(ordinaryId)!.amount, "4.00");
  });

  it("values a give line on the piece by its method, in its own book and in the agreed one", async () => {
    const partnerId = (
      await prisma.contact.create({ data: { collectionId, name: "Karel", exchangePartner: true } })
    ).id;
    const trade = await createTrade(userId, collectionId, {
      partnerId,
      currency: "EUR",
      catalogVendorId: vendorId,
    });
    const { added } = await addTradeGiveLines(userId, trade.sections[0].id, [carrierId]);
    assert.equal(added, 1);

    const balance = (await readTradeBalance(userId, trade.id))!;
    const [line] = balance.lines.filter((l) => l.side === "give");
    assert.equal(line.own, 30);
    assert.equal(line.agreed, 30);

    await prisma.trade.delete({ where: { id: trade.id } });
  });

  it("moves a recorded value onto the amount modifier at boot, keeping the piece's worth", async () => {
    await prisma.item.update({
      where: { id: carrierId },
      data: { explicitValue: "120.00", explicitValueCurrency: "EUR" },
    });
    // A figure on a copy that is not a piece was never read, and is only cleared.
    await prisma.item.update({
      where: { id: ordinaryId },
      data: { explicitValue: "9.00", explicitValueCurrency: "EUR" },
    });
    const conversion = await convertRecordedPieceValues();
    assert.ok(conversion.moved >= 1);

    const v = await valueOf(carrierId);
    assert.equal(v.amount, "120.00");
    assert.equal(v.valueModifier?.amount, "90.00");
    assert.equal(v.valueModifier?.fullAmount, "30.00");
    assert.equal((await valueOf(ordinaryId)).amount, "4.00");

    const stored = await prisma.item.findMany({
      where: { id: { in: [carrierId, ordinaryId] } },
      select: { explicitValue: true, explicitValueCurrency: true },
    });
    assert.ok(stored.every((row) => row.explicitValue === null && row.explicitValueCurrency === null));

    // Idempotent: nothing is left to move.
    const again = await convertRecordedPieceValues();
    assert.equal(
      again.kept.some((k) => k.collectionId === collectionId),
      false
    );
    assert.equal((await valueOf(carrierId)).amount, "120.00");
  });

  it("reads a still-valid stamp's cover price from Michel's rule (#2358) in the used condition", async () => {
    const usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1, priceRole: "used" },
      })
    ).id;
    await prisma.stampCondition.update({ where: { id: mnhId }, data: { priceRole: "never_hinged" } });
    await prisma.collectionArea.update({ where: { id: areaId }, data: { stillValidForPostage: true } });
    const mi300 = await stamp("Mi 300", [{ amount: "5.00" }]);
    await prisma.stampCatalogPrice.create({
      data: { stampId: mi300, catalogEditionId: editionId, conditionId: usedId, price: "1.00", currency: "EUR" },
    });
    const piece = await createItem(userId, collectionId, { stampId: mi300, conditionId: usedId });
    await updateItem(userId, piece.id, { formatId: coverId });
    try {
      // EF under Michel: max(0.40, 1.00 + 20 %), under the never-hinged 5.00.
      const v = await valueOf(piece.id);
      assert.equal(v.amount, "1.20");
      assert.equal(v.piece?.usage, "ef");
    } finally {
      await prisma.item.delete({ where: { id: piece.id } });
      await prisma.collectionArea.update({ where: { id: areaId }, data: { stillValidForPostage: null } });
    }
  });

  it("refuses a franking or a method the database does not know", async () => {
    await assert.rejects(() =>
      prisma.item.update({ where: { id: carrierId }, data: { franking: "posted" } })
    );
    await assert.rejects(() =>
      prisma.collectionArea.update({ where: { id: areaId }, data: { valuationMethod: "scott" } })
    );
    await assert.rejects(() =>
      prisma.stampFormat.update({ where: { id: cover.get("cover_ef")! }, data: { pieceKind: "on_cover" } })
    );
  });
});
