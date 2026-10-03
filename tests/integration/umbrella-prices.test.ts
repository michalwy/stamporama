import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  addStampToIssue,
  addVariantRangeToStamp,
  addVariantTreeToStamp,
  listIssueMembers,
  reparentStampNode,
} from "../../src/lib/issues";
import { updateStampWithCatalog } from "../../src/lib/stamps";
import { UmbrellaPricesUnanswered } from "../../src/lib/umbrella-prices";

// #1573: a stamp with catalogue prices of its own that gains its first variant becomes an umbrella,
// and a price recorded on an umbrella overrides the value rolled up from its variants (#238). Every
// way a stamp gains a variant on the screens asks whether to keep those prices or clear them — here
// as the write's `umbrellaPrices` policy: `ask` refuses with the question and writes nothing, `clear`
// removes every own price so the value rolls up, `keep` leaves them as an override. An umbrella
// already, a stamp without prices, or a child that is not a variant asks nothing.

let nextTestIssueNo = 15731;

describe("a priced stamp gaining its first variant (#1573)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let vendorId: string;
  let conditionId: string;
  let mintId: string;
  let edition2020: string;
  let edition2024: string;
  let fischerEdition: string;
  /** The collection default, and a variant: a child of this kind makes its parent an umbrella. */
  let variantSubtypeId: string;
  /** A child that is its own entry rather than another way of holding its parent. */
  let distinctSubtypeId: string;

  before(async () => {
    const ts = Date.now();
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-umbprices-${ts}`,
          name: `Test User umbprices-${ts}`,
          email: `test-umbprices-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-umbprices-${ts}`, name: `Collection ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    vendorId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    const michel = await prisma.catalogName.create({ data: { vendorId, name: "Michel", currency: "EUR" } });
    edition2020 = (await prisma.catalogEdition.create({ data: { catalogNameId: michel.id, year: 2020 } })).id;
    edition2024 = (await prisma.catalogEdition.create({ data: { catalogNameId: michel.id, year: 2024 } })).id;
    const fischerVendor = await prisma.catalogVendor.create({ data: { collectionId, name: "Fischer", abbreviation: "Fi" } });
    const fischer = await prisma.catalogName.create({ data: { vendorId: fischerVendor.id, name: "Fischer", currency: "PLN" } });
    fischerEdition = (await prisma.catalogEdition.create({ data: { catalogNameId: fischer.id, year: 2023 } })).id;
    areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Area", primaryCatalogNameId: michel.id } })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    mintId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Mint", abbreviation: "**", sortOrder: 1 } })
    ).id;
    variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Colour", actsAsVariant: true, isDefault: true, sortOrder: 0 },
      })
    ).id;
    distinctSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Error", actsAsVariant: false, isDefault: false, sortOrder: 1 },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newIssue(name: string) {
    return prisma.issue.create({
      data: { collectionId, issueNo: nextTestIssueNo++, collectionAreaId: areaId, name, year: 1960 },
    });
  }

  async function addStamp(
    issueId: string,
    number: string,
    opts: { parentStampId?: string; subtypeId?: string; umbrellaPrices?: "ask" | "keep" | "clear" } = {}
  ) {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      catalogNumbers: [{ catalogVendorId: vendorId, number }],
      checklistIds: [],
      ...opts,
    });
    return stampId;
  }

  async function price(stampId: string, catalogEditionId: string, amount: string, onCondition = conditionId) {
    await prisma.stampCatalogPrice.create({
      data: { stampId, catalogEditionId, conditionId: onCondition, price: amount, currency: "EUR" },
    });
  }

  /** A base stamp with three prices of its own, in two Michel editions and a Fischer one. */
  async function pricedBase(issueId: string, number: string) {
    const stampId = await addStamp(issueId, number);
    await price(stampId, edition2024, "10.00");
    await price(stampId, edition2024, "30.00", mintId);
    await price(stampId, edition2020, "8.00");
    await price(stampId, fischerEdition, "40.00");
    return stampId;
  }

  const ownPrices = (stampId: string) => prisma.stampCatalogPrice.count({ where: { stampId } });
  const childCount = (stampId: string) => prisma.stamp.count({ where: { parentId: stampId } });

  async function refusedWith(write: Promise<unknown>): Promise<UmbrellaPricesUnanswered> {
    try {
      await write;
    } catch (e) {
      if (e instanceof UmbrellaPricesUnanswered) return e;
      throw e;
    }
    assert.fail("expected the write to ask about the umbrella's prices");
  }

  describe("Add child stamp", () => {
    it("asks, stating how many prices and in which editions, and adds no variant", async () => {
      const issue = await newIssue("Ask");
      const base = await pricedBase(issue.id, "100");
      const question = await refusedWith(
        addStamp(issue.id, "100a", { parentStampId: base, umbrellaPrices: "ask" })
      );
      assert.equal(question.umbrellas.length, 1);
      assert.equal(question.umbrellas[0].stampId, base);
      assert.equal(question.umbrellas[0].label, "Mi 100");
      assert.equal(question.umbrellas[0].priceCount, 4);
      assert.deepEqual(question.umbrellas[0].editions, ["Fischer 2023", "Michel 2024", "Michel 2020"]);
      assert.equal(await childCount(base), 0);
      assert.equal(await ownPrices(base), 4);
    });

    it("clear removes every own price, so the value rolls up from the variants", async () => {
      const issue = await newIssue("Clear");
      const base = await pricedBase(issue.id, "200");
      const child = await addStamp(issue.id, "200a", { parentStampId: base, umbrellaPrices: "clear" });
      await price(child, edition2024, "3.00");
      assert.equal(await ownPrices(base), 0);
      const node = (await listIssueMembers(userId, collectionId, issue.id, conditionId)).find(
        (n) => n.stampId === base
      );
      assert.equal(node?.mainCatalogPrice?.amount, "3.00");
      assert.equal(node?.mainCatalogPriceUncertain, true);
    });

    it("keep leaves them, as the umbrella's recorded price overriding the rollup", async () => {
      const issue = await newIssue("Keep");
      const base = await pricedBase(issue.id, "300");
      const child = await addStamp(issue.id, "300a", { parentStampId: base, umbrellaPrices: "keep" });
      await price(child, edition2024, "3.00");
      assert.equal(await ownPrices(base), 4);
      const node = (await listIssueMembers(userId, collectionId, issue.id, conditionId)).find(
        (n) => n.stampId === base
      );
      assert.equal(node?.mainCatalogPrice?.amount, "10.00");
      assert.equal(node?.mainCatalogPriceUncertain, false);
    });

    it("asks nothing for a stamp that is already an umbrella", async () => {
      const issue = await newIssue("Already");
      const base = await pricedBase(issue.id, "400");
      await addStamp(issue.id, "400a", { parentStampId: base, umbrellaPrices: "keep" });
      await addStamp(issue.id, "400b", { parentStampId: base, umbrellaPrices: "ask" });
      assert.equal(await childCount(base), 2);
      assert.equal(await ownPrices(base), 4);
    });

    it("asks nothing for a stamp without prices, or for a child that is not a variant", async () => {
      const issue = await newIssue("Nothing to ask");
      const bare = await addStamp(issue.id, "500");
      await addStamp(issue.id, "500a", { parentStampId: bare, umbrellaPrices: "ask" });
      assert.equal(await childCount(bare), 1);

      const base = await pricedBase(issue.id, "501");
      await addStamp(issue.id, "501E", { parentStampId: base, subtypeId: distinctSubtypeId, umbrellaPrices: "ask" });
      assert.equal(await childCount(base), 1);
      assert.equal(await ownPrices(base), 4);
    });

    it("keeps the prices when no policy is given — every caller that cannot ask", async () => {
      const issue = await newIssue("Default");
      const base = await pricedBase(issue.id, "600");
      await addStamp(issue.id, "600a", { parentStampId: base });
      assert.equal(await ownPrices(base), 4);
    });
  });

  describe("Add variant range", () => {
    it("asks once for the whole run, and adds none of it", async () => {
      const issue = await newIssue("Range ask");
      const base = await pricedBase(issue.id, "700");
      const question = await refusedWith(
        addVariantRangeToStamp(userId, collectionId, issue.id, base, {
          catalogVendorId: vendorId,
          numbers: ["700a", "700b", "700c"],
          umbrellaPrices: "ask",
        })
      );
      assert.deepEqual(question.umbrellas.map((u) => u.stampId), [base]);
      assert.equal(await childCount(base), 0);
    });

    it("clear removes the base stamp's prices and answers what it found", async () => {
      const issue = await newIssue("Range clear");
      const base = await pricedBase(issue.id, "710");
      const { stampIds, umbrellas } = await addVariantRangeToStamp(userId, collectionId, issue.id, base, {
        catalogVendorId: vendorId,
        numbers: ["710a", "710b"],
        umbrellaPrices: "clear",
      });
      assert.equal(stampIds.length, 2);
      assert.equal(umbrellas[0]?.priceCount, 4);
      assert.equal(await ownPrices(base), 0);
    });
  });

  describe("the variant tree", () => {
    it("asks one question naming every stored stamp it makes an umbrella, and clears all of them", async () => {
      const issue = await newIssue("Tree");
      const base = await pricedBase(issue.id, "800");
      // A variant already under the base, priced too; the tree gives it variants of its own.
      const stored = await addStamp(issue.id, "800A", { parentStampId: base, umbrellaPrices: "keep" });
      await price(stored, edition2024, "12.00");

      const question = await refusedWith(
        addVariantTreeToStamp(userId, collectionId, issue.id, base, {
          catalogVendorId: vendorId,
          text: ["A", "  a", "  b"].join("\n"),
          umbrellaPrices: "ask",
        })
      );
      // The base is an umbrella already (it has `800A`), so only the stored variant is asked about.
      assert.deepEqual(question.umbrellas.map((u) => [u.label, u.priceCount]), [["Mi 800A", 1]]);
      assert.equal(await childCount(stored), 0);

      const bare = await pricedBase(issue.id, "810");
      const ids = await addVariantTreeToStamp(userId, collectionId, issue.id, bare, {
        catalogVendorId: vendorId,
        text: ["A", "  a"].join("\n"),
        umbrellaPrices: "clear",
      });
      assert.equal(ids.length, 2);
      assert.equal(await ownPrices(bare), 0);
    });
  });

  describe("reassigning a parent", () => {
    it("asks before filing a stamp under a priced one, and moves nothing until answered", async () => {
      const issue = await newIssue("Reparent");
      const base = await pricedBase(issue.id, "900");
      const stray = await addStamp(issue.id, "900a");
      await refusedWith(reparentStampNode(userId, collectionId, issue.id, stray, base, "ask"));
      const row = await prisma.stamp.findUniqueOrThrow({ where: { id: stray }, select: { parentId: true } });
      assert.equal(row.parentId, null);

      await reparentStampNode(userId, collectionId, issue.id, stray, base, "clear");
      assert.equal(await childCount(base), 1);
      assert.equal(await ownPrices(base), 0);
    });
  });

  describe("editing a child into a variant", () => {
    it("asks when the edit makes the stamp its parent's first variant", async () => {
      const issue = await newIssue("Edit");
      const base = await pricedBase(issue.id, "950");
      const child = await addStamp(issue.id, "950E", { parentStampId: base, subtypeId: distinctSubtypeId });
      const edit = (umbrellaPrices: "ask" | "clear") =>
        updateStampWithCatalog(userId, child, {
          catalogNumbers: [{ catalogVendorId: vendorId, number: "950E" }],
          subtypeId: variantSubtypeId,
          umbrellaPrices,
        });

      await refusedWith(edit("ask"));
      const before = await prisma.stamp.findUniqueOrThrow({ where: { id: child }, select: { subtypeId: true } });
      assert.equal(before.subtypeId, distinctSubtypeId);

      await edit("clear");
      assert.equal(await ownPrices(base), 0);
      // Saving it again, already a variant, asks nothing.
      await edit("ask");
    });
  });
});
