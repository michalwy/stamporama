import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createPriceObservation,
  getStampPriceObservations,
  type PriceObservationRaw,
} from "../../src/lib/price-observations";
import {
  getStampMarketEvidenceByStamp,
  getStampMarketValue,
  readMarketMedians,
} from "../../src/lib/market-values";
import { loadRealizationRatios } from "../../src/lib/realization-ratios";
import { createContact, updateContact } from "../../src/lib/contacts";
import { setCollectionHomeMarket } from "../../src/lib/collections";
import { getCollectionAreas, updateCollectionArea } from "../../src/lib/areas";
import { OPERATIONS, matchPath, pickMethod } from "../../src/lib/agent-api/registry";
import { parseParameters } from "../../src/lib/agent-api/params";
import type { OperationContext } from "../../src/lib/agent-api/types";
import type { AgentBidRecommendation } from "../../src/lib/agent-api/bid-reads";
import type { AgentArea } from "../../src/lib/agent-api/area-reads";

// Markets on auction results, and the markets that anchor each area's valuations (#1634; ADR-0064).
// The rules are unit-tested in `market-anchoring.test.ts`; what earns a database here is that a
// result's market is **read off its contacts** (an observation's house, else its platform; a lot's
// seller, else its sale's platform), that an area's anchors inherit through the real tree, and that
// every reader — market value, the totals' medians, the observation list, the ratio learner and
// `recommend_bid` — leaves the other markets' results out and says so.
//
// Every price is in EUR, the collection's base, so no rate is fetched.

const ts = Date.now();

/** Drive a GET operation exactly as `src/app/api/v1/[...path]/route.ts` does. */
async function get<T>(context: OperationContext, path: string, query: Record<string, string>): Promise<T> {
  const picked = pickMethod(matchPath(path.split("/").filter(Boolean)), "GET");
  assert.ok(picked, `/api/v1/${path} does not accept GET`);
  const params = parseParameters(picked.operation.parameters, {
    path: picked.pathValues,
    query: new URLSearchParams(query),
  });
  return (await picked.operation.handler(context, params)) as T;
}

/** Drive a body-taking operation by name, as the dispatcher does after matching its path. */
async function send<T>(context: OperationContext, name: string, path: Record<string, string>, body: unknown): Promise<T> {
  const operation = OPERATIONS.find((op) => op.name === name);
  assert.ok(operation, `no operation ${name}`);
  const params = parseParameters(operation.parameters, { path, query: new URLSearchParams(), body });
  return (await operation.handler(context, params)) as T;
}

describe("markets and anchoring (#1634)", () => {
  const userId = `test-user-markets-${ts}`;
  let collectionId: string;
  let context: OperationContext;
  let conditionId: string;
  let europeId: string;
  let germanyId: string;
  let danzigId: string;
  let polandId: string;
  /** Danzig, filed under Germany — priced 50.00 MNH. */
  let danzigStampId: string;
  /** Poland — priced 50.00 MNH. */
  let polishStampId: string;
  let platformId: string;
  let houseId: string;
  let sellerId: string;

  function raw(overrides: Partial<PriceObservationRaw> = {}): PriceObservationRaw {
    return {
      conditionId,
      certificateStatusId: null,
      certificateUncertain: false,
      formatId: null,
      price: "40.00",
      currency: "EUR",
      priceBasis: "hammer",
      premiumPercent: "",
      premiumFixed: "",
      soldOn: "2026-03-14",
      platformId,
      platformName: null,
      auctionHouseId: houseId,
      auctionHouseName: null,
      auctionName: "385",
      lotNo: "1203",
      url: "",
      ...overrides,
    };
  }

  async function closedLot(stampId: string, finalPrice: string, saleSellerId = sellerId): Promise<void> {
    const sale = await prisma.auctionSale.create({
      data: { collectionId, sellerId: saleSellerId, platformId, name: `Sale ${finalPrice}`, currency: "EUR" },
    });
    await prisma.auctionLot.create({
      data: {
        auctionSaleId: sale.id,
        auctionLotNo: Math.floor(Math.random() * 1_000_000),
        endsAt: new Date("2026-02-01T12:00:00Z"),
        status: "closed",
        finalPrice,
        lines: { create: [{ stampId, conditionId, quantity: 1 }] },
      },
    });
  }

  before(async () => {
    await prisma.user.create({
      data: { id: userId, name: userId, email: `${userId}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-markets-${ts}`, name: `Markets ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    context = { ownerId: userId, collectionId };

    const vendor = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Europa", currency: "EUR" },
    });
    const editionId = (await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    const area = async (name: string, parentId: string | null) =>
      (
        await prisma.collectionArea.create({
          data: { collectionId, name, parentId, primaryCatalogNameId: catalogName.id },
        })
      ).id;
    europeId = await area("Europe", null);
    germanyId = await area("Germany", europeId);
    danzigId = await area("Danzig", germanyId);
    polandId = await area("Poland", europeId);

    const stamp = async (name: string, areaId: string) => {
      const s = await prisma.stamp.create({ data: { collectionId, name, issuedYear: 1925 } });
      await prisma.stampCollectionArea.create({ data: { stampId: s.id, collectionAreaId: areaId, isPrimary: true } });
      await prisma.stampCatalogPrice.create({
        data: { stampId: s.id, catalogEditionId: editionId, conditionId, price: "50.00", currency: "EUR" },
      });
      return s.id;
    };
    danzigStampId = await stamp("Danzig 5", danzigId);
    polishStampId = await stamp("Poland 5", polandId);

    platformId = (await createContact(userId, collectionId, { name: "Philasearch", platform: true, platformCurrency: "EUR" })).id;
    houseId = (await createContact(userId, collectionId, { name: "Köhler", auctionHouse: true })).id;
    sellerId = (await createContact(userId, collectionId, { name: "Allegro seller", seller: true })).id;
  });

  beforeEach(async () => {
    await prisma.priceObservation.deleteMany({ where: { collectionId } });
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.contact.updateMany({ where: { collectionId }, data: { market: null } });
    await prisma.collectionArea.updateMany({ where: { collectionId }, data: { anchorMarkets: [] } });
    await prisma.collection.update({ where: { id: collectionId }, data: { homeMarket: "PL" } });
  });

  after(async () => {
    await prisma.priceObservation.deleteMany({ where: { collectionId } });
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("counts everything as before while no contact names a market and no area names anchors", async () => {
    await createPriceObservation(userId, polishStampId, raw({ price: "40" }));
    await createPriceObservation(userId, danzigStampId, raw({ price: "40" }));
    await closedLot(polishStampId, "20.00");

    const [polish] = await getStampMarketValue(userId, collectionId, polishStampId);
    assert.equal(polish.n, 2);
    assert.deepEqual(polish.markets, [{ market: null, count: 2 }]);
    assert.deepEqual(polish.hintMarkets, []);
    assert.equal((await getStampMarketValue(userId, collectionId, danzigStampId)).length, 1);
  });

  it("takes an observation's market from its house, else its platform", async () => {
    const platform = await updateContact(userId, platformId, {
      name: "Philasearch",
      platform: true,
      platformCurrency: "EUR",
      market: "de",
    });
    assert.equal(platform.market, "DE");
    const viaPlatform = await createPriceObservation(userId, polishStampId, raw({ auctionHouseId: null }));
    await updateContact(userId, houseId, { name: "Köhler", auctionHouse: true, market: "AT" });
    const viaHouse = await createPriceObservation(userId, polishStampId, raw());

    const { observations } = await getStampPriceObservations(userId, polishStampId);
    const marketOf = (id: string) => observations.find((o) => o.id === id)?.market;
    assert.equal(marketOf(viaPlatform), "DE");
    assert.equal(marketOf(viaHouse), "AT");
  });

  it("leaves a foreign result out of Polish material, says why, and still lists it", async () => {
    await updateContact(userId, houseId, { name: "Köhler", auctionHouse: true, market: "DE" });
    await createPriceObservation(userId, polishStampId, raw({ price: "400" }));
    await closedLot(polishStampId, "20.00");

    const [value] = await getStampMarketValue(userId, collectionId, polishStampId);
    assert.equal(value.n, 1);
    assert.equal(value.median, "20.00");
    assert.deepEqual(value.hintMarkets, [{ market: "DE", count: 1 }]);

    const evidence = await getStampMarketEvidenceByStamp(userId, polishStampId);
    assert.deepEqual(evidence.anchoringMarkets, ["PL"]);
    assert.equal(evidence.hints.length, 1);
    assert.equal(evidence.hints[0].kind, "observation");

    const { observations } = await getStampPriceObservations(userId, polishStampId);
    assert.equal(observations[0].notCounted, "other-market");
    assert.equal(observations[0].countedAmount, null);

    // The totals read the same projection, so they leave it out too.
    const medians = await readMarketMedians(collectionId, [polishStampId]);
    assert.deepEqual([...medians.values()], [20]);
  });

  it("anchors German material on the markets set on Germany, inherited by Danzig", async () => {
    await updateCollectionArea(userId, germanyId, {
      name: "Germany",
      parentId: europeId,
      anchorMarkets: ["de", "AT"],
    });
    await updateContact(userId, houseId, { name: "Köhler", auctionHouse: true, market: "DE" });
    await createPriceObservation(userId, danzigStampId, raw({ price: "40" }));
    // A lot from a seller with no market counts as the home market — PL — which Danzig does not
    // anchor on.
    await closedLot(danzigStampId, "10.00");

    const evidence = await getStampMarketEvidenceByStamp(userId, danzigStampId);
    assert.deepEqual(evidence.anchoringMarkets, ["AT", "DE"]);
    assert.equal(evidence.values.length, 1);
    assert.equal(evidence.values[0].median, "40.00");
    assert.deepEqual(evidence.values[0].markets, [{ market: "DE", count: 1 }]);
    assert.deepEqual(evidence.values[0].hintMarkets, [{ market: null, count: 1 }]);
    assert.equal(evidence.hints[0].kind, "lot");

    const areas = await getCollectionAreas(userId, collectionId);
    assert.deepEqual(areas.find((a) => a.id === germanyId)?.anchorMarkets, ["AT", "DE"]);
    assert.deepEqual(areas.find((a) => a.id === danzigId)?.anchorMarkets, []);
  });

  it("takes an own lot's market from its sale's seller, else the sale's platform", async () => {
    await updateCollectionArea(userId, polandId, { name: "Poland", parentId: europeId, anchorMarkets: ["CH"] });
    await updateContact(userId, platformId, { name: "Philasearch", platform: true, platformCurrency: "EUR", market: "CH" });
    await closedLot(polishStampId, "30.00");
    let [value] = await getStampMarketValue(userId, collectionId, polishStampId);
    assert.deepEqual(value.lots.map((lot) => lot.market), ["CH"]);

    // The seller names a market of its own: it wins over the platform's, and the lot stops counting.
    await updateContact(userId, sellerId, { name: "Allegro seller", seller: true, market: "PL" });
    assert.deepEqual(await getStampMarketValue(userId, collectionId, polishStampId), []);
    const evidence = await getStampMarketEvidenceByStamp(userId, polishStampId);
    assert.equal(evidence.hints.length, 1);
    assert.equal(evidence.hints[0].kind === "lot" && evidence.hints[0].lot.market, "PL");

    // An update that does not mention the anchors leaves them alone.
    await updateCollectionArea(userId, polandId, { name: "Poland", parentId: europeId });
    [value] = (await getStampMarketEvidenceByStamp(userId, polishStampId)).values;
    assert.equal(value, undefined);
    assert.deepEqual(
      (await getCollectionAreas(userId, collectionId)).find((a) => a.id === polandId)?.anchorMarkets,
      ["CH"]
    );
  });

  it("anchors an area naming nothing on the collection's home market, which can be changed", async () => {
    await updateContact(userId, houseId, { name: "Köhler", auctionHouse: true, market: "DE" });
    await createPriceObservation(userId, polishStampId, raw());
    assert.deepEqual(await getStampMarketValue(userId, collectionId, polishStampId), []);

    await setCollectionHomeMarket(userId, collectionId, "de");
    const [value] = await getStampMarketValue(userId, collectionId, polishStampId);
    assert.equal(value.n, 1);
    await assert.rejects(() => setCollectionHomeMarket(userId, collectionId, "Germany"));
  });

  it("teaches the realization ratio only from results its own stamp counts", async () => {
    await updateContact(userId, houseId, { name: "Köhler", auctionHouse: true, market: "DE" });
    await createPriceObservation(userId, polishStampId, raw({ price: "40" }));
    assert.equal((await loadRealizationRatios(collectionId)).observationCount, 0);

    await updateCollectionArea(userId, polandId, { name: "Poland", parentId: europeId, anchorMarkets: ["DE"] });
    assert.equal((await loadRealizationRatios(collectionId)).observationCount, 1);
  });

  it("refuses a market that is not a two-letter country code", async () => {
    await assert.rejects(() =>
      updateContact(userId, houseId, { name: "Köhler", auctionHouse: true, market: "Deutschland" })
    );
    await assert.rejects(() =>
      updateCollectionArea(userId, polandId, { name: "Poland", parentId: europeId, anchorMarkets: ["POL"] })
    );
  });

  it("states in `recommend_bid` the results it used with their market, and how many it left out", async () => {
    await updateContact(userId, houseId, { name: "Köhler", auctionHouse: true, market: "DE" });
    await createPriceObservation(userId, polishStampId, raw({ price: "400" }));
    await closedLot(polishStampId, "20.00");

    const answer = await get<AgentBidRecommendation>(context, "bid-recommendation", {
      stamp_ids: polishStampId,
      condition: "MNH",
      currency: "EUR",
    });
    const [line] = answer.lines;
    assert.equal(line.anchoredOn, "market");
    assert.equal(line.unitValue, "20.00");
    assert.equal(line.marketResults?.length, 1);
    assert.equal(line.marketResults?.[0].kind, "lot");
    assert.equal(line.marketResults?.[0].market, undefined);
    assert.deepEqual(line.notCounted, [{ market: "DE", results: 1 }]);
  });

  it("sets and clears an area's anchors through the agent API, and reads them back", async () => {
    const set = await send<AgentArea>(context, "update_area", { area_id: germanyId }, { anchor_markets: ["de", "ch"] });
    assert.deepEqual(set.anchorMarkets, ["CH", "DE"]);
    assert.deepEqual(set.anchoringMarkets, ["CH", "DE"]);

    const listed = await get<{ items: AgentArea[] }>(context, "areas", {});
    const danzig = listed.items.find((a) => a.areaId === danzigId)!;
    assert.equal(danzig.anchorMarkets, undefined);
    assert.deepEqual(danzig.anchoringMarkets, ["CH", "DE"]);

    const cleared = await send<AgentArea>(context, "update_area", { area_id: germanyId }, { clear: ["anchor_markets"] });
    assert.equal(cleared.anchorMarkets, undefined);
    assert.equal(cleared.anchoringMarkets, undefined);

    await assert.rejects(() =>
      send(context, "update_area", { area_id: germanyId }, { anchor_markets: ["Germany"] })
    );
  });
});
