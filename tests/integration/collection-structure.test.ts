import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { countItems, createItem, getHoldingsValuation } from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import { createLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { getOverviewHoldings, getOverviewValue } from "../../src/lib/overview";
import { getCollectionStructure, type CollectionStructure } from "../../src/lib/collection-structure";
import {
  structureValuesOf,
  type StructureDimension,
  type StructureHeading,
  type StructureValues,
} from "../../src/lib/collection-structure-rules";
import { copiesListQueryParams } from "../../src/lib/copies-list-url";
import { exactCopiesListHref } from "../../src/app/c/[collectionSlug]/inventory/copies-list-filters";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";

// The collection structure screen (#1401), against a database. Its one promise is that **every count
// is the Copies list's count of the rows its link opens** — so every heading, cell and total of
// every view tried here is followed to its link, read back the way the Copies list reads its own
// address (`copiesListQueryParams` → `readItemFilters`), and counted with `countItems`.

const ts = Date.now();

describe("collection structure (#1401)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  const ids: Record<string, string> = {};

  async function copy(
    stamp: string,
    data: {
      condition?: string;
      certificate?: string;
      format?: string;
      location?: string;
      inCollection?: boolean;
      forSale?: boolean;
      forTrade?: boolean;
      deliveryState?: string;
      tags?: string[];
    } = {}
  ): Promise<string> {
    const { id } = await createItem(userId, collectionId, {
      stampId: ids[stamp],
      conditionId: ids[data.condition ?? "used"],
      certificateStatusId: data.certificate ? ids[data.certificate] : undefined,
      formatId: data.format ? ids[data.format] : undefined,
      locationId: data.location ? ids[data.location] : undefined,
      inCollection: data.inCollection,
      forSale: data.forSale,
      forTrade: data.forTrade,
      deliveryState: data.deliveryState,
    });
    for (const tag of data.tags ?? []) {
      await prisma.itemTag.create({ data: { itemId: id, tagId: ids[tag] } });
    }
    return id;
  }

  before(async () => {
    userId = `test-user-structure-${ts}`;
    strangerId = `test-user-structure-stranger-${ts}`;
    for (const id of [userId, strangerId]) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-structure-${ts}`,
          name: `Collection structure-${ts}`,
          baseCurrency: "PLN",
          ownerId: userId,
        },
      })
    ).id;

    const make = async (key: string, create: () => Promise<{ id: string }>) => {
      ids[key] = (await create()).id;
    };
    await make("mint", () =>
      prisma.stampCondition.create({ data: { collectionId, name: "Mint", abbreviation: "M", sortOrder: 0 } })
    );
    await make("used", () =>
      prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 } })
    );
    await make("expert", () =>
      prisma.certificateStatus.create({ data: { collectionId, name: "Expertised", abbreviation: "E", sortOrder: 0 } })
    );
    await make("pair", () =>
      prisma.stampFormat.create({ data: { collectionId, name: "Pair", abbreviation: "P", sortOrder: 0 } })
    );
    await make("forgery", () =>
      prisma.stampSubtype.create({
        data: { collectionId, name: "Forgery", actsAsVariant: false, sortOrder: 0 },
      })
    );
    // Europe ⊃ Poland ⊃ Galicia, and Asia: a tree deep enough to drill twice.
    await make("europe", () => prisma.collectionArea.create({ data: { collectionId, name: "Europe" } }));
    await make("poland", () =>
      prisma.collectionArea.create({ data: { collectionId, name: "Poland", parentId: ids.europe } })
    );
    await make("galicia", () =>
      prisma.collectionArea.create({ data: { collectionId, name: "Galicia", parentId: ids.poland } })
    );
    await make("asia", () => prisma.collectionArea.create({ data: { collectionId, name: "Asia" } }));
    await make("cabinet", () =>
      prisma.location.create({ data: { collectionId, name: "Cabinet" } })
    );
    await make("albumA", () =>
      prisma.location.create({ data: { collectionId, name: "Album A", parentId: ids.cabinet } })
    );
    await make("birds", () => prisma.tag.create({ data: { collectionId, name: "birds" } }));
    await make("check", () => prisma.tag.create({ data: { collectionId, name: "to check" } }));

    const stamp = async (key: string, opts: { areas?: string[]; year?: number; subtype?: string }) =>
      make(key, () =>
        prisma.stamp.create({
          data: {
            collectionId,
            name: key,
            issuedYear: opts.year,
            subtypeId: opts.subtype ? ids[opts.subtype] : undefined,
            stampAreaLinks: {
              create: (opts.areas ?? []).map((area, i) => ({
                collectionAreaId: ids[area],
                isPrimary: i === 0,
              })),
            },
          },
        })
      );
    await stamp("s1952", { areas: ["poland"], year: 1952 });
    await stamp("s1958", { areas: ["galicia"], year: 1958 });
    await stamp("s1963", { areas: ["asia"], year: 1963 });
    // Filed in two areas — counted under both.
    await stamp("sTwo", { areas: ["poland", "asia"], year: 1955 });
    // Filed on Europe itself, in none of its sub-areas.
    await stamp("sEurope", { areas: ["europe"], year: 1961 });
    await stamp("sNowhere", { year: undefined });
    await stamp("sForgery", { areas: ["galicia"], year: 1952, subtype: "forgery" });

    await copy("s1952", { condition: "mint", tags: ["birds"], location: "albumA" });
    await copy("s1952", { forSale: true, tags: ["birds", "check"], location: "cabinet" });
    await copy("s1958", { certificate: "expert", format: "pair", inCollection: false, forTrade: true });
    await copy("s1963", { deliveryState: "ordered", tags: ["check"] });
    await copy("sTwo", { deliveryState: "in_transit", location: "albumA" });
    await copy("sEurope", { condition: "mint", deliveryState: "to_sort" });
    await copy("sNowhere", { forSale: true });
    await copy("sForgery", { forSale: true, certificate: "expert" });
    // Out of the collection and offered nowhere: in no disposition row.
    await copy("s1963", { inCollection: false });
    // A cover carrying stamps of two areas and two decades: one copy, read off its leading stamp.
    const cover = await copy("s1952", { format: "pair" });
    await setItemStamps(userId, cover, [{ stampId: ids.s1952 }, { stampId: ids.s1963 }]);
    // No longer held (#396): not counted anywhere.
    const lost = await copy("s1958", { forSale: true });
    await prisma.item.update({
      where: { id: lost },
      data: { disposedAt: new Date(), disposalReason: "lost" },
    });
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  const subtree = { includeSubAreas: true, includeSubLocations: true };

  async function structure(
    rows: StructureDimension,
    columns: StructureDimension | null,
    url: Record<string, string> = {},
    prefs = subtree
  ): Promise<CollectionStructure> {
    return getCollectionStructure(
      userId,
      collectionId,
      { url: new URLSearchParams(url), rows, columns, ...prefs },
      readItemFilters
    );
  }

  /** How many copies the Copies list shows at the address the screen links to. */
  async function listed(
    url: Record<string, string>,
    segments: StructureHeading[],
    prefs = subtree
  ): Promise<number> {
    const href = exactCopiesListHref(
      "/c/x",
      Object.assign({}, url, ...segments.map((s) => s.params))
    );
    const address = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    const areas = await prisma.collectionArea.findMany({
      where: { collectionId },
      select: { id: true, parentId: true },
    });
    return countItems(
      userId,
      collectionId,
      readItemFilters(copiesListQueryParams(address, { areas, ...prefs, catalogVendors: [] }))
    );
  }

  /** Every figure of a view against the list its link opens. */
  async function assertEveryCountIsTheList(
    view: CollectionStructure,
    url: Record<string, string> = {},
    prefs = subtree
  ) {
    const where = `${view.rowDimension}×${view.columnDimension ?? "—"} ${JSON.stringify(url)}`;
    assert.equal(view.total, await listed(url, [], prefs), `${where} total`);
    for (const row of view.rows) {
      assert.equal(row.count, await listed(url, [row], prefs), `${where} row ${row.label}`);
      for (const [j, column] of view.columns.entries()) {
        assert.equal(
          row.cells[j],
          await listed(url, [row, column], prefs),
          `${where} cell ${row.label}×${column.label}`
        );
      }
    }
    for (const column of view.columns) {
      assert.equal(column.count, await listed(url, [column], prefs), `${where} column ${column.label}`);
    }
  }

  it("opens on the holdings tile's total, leaving out what is no longer held", async () => {
    const view = await structure("disposition", null);
    assert.equal(view.total, 10);
    assert.equal(view.total, (await getOverviewHoldings(userId, collectionId)).total);
  });

  it("links every count, for every dimension on its own, to a list showing exactly that many", async () => {
    for (const rows of [
      "disposition",
      "condition",
      "certificate",
      "format",
      "subtype",
      "area",
      "year",
      "tags",
      "location",
    ] as const) {
      await assertEveryCountIsTheList(await structure(rows, null));
    }
  });

  it("links every cell of a crossing to a list showing exactly that many", async () => {
    for (const [rows, columns] of [
      ["disposition", "condition"],
      ["area", "year"],
      ["tags", "certificate"],
      ["location", "format"],
      ["subtype", "tags"],
    ] as const) {
      await assertEveryCountIsTheList(await structure(rows, columns));
    }
  });

  it("drills into areas, decades and locations level by level", async () => {
    const europe = { areaId: ids.europe };
    const areasInEurope = await structure("area", null, europe);
    assert.deepEqual(
      areasInEurope.rows.map((r) => [r.label, r.count]),
      [["Poland", 6]]
    );
    // The copy filed on Europe itself is in no sub-area, and the screen says so.
    assert.equal(areasInEurope.outsideRows, 1);
    await assertEveryCountIsTheList(areasInEurope, europe);

    const fifties = { year: "all", decade: "1950s" };
    const years = await structure("year", "area", fifties);
    assert.deepEqual(
      years.rows.map((r) => r.label),
      ["1952", "1955", "1958"]
    );
    await assertEveryCountIsTheList(years, fifties);

    const cabinet = { locationId: ids.cabinet };
    await assertEveryCountIsTheList(await structure("location", "disposition", cabinet), cabinet);
  });

  it("keeps every count equal to its list under filters, no-value segments and tag modes", async () => {
    const urls: Record<string, string>[] = [
      { conditionIds: `${ids.mint},${ids.used}`, forSale: "true" },
      { tagIds: `${ids.birds},${ids.check}`, tagMode: "all" },
      { tagIds: `none,${ids.check}` },
      { certificateStatusIds: "none", areaId: "none" },
      { locationId: "none", year: "none" },
      { deliveryStates: "ordered,in_transit", multiStamp: "exclude" },
    ];
    for (const url of urls) {
      await assertEveryCountIsTheList(await structure("tags", "disposition", url), url);
      await assertEveryCountIsTheList(await structure("area", "location", url), url);
    }
  });

  it("reads a copy of several stamps off its leading stamp, as the list's filters do", async () => {
    const view = await structure("area", null);
    const counts = Object.fromEntries(view.rows.map((r) => [r.label, r.count]));
    // Europe: two 1952 loose copies, the cover, 1958, sTwo, sEurope, the forgery. Asia: 1963 twice
    // and sTwo — the cover's second stamp is Asian and does not bring it here.
    assert.equal(counts.Europe, 7);
    assert.equal(counts.Asia, 3);
    assert.equal(counts["No area"], 1);
  });

  it("follows the collector's this-area-only switch, as the list does", async () => {
    const only = { includeSubAreas: false, includeSubLocations: false };
    await assertEveryCountIsTheList(await structure("area", null, {}, only), {}, only);
    const inPoland = { areaId: ids.poland };
    const view = await structure("area", "location", inPoland, only);
    assert.deepEqual(view.rows.map((r) => r.label), ["Poland"]);
    await assertEveryCountIsTheList(view, inPoland, only);
  });

  it("refuses a collection the caller does not own", async () => {
    await assert.rejects(
      getCollectionStructure(
        strangerId,
        collectionId,
        { url: new URLSearchParams(), rows: "condition", columns: null, ...subtree },
        readItemFilters
      )
    );
  });
});

// The values beside each count (#1402). A segment's catalogue value, market value and cost are the
// figures the Copies list's own bar states at its link — `getHoldingsValuation` under the filters the
// link opens — and with no filter the total's are the Overview's *Holdings value*.
//
// Base PLN, catalogue prices in EUR at 4.25, a fresh rate table seeded so nothing is fetched.

describe("collection structure values (#1402)", () => {
  let userId: string;
  let collectionId: string;
  const ids: Record<string, string> = {};

  before(async () => {
    userId = `test-user-structure-values-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-structure-values-${ts}`,
          name: `Collection structure-values-${ts}`,
          baseCurrency: "PLN",
          ownerId: userId,
        },
      })
    ).id;
    await prisma.exchangeRate.createMany({
      data: [
        ["EUR", "1"],
        ["PLN", "4.25"],
      ].map(([toCurrency, rate]) => ({
        collectionId,
        fromCurrency: "EUR",
        toCurrency,
        rate,
        fetchedAt: new Date(),
      })),
    });
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogNameId = (
      await prisma.catalogName.create({
        data: { vendorId: vendor.id, name: "Michel Europa", currency: "EUR" },
      })
    ).id;
    const editionId = (await prisma.catalogEdition.create({ data: { catalogNameId, year: 2024 } })).id;
    for (const [key, name, sortOrder] of [
      ["mint", "Mint", 0],
      ["used", "Used", 1],
    ] as const) {
      ids[key] = (
        await prisma.stampCondition.create({
          data: { collectionId, name, abbreviation: name[0], sortOrder },
        })
      ).id;
    }
    for (const name of ["birds", "check"]) {
      ids[name] = (await prisma.tag.create({ data: { collectionId, name } })).id;
    }
    for (const name of ["Poland", "Asia"]) {
      ids[name] = (
        await prisma.collectionArea.create({
          data: { collectionId, name, primaryCatalogNameId: catalogNameId },
        })
      ).id;
    }

    const stamp = async (key: string, area: string, prices: Record<string, string>) => {
      ids[key] = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: key,
            issuedYear: 1950,
            stampAreaLinks: { create: [{ collectionAreaId: ids[area], isPrimary: true }] },
          },
        })
      ).id;
      for (const [condition, price] of Object.entries(prices)) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: ids[key],
            catalogEditionId: editionId,
            conditionId: ids[condition],
            certificateStatusId: null,
            formatId: null,
            price,
            currency: "EUR",
          },
        });
      }
    };
    await stamp("priced", "Poland", { used: "10.00", mint: "20.00" });
    await stamp("cheap", "Poland", { used: "2.00" });
    await stamp("unpriced", "Asia", {});

    const copy = async (
      stampKey: string,
      data: {
        condition?: string;
        tags?: string[];
        forSale?: boolean;
        deliveryState?: string;
        costBasis?: string;
        lotId?: string;
      } = {}
    ) => {
      const { id } = await createItem(userId, collectionId, {
        stampId: ids[stampKey],
        conditionId: ids[data.condition ?? "used"],
        forSale: data.forSale,
        deliveryState: data.deliveryState,
      });
      await prisma.item.update({
        where: { id },
        data: { costBasis: data.costBasis ?? null, lotId: data.lotId ?? null },
      });
      for (const tag of data.tags ?? []) {
        await prisma.itemTag.create({ data: { itemId: id, tagId: ids[tag] } });
      }
      return id;
    };

    const opening = await createPurchase(userId, collectionId, {
      kind: "opening_balance",
      title: "Opening",
      purchasedAt: "2026-09-01",
      currency: "PLN",
    });
    const openingLot = await createLot(userId, opening.id, 5, null);
    const order = await createPurchase(userId, collectionId, {
      purchasedAt: "2026-09-01",
      currency: "PLN",
    });
    // An open lot with a price: its copy's cost is pending.
    const openLot = await createLot(userId, order.id, 9, null);

    // Catalogue 42.50, market 50.00, cost 30.00; tagged twice.
    await copy("priced", { tags: ["birds", "check"], costBasis: "30.00" });
    // Catalogue 85.00, no auction evidence for mint, no cost recorded.
    await copy("priced", { condition: "mint", tags: ["birds"], forSale: true });
    // Catalogue 8.50, from an opening balance valued at 5.00.
    await copy("cheap", { costBasis: "5.00", lotId: openingLot });
    // Catalogue 8.50, cost pending on the open lot.
    await copy("cheap", { lotId: openLot });
    // Unpriced, cost 7.00.
    await copy("unpriced", { costBasis: "7.00" });
    // Never arrived: counted, but not in hand, so in none of the figures.
    await copy("priced", { deliveryState: "not_delivered", costBasis: "12.00" });
    // No longer held (#396): not counted at all.
    const lost = await copy("priced", { costBasis: "99.00" });
    await prisma.item.update({
      where: { id: lost },
      data: { disposedAt: new Date(), disposalReason: "lost" },
    });

    // What copies like the first fetched at auction: one closed lot at 50.00.
    const sellerId = (await prisma.contact.create({ data: { collectionId, name: "Seller", seller: true } })).id;
    const platformId = (await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })).id;
    const sale = await prisma.auctionSale.create({
      data: { collectionId, sellerId, platformId, name: "Sale", currency: "PLN" },
    });
    await prisma.auctionLot.create({
      data: {
        auctionSaleId: sale.id,
        auctionLotNo: 14020,
        lotNo: "1",
        endsAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        status: "closed",
        finalPrice: "50.00",
        lines: { create: [{ stampId: ids.priced, conditionId: ids.used, quantity: 1 }] },
      },
    });
  });

  after(async () => {
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const prefs = { includeSubAreas: true, includeSubLocations: true };

  async function structure(
    rows: StructureDimension,
    columns: StructureDimension | null,
    url: Record<string, string> = {}
  ): Promise<CollectionStructure> {
    return getCollectionStructure(
      userId,
      collectionId,
      { url: new URLSearchParams(url), rows, columns, ...prefs },
      readItemFilters
    );
  }

  /** The held figures — the write-off's count is left out, since the list's bar lifts the disposal
   *  exclusion into it (#396) and so counts copies the screen never shows. */
  function figures(values: StructureValues | null) {
    assert.ok(values, "values stated");
    return {
      catalogue: values.catalogue,
      market: values.market,
      cost: values.cost,
      opening: values.opening,
    };
  }

  /** The values the Copies list's own bar states at the address a heading links to. */
  async function listed(url: Record<string, string>, segments: StructureHeading[]) {
    const href = exactCopiesListHref("/c/x", Object.assign({}, url, ...segments.map((s) => s.params)));
    const address = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    const areas = await prisma.collectionArea.findMany({
      where: { collectionId },
      select: { id: true, parentId: true },
    });
    const summary = await getHoldingsValuation(
      userId,
      collectionId,
      readItemFilters(copiesListQueryParams(address, { areas, ...prefs, catalogVendors: [] }))
    );
    return figures(structureValuesOf(summary));
  }

  async function assertEveryValueIsTheList(view: CollectionStructure, url: Record<string, string> = {}) {
    const where = `${view.rowDimension}×${view.columnDimension ?? "—"} ${JSON.stringify(url)}`;
    assert.deepEqual(figures(view.totalValues), await listed(url, []), `${where} total`);
    for (const row of view.rows) {
      if (row.count > 0) {
        assert.deepEqual(figures(row.values), await listed(url, [row]), `${where} row ${row.label}`);
      }
      for (const [j, column] of view.columns.entries()) {
        if (row.cells[j] === 0) continue;
        assert.deepEqual(
          figures(row.cellValues[j]),
          await listed(url, [row, column]),
          `${where} cell ${row.label}×${column.label}`
        );
      }
    }
    for (const column of view.columns) {
      if (column.count === 0) continue;
      assert.deepEqual(figures(column.values), await listed(url, [column]), `${where} column ${column.label}`);
    }
  }

  it("states the Overview's holdings value as its total, with no filter applied", async () => {
    const view = await structure("disposition", null);
    const { holdings } = await getOverviewValue(userId, collectionId);
    assert.equal(view.baseCurrency, "PLN");
    assert.deepEqual(figures(view.totalValues), figures(structureValuesOf(holdings)));
    assert.deepEqual(figures(view.totalValues), {
      catalogue: { amount: "144.50", unpriced: 1, unconvertible: 0 },
      market: { amount: "50.00", noEvidence: 4 },
      cost: { amount: "37.00", pending: 1, none: 1 },
      opening: { amount: "5.00", copies: 1, pending: 0, none: 0 },
    });
    // The copy that never arrived is counted, and said to be out of every figure.
    assert.equal(view.total, 6);
    assert.equal(view.totalValues?.notHeld, 1);
  });

  it("carries a copy's values into every segment it is in, and into the total once", async () => {
    const view = await structure("tags", null);
    const byTag = Object.fromEntries(view.rows.map((r) => [r.label, r.values?.catalogue.amount]));
    assert.deepEqual(byTag, { birds: "127.50", check: "42.50", "No tags": "17.00" });
    assert.equal(view.totalValues?.catalogue.amount, "144.50");
  });

  it("states at every heading, cell and total what the Copies list's bar states at its link", async () => {
    for (const [rows, columns] of [
      ["condition", null],
      ["tags", "condition"],
      ["area", "disposition"],
      ["disposition", "tags"],
    ] as const) {
      await assertEveryValueIsTheList(await structure(rows, columns));
    }
    const tagged = { tagIds: ids.birds };
    await assertEveryValueIsTheList(await structure("condition", "area", tagged), tagged);
  });
});
