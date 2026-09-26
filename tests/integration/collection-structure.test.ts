import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { countItems, createItem } from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import { getOverviewHoldings } from "../../src/lib/overview";
import { getCollectionStructure, type CollectionStructure } from "../../src/lib/collection-structure";
import type { StructureDimension, StructureHeading } from "../../src/lib/collection-structure-rules";
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
