import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { listItemsPaginated, type ItemListFiltersPaginated } from "../../src/lib/items";
import { createPurchase } from "../../src/lib/purchases";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";
import type { CopyListSortKey } from "../../src/lib/copy-list-sort";

// The Copies list sorts by date added, catalogue number, issue date, stamp name, issue name, copy
// number, catalogue value and cost, each either way (#2300) — across pages, under a filter, with the
// copies lacking the figure last, and with the figures the rows themselves show.
//
// Four stamps:
//  - S10 — Mi 10, *Alpha*, 1950, 4 EUR, in issue *Zeta*
//  - S2  — Mi 2, *Beta*, 1960, 2 EUR, in issue *Alpha*
//  - S2a — Mi 2a (a variant of 2), *Gamma*, 1940, no price, in no issue
//  - SX  — no number, *Delta*, no year, 8 EUR, in no issue
// Six copies, numbered 1–6 and added on days 3, 1, 5, 2, 4, 6:
//  c1 S10, cost 1.50 · c2 S2, no cost · c3 S2a, cost 5.00 · c4 SX, no cost
//  c5 S2, on an open lot (an estimated cost) · c6 S10, cost 1.50

const TS = Date.now();

describe("the Copies list's sort (#2300)", () => {
  let userId: string;
  let collectionId: string;
  let zetaIssueId: string;
  const c: Record<string, string> = {};

  before(async () => {
    userId = `test-user-copies-sort-${TS}`;
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
        data: { slug: `col-copies-sort-${TS}`, name: "Copies sort", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    const edition = await prisma.catalogEdition.create({
      data: { catalogNameId: catalogName.id, year: 2024 },
    });
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
    });
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const issue = async (name: string, issueNo: number) =>
      (
        await prisma.issue.create({
          data: { collectionId, issueNo, collectionAreaId: area.id, name, year: 1950 },
        })
      ).id;
    zetaIssueId = await issue("Zeta", 1);
    const alphaIssueId = await issue("Alpha", 2);

    const stamp = async (
      name: string,
      number: string | null,
      issuedYear: number | null,
      price: string | null,
      issueId: string | null
    ) => {
      const id = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name,
            issuedYear,
            primaryCatalogSortKey: catalogSortKeyOf(number),
          },
        })
      ).id;
      await prisma.stampCollectionArea.create({
        data: { stampId: id, collectionAreaId: area.id, isPrimary: true },
      });
      if (number) {
        await prisma.stampCatalogNumber.create({
          data: { stampId: id, catalogVendorId: vendor.id, number },
        });
      }
      if (price) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: id,
            catalogEditionId: edition.id,
            conditionId,
            certificateStatusId: null,
            price,
            currency: "EUR",
          },
        });
      }
      if (issueId) {
        await prisma.issueMember.create({ data: { issueId, stampId: id, sortOrder: 0 } });
      }
      return id;
    };
    const s10 = await stamp("Alpha", "10", 1950, "4.00", zetaIssueId);
    const s2 = await stamp("Beta", "2", 1960, "2.00", alphaIssueId);
    const s2a = await stamp("Gamma", "2a", 1940, null, null);
    const sx = await stamp("Delta", null, null, "8.00", null);

    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    const openLotId = (
      await prisma.purchaseLot.create({
        data: { purchaseId: purchase.id, title: "Open", price: "9.00", status: "open" },
      })
    ).id;

    const copy = async (
      key: string,
      itemNo: number,
      stampId: string,
      day: number,
      extra: { costBasis?: string; lotId?: string } = {}
    ) => {
      c[key] = (
        await prisma.item.create({
          data: {
            collectionId,
            itemNo,
            stampId,
            conditionId,
            deliveryState: "delivered",
            createdAt: new Date(Date.UTC(2026, 0, day)),
            ...extra,
          },
        })
      ).id;
    };
    await copy("c1", 1, s10, 3, { costBasis: "1.50" });
    await copy("c2", 2, s2, 1);
    await copy("c3", 3, s2a, 5, { costBasis: "5.00" });
    await copy("c4", 4, sx, 2);
    await copy("c5", 5, s2, 4, { lotId: openLotId });
    await copy("c6", 6, s10, 6, { costBasis: "1.50" });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const names = (ids: string[]) => {
    const byId = new Map(Object.entries(c).map(([k, v]) => [v, k]));
    return ids.map((id) => byId.get(id));
  };

  async function sorted(
    sortBy: CopyListSortKey,
    sortDir: "asc" | "desc",
    filters: ItemListFiltersPaginated = {}
  ) {
    const { items } = await listItemsPaginated(userId, collectionId, {
      ...filters,
      sortBy,
      sortDir,
    });
    return items;
  }

  const EXPECTED: [CopyListSortKey, "asc" | "desc", string[]][] = [
    ["created", "desc", ["c6", "c3", "c5", "c1", "c4", "c2"]],
    ["created", "asc", ["c2", "c4", "c1", "c5", "c3", "c6"]],
    // A variant follows its umbrella; the number-less copy is last both ways.
    ["catalogNumber", "asc", ["c2", "c5", "c3", "c1", "c6", "c4"]],
    ["catalogNumber", "desc", ["c1", "c6", "c3", "c2", "c5", "c4"]],
    ["issueDate", "asc", ["c3", "c1", "c6", "c2", "c5", "c4"]],
    ["issueDate", "desc", ["c2", "c5", "c1", "c6", "c3", "c4"]],
    ["name", "asc", ["c1", "c6", "c2", "c5", "c4", "c3"]],
    ["name", "desc", ["c3", "c4", "c2", "c5", "c1", "c6"]],
    // The copies of no issue last, in catalogue order between them.
    ["issueName", "asc", ["c2", "c5", "c1", "c6", "c3", "c4"]],
    ["issueName", "desc", ["c1", "c6", "c2", "c5", "c3", "c4"]],
    ["copyNo", "asc", ["c1", "c2", "c3", "c4", "c5", "c6"]],
    ["copyNo", "desc", ["c6", "c5", "c4", "c3", "c2", "c1"]],
    ["catalogueValue", "desc", ["c4", "c1", "c6", "c2", "c5", "c3"]],
    ["catalogueValue", "asc", ["c2", "c5", "c1", "c6", "c4", "c3"]],
    // c5's is the estimate its open lot gives it; the copies with no cost last, in catalogue order.
    ["cost", "desc", ["c5", "c3", "c1", "c6", "c2", "c4"]],
    ["cost", "asc", ["c1", "c6", "c3", "c5", "c2", "c4"]],
  ];

  for (const [sortBy, sortDir, expected] of EXPECTED) {
    it(`sorts by ${sortBy}, ${sortDir === "asc" ? "ascending" : "descending"}`, async () => {
      assert.deepEqual(names((await sorted(sortBy, sortDir)).map((i) => i.id)), expected);
    });
  }

  it("sorts by the figures the rows show", async () => {
    const byValue = await sorted("catalogueValue", "desc");
    const values = byValue.map((i) => i.value.baseAmount);
    assert.deepEqual(values, [8, 4, 4, 2, 2, null]);

    const byCost = await sorted("cost", "desc");
    const c5 = byCost.find((i) => i.id === c.c5)!;
    assert.equal(c5.costBasis, null);
    assert.ok(c5.costEstimate != null, "the open lot's copy shows an estimate");
    assert.ok(Number(c5.costEstimate) > 5, "and it is the dearest cost");
  });

  it("walks the pages in the same order as one read, for a key read in SQL and one in memory", async () => {
    for (const sortBy of ["catalogNumber", "cost"] as const) {
      const whole = (await sorted(sortBy, "desc")).map((i) => i.id);
      const paged: string[] = [];
      let offset = 0;
      for (;;) {
        const page = await listItemsPaginated(userId, collectionId, {
          sortBy,
          sortDir: "desc",
          offset,
          pageSize: 4,
        });
        paged.push(...page.items.map((i) => i.id));
        if (page.nextCursor === null) break;
        offset = Number(page.nextCursor);
      }
      assert.deepEqual(paged, whole, sortBy);
    }
  });

  it("sorts only the copies a filter lets through — as a grouped view's members are read", async () => {
    const zeta = await sorted("cost", "desc", { issueId: zetaIssueId });
    assert.deepEqual(names(zeta.map((i) => i.id)), ["c1", "c6"]);
    const zetaByNo = await sorted("copyNo", "desc", { issueId: zetaIssueId });
    assert.deepEqual(names(zetaByNo.map((i) => i.id)), ["c6", "c1"]);
  });
});
