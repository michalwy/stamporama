import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createSale, listFreeExtraCandidates } from "../../src/lib/sales";
import { NO_FREE_EXTRA_FILTERS, type FreeExtraFilters } from "../../src/lib/free-extra-filters";

// *Add free extras* filters its candidates (#2423), against a real database: area, year, condition,
// certificate and format narrow the loose copies and the whole sets alike, the rail's year facets are
// counted over every other filter, and which copies are above their sets is still counted over the
// whole pool — a filter never makes a set look broken or whole.

const ts = Date.now();

describe("free extras filtered by area, year, condition, certificate and format (#2423)", () => {
  let userId: string;
  let collectionId: string;
  let saleId: string;
  let poland: string;
  let france: string;
  let used: string;
  let mint: string;
  let certified: string;
  const copies: Record<string, string[]> = { A: [], B: [], C: [], D: [], F: [] };

  before(async () => {
    userId = `test-user-free-extras-filters-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-free-extras-filters-${ts}`, name: "Free extras filters", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const catalogName = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Europa", currency: "EUR" },
    });
    const editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2026 } })
    ).id;
    const area = async (name: string) => {
      const id = (
        await prisma.collectionArea.create({
          data: { collectionId, name, primaryCatalogNameId: catalogName.id },
        })
      ).id;
      await prisma.collectionAreaCatalog.create({
        data: { collectionAreaId: id, catalogNameId: catalogName.id },
      });
      return id;
    };
    poland = await area("Poland");
    france = await area("France");
    used = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    mint = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Mint", abbreviation: "M", sortOrder: 1 } })
    ).id;
    certified = (
      await prisma.certificateStatus.create({ data: { collectionId, name: "Certified", abbreviation: "Cert", sortOrder: 0 } })
    ).id;
    const platformId = (await prisma.platform.create({ data: { collectionId, name: "Fair" } })).id;

    // Poland: a series A B C of 1955 held A×1, B×2, C×1 — one complete set and one B above it — and a
    // loose D of 1950. France: one mint F of 1960.
    const held: [string, string, number | null, string, string, number][] = [
      ["A", poland, 1955, used, "0.50", 1],
      ["B", poland, 1955, used, "0.30", 2],
      ["C", poland, 1955, used, "0.20", 1],
      ["D", poland, 1950, used, "0.10", 1],
      ["F", france, 1960, mint, "0.40", 1],
    ];
    const stampId: Record<string, string> = {};
    for (const [name, areaId, issuedYear, conditionId, price, count] of held) {
      stampId[name] = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Stamp ${name}`,
            issuedYear,
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
      await prisma.stampCatalogPrice.create({
        data: {
          stampId: stampId[name],
          catalogEditionId: editionId,
          conditionId,
          certificateStatusId: null,
          formatId: null,
          price,
          currency: "EUR",
        },
      });
      for (let i = 0; i < count; i++) {
        copies[name].push(
          (
            await createItem(userId, collectionId, {
              stampId: stampId[name],
              conditionId,
              inCollection: false,
              forSale: true,
              forTrade: false,
            })
          ).id
        );
      }
    }
    await prisma.checklist.create({
      data: {
        collectionId,
        name: "Definitives",
        stamps: {
          create: ["A", "B", "C"].map((name, sortOrder) => ({ stampId: stampId[name], sortOrder })),
        },
      },
    });

    saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-11-04"),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const stampOf = (itemId: string) => Object.keys(copies).find((name) => copies[name].includes(itemId));
  const read = async (filters: Partial<FreeExtraFilters>) => {
    const result = await listFreeExtraCandidates(userId, saleId, false, { ...NO_FREE_EXTRA_FILTERS, ...filters });
    return {
      series: result.series.map((s) => s.copies.map((c) => stampOf(c.item.id)).join("")),
      loose: result.candidates.map((c) => stampOf(c.item.id)),
      yearFacets: result.yearFacets,
    };
  };

  it("offers everything with no filter, the year facets counting each copy of a set", async () => {
    assert.deepEqual(await read({}), {
      series: ["ABC"],
      loose: ["D", "B", "F"],
      yearFacets: [
        { year: 1950, count: 1 },
        { year: 1955, count: 4 },
        { year: 1960, count: 1 },
      ],
    });
  });

  it("narrows by area, the year facets following it", async () => {
    assert.deepEqual(await read({ areaIds: [france] }), {
      series: [],
      loose: ["F"],
      yearFacets: [{ year: 1960, count: 1 }],
    });
    const polish = await read({ areaIds: [poland] });
    assert.deepEqual([polish.series, polish.loose], [["ABC"], ["D", "B"]]);
  });

  it("narrows by year without narrowing the year facets", async () => {
    const result = await read({ year: "1955" });
    assert.deepEqual([result.series, result.loose], [["ABC"], ["B"]]);
    assert.equal(result.yearFacets.length, 3);
    const range = await read({ year: "1950-1955" });
    assert.deepEqual([range.series, range.loose], [["ABC"], ["D", "B"]]);
  });

  it("narrows by condition, certificate and format with the Copies list's values", async () => {
    const mintOnly = await read({ conditionIds: [mint] });
    assert.deepEqual([mintOnly.series, mintOnly.loose], [[], ["F"]]);
    const usedOnly = await read({ conditionIds: [used] });
    assert.deepEqual([usedOnly.series, usedOnly.loose], [["ABC"], ["D", "B"]]);
    const noCertificate = await read({ certificateStatusIds: ["none"] });
    assert.deepEqual([noCertificate.series, noCertificate.loose], [["ABC"], ["D", "B", "F"]]);
    const withCertificate = await read({ certificateStatusIds: [certified] });
    assert.deepEqual([withCertificate.series, withCertificate.loose], [[], []]);
    const singles = await read({ formatIds: ["single"] });
    assert.deepEqual([singles.series, singles.loose], [["ABC"], ["D", "B", "F"]]);
  });

  it("still counts the sets over the whole pool, so a filter never frees a copy of one", async () => {
    // Under 1955 alone the set and its spare B are the same as unfiltered: one B above the set.
    const result = await read({ areaIds: [poland], year: "1955", conditionIds: [used] });
    assert.deepEqual([result.series, result.loose], [["ABC"], ["B"]]);
  });
});
