import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createItem,
  getHoldingsValuation,
  getItemListItem,
  valuateItemsByIds,
} from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import {
  CarrierValueError,
  getCarrierValuation,
  setCarrierValue,
} from "../../src/lib/carrier-values";
import { createTrade } from "../../src/lib/trades";
import { addTradeGiveLines } from "../../src/lib/trade-lines";
import { readTradeBalance } from "../../src/lib/trade-valuation";

// The value of a multi-stamp copy (#747; ADR-0044 §6), against a real database.
//
// The pure half — the sum rule, quantity, component format, a missing price — is pinned in
// `tests/unit/carrier-value.test.ts`. What only a database can show is that the rule actually reaches
// the readers the issue names: that a carrier is valued at what was recorded **and nothing else** in
// the holdings total, the Copies list row (which the offer price prefill reads) and the trade's own
// valuation; that reading the suggestion writes nothing; and that a figure left on a copy edited back
// to one stamp does not outlive the edit's meaning.

const ts = Date.now();

describe("the value of a multi-stamp copy (#747)", () => {
  let userId: string;
  let collectionId: string;
  let vendorId: string;
  let mnhId: string;
  let blk4Id: string;
  let coverId: string;
  let mi200: string;
  let mi201: string;
  let mi205: string;
  /** Mi 200 twice loose, Mi 200 as a block of four, Mi 201 (no price) and Mi 205. */
  let carrierId: string;
  /** An ordinary copy of Mi 205, so every total has a catalogue figure beside the carrier. */
  let ordinaryId: string;

  async function stamp(areaId: string, name: string, prices: { amount: string; formatId?: string }[]) {
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
  let editionId: string;

  before(async () => {
    userId = `test-user-carrier-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User carrier-${ts}`,
        email: `test-carrier-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-carrier-${ts}`, name: "Covers", baseCurrency: "EUR", ownerId: userId },
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
    const areaId = (
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

    // Mi 200 carries a price as the cover format too — the trap a carrier valued as its leading
    // stamp, in its own format, would walk straight into.
    mi200 = await stamp(areaId, "Mi 200", [
      { amount: "10.00" },
      { amount: "55.00", formatId: blk4Id },
      { amount: "300.00", formatId: coverId },
    ]);
    mi201 = await stamp(areaId, "Mi 201", []);
    mi205 = await stamp(areaId, "Mi 205", [{ amount: "4.00" }]);

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

  it("suggests the sum of the stamps, partial where one has no price", async () => {
    const read = await getCarrierValuation(userId, carrierId);
    assert.equal(read.multiStamp, true);
    // 2 × 10 loose + 55 as a block + nothing for Mi 201 + 4 — never the cover's own 300.
    assert.equal(read.suggestion.totalBaseAmount, "79.00");
    assert.equal(read.suggestion.partial, true);
    assert.equal(read.suggestion.unpricedCount, 1);
    assert.deepEqual(
      read.components.map((c) => [c.stampId, c.formatId, c.quantity, c.share.status]),
      [
        [mi200, null, 2, "priced"],
        [mi200, blk4Id, 1, "priced"],
        [mi201, null, 1, "unpriced"],
        [mi205, null, 1, "priced"],
      ]
    );
    assert.equal(read.recorded, null);
    assert.equal(read.value?.unpriced, true);
  });

  it("stores nothing by suggesting it", async () => {
    const row = await prisma.item.findUniqueOrThrow({
      where: { id: carrierId },
      select: { explicitValue: true, explicitValueCurrency: true },
    });
    assert.equal(row.explicitValue, null);
    assert.equal(row.explicitValueCurrency, null);
  });

  it("is unpriced everywhere until a value is recorded — not its leading stamp's price", async () => {
    const holdings = await getHoldingsValuation(userId, collectionId, {});
    assert.equal(holdings.totalBaseAmount, "4.00");
    assert.equal(holdings.pricedCount, 1);
    assert.equal(holdings.unpricedCount, 1);

    const byId = await valuateItemsByIds(collectionId, [carrierId, ordinaryId]);
    assert.equal(byId.get(carrierId)!.unpriced, true);
    assert.equal(byId.get(ordinaryId)!.amount, "4.00");

    const row = await getItemListItem(userId, carrierId);
    assert.equal(row.value.unpriced, true);
  });

  it("refuses a value on an ordinary copy", async () => {
    await assert.rejects(
      () => setCarrierValue(userId, ordinaryId, { amount: "9.00", currency: "EUR" }),
      (e: unknown) => e instanceof CarrierValueError && /several stamps/.test(e.message)
    );
    await assert.rejects(() =>
      setCarrierValue("somebody-else", carrierId, { amount: "9.00", currency: "EUR" })
    );
  });

  it("reads the recorded value in the holdings total and on the list row", async () => {
    await setCarrierValue(userId, carrierId, { amount: "120.00", currency: "EUR" });

    const holdings = await getHoldingsValuation(userId, collectionId, {});
    assert.equal(holdings.totalBaseAmount, "124.00");
    assert.equal(holdings.pricedCount, 2);
    assert.equal(holdings.unpricedCount, 0);

    // The list row is what the offer price prefill reads its suggestion from (#230).
    const row = await getItemListItem(userId, carrierId);
    assert.equal(row.value.amount, "120.00");
    assert.equal(row.value.explicit, true);
    assert.equal(row.value.uncertain, false);

    const read = await getCarrierValuation(userId, carrierId);
    assert.deepEqual(read.recorded, { amount: "120.00", currency: "EUR" });
    // Recording a value leaves the suggestion exactly as it was: the two are different answers.
    assert.equal(read.suggestion.totalBaseAmount, "79.00");
  });

  it("values a give line on the carrier at the recorded figure, and leaves the agreed catalogue out", async () => {
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
    assert.equal(line.own, 120);
    assert.equal(line.ownManual, false);
    // Not the partner's book's figure for Mi 200 (10), and not the recorded value either: the agreed
    // catalogue prices nothing on a piece carrying several stamps.
    assert.equal(line.agreed, null);

    await prisma.trade.delete({ where: { id: trade.id } });
  });

  it("clears back to unpriced", async () => {
    await setCarrierValue(userId, carrierId, null);
    const row = await getItemListItem(userId, carrierId);
    assert.equal(row.value.unpriced, true);
  });

  it("ignores a recorded figure once the copy carries one stamp again, without erasing it", async () => {
    await setCarrierValue(userId, carrierId, { amount: "120.00", currency: "EUR" });
    await setItemStamps(userId, carrierId, [{ stampId: mi205 }]);
    await prisma.item.update({ where: { id: carrierId }, data: { formatId: null } });

    const row = await getItemListItem(userId, carrierId);
    assert.equal(row.value.explicit, false);
    assert.equal(row.value.amount, "4.00");
    const stored = await prisma.item.findUniqueOrThrow({
      where: { id: carrierId },
      select: { explicitValue: true },
    });
    assert.equal(stored.explicitValue?.toString(), "120");

    await assert.rejects(
      () => setCarrierValue(userId, carrierId, { amount: "1.00", currency: "EUR" }),
      CarrierValueError
    );
  });

  it("refuses an amount with no currency at the database", async () => {
    await assert.rejects(() =>
      prisma.item.update({ where: { id: ordinaryId }, data: { explicitValue: "5.00" } })
    );
  });
});
