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
import { getPiecePriceFields, setPiecePrices } from "../../src/lib/piece-prices";
import { piecePriceKey } from "../../src/lib/piece-price-entry";
import { updateStampFormat } from "../../src/lib/stamp-formats";
import {
  getValuationMethodRoles,
  setAreaValuationMethod,
  setCollectionValuationMethod,
  setValuationMethodRole,
} from "../../src/lib/valuation-methods";
import { valuateItemRows } from "../../src/lib/item-valuation";
import { convertRecordedPieceValues } from "../../src/lib/piece-value-conversion";
import { createTrade } from "../../src/lib/trades";
import { addTradeGiveLines } from "../../src/lib/trade-lines";
import { readTradeBalance } from "../../src/lib/trade-valuation";

// A piece valued by its method (#2359; ADR-0076), against a real database.
//
// The rules — each method, each franking, EF/MeF/MiF, a missing price, which area decides — are
// pinned in `tests/unit/piece-valuation.test.ts`. What only a database can show is that they reach
// every reader: a piece's prices are read in the conditions each method maps (#2375; ADR-0077), an
// unmapped role leaves the value partial, the method is resolved from the copy, the area and the
// collection, a line in a cover format is valued as a piece of its stamp, the holdings total and the
// trade read the computed figure, and a value recorded before #2359 moves onto the modifier with the
// piece's worth unchanged.

const ts = Date.now();

describe("a piece valued by its method (#2359)", () => {
  let userId: string;
  let collectionId: string;
  let vendorId: string;
  let areaId: string;
  let mnhId: string;
  /** Price columns only (#2374): the catalogue's cover prices. */
  let efId: string;
  let mefId: string;
  let mifId: string;
  let bfstId: string;
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
  let editionId: string;

  async function stamp(
    name: string,
    prices: { amount: string; formatId?: string; conditionId?: string }[]
  ) {
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
          conditionId: p.conditionId ?? mnhId,
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
    const priceColumn = async (abbreviation: string, sortOrder: number, symbol: string | null = null) =>
      (
        await prisma.stampCondition.create({
          data: { collectionId, name: abbreviation, abbreviation, symbol, sortOrder, priceOnly: true },
        })
      ).id;
    efId = await priceColumn("EF", 1);
    mefId = await priceColumn("MeF", 2);
    mifId = await priceColumn("MiF", 3, "⊠");
    bfstId = await priceColumn("Bfst", 4);

    // Mi 200 carries a price as the Cover format too — the trap a piece valued as its leading stamp,
    // in its own format, would walk straight into.
    mi200 = await stamp("Mi 200", [
      { amount: "10.00" },
      { amount: "55.00", formatId: blk4Id },
      { amount: "300.00", formatId: coverId },
      { amount: "40.00", conditionId: efId },
      { amount: "60.00", conditionId: mefId },
      { amount: "30.00", conditionId: mifId },
    ]);
    mi201 = await stamp("Mi 201", []);
    mi205 = await stamp("Mi 205", [{ amount: "4.00" }]);
    mi210 = await stamp("Mi 210", [{ amount: "8.00" }, { amount: "25.00", conditionId: efId }]);

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

  it("leaves a piece without a figure while nothing is mapped, and says which role (#2375)", async () => {
    const v = await valueOf(carrierId);
    assert.equal(v.amount, null);
    assert.equal(v.piece?.partial, true);
    assert.deepEqual(v.piece?.unmapped, [{ method: "michel", role: "used" }]);
    // Never filled from another role, and never from the copy's own condition.
    assert.deepEqual(v.piece?.missing, []);
  });

  it("maps each method's roles to the collection's conditions, any condition, one role at a time", async () => {
    const map = (method: Parameters<typeof setValuationMethodRole>[2]["method"], role: string, conditionId: string) =>
      setValuationMethodRole(userId, collectionId, { method, role: role as never, conditionId });
    for (const method of ["michel", "fischer", "fischer_fp_fw_fm", "sum_of_used"] as const) {
      await map(method, "used", mnhId);
    }
    await map("michel", "cover_ef", efId);
    await map("michel", "cover_mef", mefId);
    await map("michel", "cover_mif", mifId);
    await map("michel", "on_piece", bfstId);
    await map("fischer", "cover", mifId);
    await map("fischer", "on_piece", bfstId);
    await map("fischer_fp_fw_fm", "fp", efId);
    await map("fischer_fp_fw_fm", "fw", mefId);
    await map("fischer_fp_fw_fm", "fm", mifId);
    await map("fischer_fp_fw_fm", "on_piece", bfstId);
    const roles = await getValuationMethodRoles(userId, collectionId);
    assert.deepEqual(roles.fischer, { used: mnhId, cover: mifId, on_piece: bfstId });
    assert.deepEqual(roles.sum_of_used, { used: mnhId });

    // A role the method does not read, a condition of another collection, and someone else, refused.
    await assert.rejects(() => map("fischer", "fm", mifId), /does not read/);
    await assert.rejects(() => map("michel", "never_hinged", "no-such-condition"), /Condition not found/);
    await assert.rejects(() =>
      setValuationMethodRole("someone-else", collectionId, { method: "michel", role: "used", conditionId: mnhId })
    );
    // The database refuses the pair too.
    await assert.rejects(() =>
      prisma.valuationMethodRole.create({
        data: { collectionId, method: "sum_of_used", role: "cover_ef", conditionId: efId },
      })
    );
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

  it("gives a format the kind On cover and moves nothing (#2375)", async () => {
    await updateStampFormat(userId, coverId, { name: "Cover", abbreviation: "Cov", pieceKind: "on_cover" });
    const prices = await prisma.stampCatalogPrice.findMany({
      where: { stampId: { in: [mi200, mi210] }, formatId: coverId },
      select: { stampId: true, price: true },
    });
    assert.deepEqual(prices.map((p) => [p.stampId, p.price?.toString()]), [[mi200, "300"]]);
  });

  it("values a rate-correct MiF cover under Michel, the collection's default, at the highest MiF price", async () => {
    const v = await valueOf(carrierId);
    assert.equal(v.amount, "30.00");
    assert.equal(v.piece?.method, "michel");
    // Every price read from its mapped condition, named by it.
    assert.deepEqual(v.piece?.columns.cover_mif, { conditionId: mifId, abbreviation: "MiF", symbol: "⊠" });
    assert.deepEqual(v.piece?.unmapped, []);
    assert.deepEqual(v.piece?.methodSource, { kind: "collection" });
    assert.equal(v.piece?.usage, "mif");
    // Prices in the collection's own currency need no original beside them (#2388).
    assert.equal(v.piece?.currency, "EUR");
    assert.ok(v.piece?.components.every((c) => c.originals === undefined));
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

  it("keeps each converted price's original beside it, and names the collection currency (#2388)", async () => {
    // EUR prices in a PLN collection: the rule reads the converted figure, the arithmetic both.
    await prisma.collection.update({ where: { id: collectionId }, data: { baseCurrency: "PLN" } });
    await prisma.exchangeRate.createMany({
      data: [
        ["EUR", "1"],
        ["PLN", "4.25"],
      ].map(([toCurrency, rate]) => ({ collectionId, fromCurrency: "EUR", toCurrency, rate, fetchedAt: new Date() })),
    });
    try {
      await setPieceValuation(userId, carrierId, { franking: "philatelic_posted" });
      const v = await valueOf(carrierId);
      assert.equal(v.piece?.currency, "PLN");
      const [term] = v.piece?.terms ?? [];
      const component = v.piece?.components.find((c) => c.id === term?.componentId);
      assert.equal(term?.unit, 42.5);
      assert.deepEqual(component?.originals?.used, { amount: 10, currency: "EUR" });
      // Mi 201 has no price at all, so nothing to keep.
      assert.equal(v.piece?.components.find((c) => c.stampId === mi201)?.originals, undefined);
    } finally {
      await setPieceValuation(userId, carrierId, { franking: "rate_correct" });
      await prisma.exchangeRate.deleteMany({ where: { collectionId } });
      await prisma.collection.update({ where: { id: collectionId }, data: { baseCurrency: "EUR" } });
    }
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

  it("opens a piece's price fields on what is on file, values typed prices unsaved, and saves them (#2368)", async () => {
    const fields = await getPiecePriceFields(userId, collectionId, {
      columns: { used: mnhId, cover_mif: mifId },
      stampIds: [mi200, mi201, mi205],
    });
    assert.equal(fields.stamps[mi205].currency, "EUR");
    assert.equal(fields.stamps[mi205].isUmbrella, false);
    assert.equal(fields.recorded[piecePriceKey(mi200, "used")], "10.00");
    assert.equal(fields.recorded[piecePriceKey(mi200, "cover_mif")], "30.00");
    // The block's own price is not a field: the used field is the single's; and only the columns asked.
    assert.equal(Object.keys(fields.recorded).filter((k) => k.startsWith(mi200)).length, 2);
    assert.equal(fields.recorded[piecePriceKey(mi205, "cover_mif")], undefined);

    // Typed and not saved: the value reads it — Mi 205's MiF 45 is now the highest — and nothing is
    // written. A comma is a decimal point.
    const preview = await previewPieceValue(userId, collectionId, {
      conditionId: mnhId,
      formatId: coverId,
      stamps: [
        { stampId: mi200, quantity: 1, formatId: null },
        { stampId: mi205, quantity: 1, formatId: null },
      ],
      itemId: null,
      franking: "rate_correct",
      typed: [{ stampId: mi205, price: "cover_mif", conditionId: mifId, amount: "45,00" }],
    });
    assert.equal(preview?.amount, "45.00");
    assert.equal(preview?.piece?.partial, false);
    const window = await getCarrierValuation(userId, carrierId, [
      { stampId: mi201, price: "cover_mif", conditionId: mifId, amount: "50" },
      { stampId: mi205, price: "cover_mif", conditionId: mifId, amount: "not a price" },
    ]);
    assert.equal(window.value?.amount, "50.00");
    assert.equal(await prisma.stampCatalogPrice.count({ where: { stampId: { in: [mi201] } } }), 0);
    assert.equal((await valueOf(carrierId)).amount, "30.00");

    // Saved where the value reads them: the main catalogue's latest edition, the column's condition,
    // single, no certificate.
    await setPiecePrices(userId, collectionId, {
      prices: [
        { stampId: mi205, price: "cover_mif", conditionId: mifId, amount: "45,00" },
        { stampId: mi201, price: "used", conditionId: mnhId, amount: "?" },
      ],
    });
    const saved = await prisma.stampCatalogPrice.findMany({
      where: { stampId: { in: [mi201, mi205] }, conditionId: { in: [mnhId, mifId] } },
      select: { id: true, stampId: true, conditionId: true, formatId: true, price: true, mark: true, catalogEditionId: true, certificateStatusId: true },
    });
    const mif = saved.find((p) => p.stampId === mi205 && p.conditionId === mifId);
    assert.equal(mif?.formatId, null);
    assert.equal(mif?.price?.toString(), "45");
    assert.equal(mif?.catalogEditionId, editionId);
    assert.equal(mif?.certificateStatusId, null);
    const used = saved.find((p) => p.stampId === mi201);
    assert.deepEqual([used?.formatId, used?.price, used?.mark], [null, null, "undeterminable"]);
    // Every reader of the stamp reads it — the piece's own value among them.
    assert.equal((await valueOf(carrierId)).amount, "45.00");

    // Parsed before anything is written; and only the owner may.
    await assert.rejects(() =>
      setPiecePrices(userId, collectionId, {
        prices: [
          { stampId: mi201, price: "cover_mif", conditionId: mifId, amount: "7" },
          { stampId: mi205, price: "used", conditionId: mnhId, amount: "abc" },
        ],
      })
    );
    assert.equal(await prisma.stampCatalogPrice.count({ where: { stampId: mi201, conditionId: mifId } }), 0);
    await assert.rejects(() =>
      setPiecePrices("someone-else", collectionId, {
        prices: [{ stampId: mi205, price: "used", conditionId: mnhId, amount: "1" }],
      })
    );

    // The tests below value the piece without them.
    await prisma.stampCatalogPrice.deleteMany({ where: { id: { in: [mif!.id, used!.id] } } });
    assert.equal((await valueOf(carrierId)).amount, "30.00");
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

  it("values a line in a cover format as a piece of its one stamp (#2375)", async () => {
    // A want, a lot line or a trade line is not a copy; in a format of a kind it has no prices of
    // its own, so it is valued as one stamp once on that cover, rate-correct, by the area's method.
    const line = {
      id: "line",
      stampId: mi200,
      conditionId: mnhId,
      certificateStatusId: null,
      formatId: coverId,
      unknownVariant: false,
      copy: null,
      faultReductionPercent: null,
      valueModifier: null,
      candidateStampIds: null,
    };
    const v = (await valuateItemRows(collectionId, [line])).get("line")!;
    assert.equal(v.amount, "40.00");
    assert.equal(v.piece?.usage, "ef");
    assert.equal(v.piece?.franking, "rate_correct");
  });

  it("values one stamp once on a cover at its EF price, and still counts it", async () => {
    const single = await createItem(userId, collectionId, { stampId: mi210, conditionId: mnhId });
    await updateItem(userId, single.id, { formatId: coverId });
    const v = await valueOf(single.id);
    assert.equal(v.amount, "25.00");
    assert.equal(v.piece?.usage, "ef");
    const row = await getItemListItem(userId, single.id);
    assert.equal(row.multiStamp, false);

    // Shown as any piece (#2382): its Valuation window lists the one stamp and the computed value,
    // identification previews it from the stamp alone, and a typed EF price is read in the condition
    // the method maps — never the copy's own.
    const window = await getCarrierValuation(userId, single.id);
    assert.equal(window.multiStamp, true);
    assert.equal(window.value?.amount, "25.00");
    assert.deepEqual(window.components.map((c) => c.stampId), [mi210]);
    const columns = window.value?.piece?.columns;
    assert.equal(columns?.cover_ef?.conditionId, efId);
    const draft = {
      conditionId: mnhId,
      formatId: coverId,
      stamps: [{ stampId: mi210, quantity: 1, formatId: null }],
      itemId: null,
      franking: "rate_correct" as const,
    };
    assert.equal((await previewPieceValue(userId, collectionId, draft))?.amount, "25.00");
    const typed = await previewPieceValue(userId, collectionId, {
      ...draft,
      typed: [{ stampId: mi210, price: "cover_ef", conditionId: efId, amount: "31" }],
    });
    assert.equal(typed?.amount, "31.00");
    const fields = await getPiecePriceFields(userId, collectionId, {
      columns: { used: mnhId, cover_ef: efId },
      stampIds: [mi210],
    });
    assert.equal(fields.recorded[piecePriceKey(mi210, "cover_ef")], "25.00");
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

  it("unmaps a role when its condition is deleted, and the value says so (#2375)", async () => {
    const spare = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Spare", abbreviation: "SP", sortOrder: 9, priceOnly: true },
      })
    ).id;
    await setValuationMethodRole(userId, collectionId, { method: "michel", role: "cover_mif", conditionId: spare });
    const partial = await valueOf(carrierId);
    assert.deepEqual(partial.piece?.columns.cover_mif?.abbreviation, "SP");
    assert.equal(partial.amount, null);
    await prisma.stampCondition.delete({ where: { id: spare } });
    const unmapped = await valueOf(carrierId);
    assert.deepEqual(unmapped.piece?.unmapped, [{ method: "michel", role: "cover_mif" }]);
    assert.equal(unmapped.piece?.columns.cover_mif, undefined);
    await setValuationMethodRole(userId, collectionId, { method: "michel", role: "cover_mif", conditionId: mifId });
    assert.equal((await valueOf(carrierId)).amount, "120.00");
  });

  it("refuses a franking or a method the database does not know", async () => {
    await assert.rejects(() =>
      prisma.item.update({ where: { id: carrierId }, data: { franking: "posted" } })
    );
    await assert.rejects(() =>
      prisma.collectionArea.update({ where: { id: areaId }, data: { valuationMethod: "scott" } })
    );
    await assert.rejects(() =>
      prisma.stampFormat.update({ where: { id: blk4Id }, data: { pieceKind: "on_envelope" } })
    );
  });
});
