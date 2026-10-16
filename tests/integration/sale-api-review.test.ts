import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getActionItems, type ActionItemGroupId } from "../../src/lib/action-items";
import {
  confirmSaleReview,
  createSale,
  getSaleDetail,
  listSalesPaginated,
  markSaleWrittenByApi,
  setSaleStatus,
  updateSaleAmount,
  updateSaleTransactionUrl,
} from "../../src/lib/sales";
import { saleLineAddedAction } from "../../src/lib/sale-review";

// The *to review* marker on sales written through the agent API (#1948): what a write leaves, how the
// Sales list filters by it and the bell reports it, and that only *Confirm* clears it — editing a
// marked sale in the app leaves it standing (settled with the collector on 2026-10-16).

describe("the to-review marker on sales (#1948)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let platformId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-salereview-${ts}`;
    otherUserId = `test-user-salereview-other-${ts}`;
    for (const id of [userId, otherUserId]) {
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
        data: { slug: `col-salereview-${ts}`, name: "Review", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Facebook", platform: true } })
    ).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  async function newSale(): Promise<string> {
    return createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
  }

  const added = (offerNo: number, price: string) =>
    saleLineAddedAction({ offerNo, price, currency: "PLN" });

  async function mark(saleId: string, kind: "created" | "changed", actions: string[]) {
    await prisma.$transaction((tx) => markSaleWrittenByApi(tx, saleId, { kind, actions }));
  }

  const reviewGroup = async () =>
    (await getActionItems(userId, collectionId)).groups.find(
      (g) => g.id === ("sale-api-review" satisfies ActionItemGroupId)
    );

  it("a sale recorded in the app carries no marker", async () => {
    const saleId = await newSale();
    assert.equal((await getSaleDetail(userId, saleId))!.apiReview, null);
    const listed = (await listSalesPaginated(userId, collectionId)).items.find((s) => s.id === saleId);
    assert.equal(listed?.apiReview, null);
  });

  it("an API write marks the sale with what it did, on the list and on its own screen", async () => {
    const saleId = await newSale();
    await mark(saleId, "created", [added(2680, "15")]);

    const detail = (await getSaleDetail(userId, saleId))!.apiReview;
    assert.equal(detail?.created, true);
    assert.deepEqual(detail?.actions, ["added offer #2680 at 15 PLN"]);
    const listed = (await listSalesPaginated(userId, collectionId)).items.find((s) => s.id === saleId);
    assert.deepEqual(listed?.apiReview, detail);
  });

  it("a later write adds to the marker rather than replacing it", async () => {
    const saleId = await newSale();
    await mark(saleId, "created", [added(1, "10")]);
    await mark(saleId, "changed", [added(2, "12.50")]);
    const review = (await getSaleDetail(userId, saleId))!.apiReview;
    assert.equal(review?.created, true);
    assert.deepEqual(review?.actions, ["added offer #1 at 10 PLN", "added offer #2 at 12.50 PLN"]);
  });

  it("the Sales list filters by the marker, and the bell reports it in a blue group", async () => {
    const marked = await newSale();
    const plain = await newSale();
    await mark(marked, "changed", [added(77, "5")]);

    const filtered = (await listSalesPaginated(userId, collectionId, { toReview: true })).items;
    assert.ok(filtered.some((s) => s.id === marked));
    assert.ok(!filtered.some((s) => s.id === plain));
    assert.ok(filtered.every((s) => s.apiReview !== null));

    const group = await reviewGroup();
    assert.ok(group, "the bell has a group for sales to review");
    assert.equal(group.severity, "info");
    assert.equal(group.href, "sales?toReview=1");
    // The group counts exactly the set its "see all" opens.
    assert.equal(group.count, filtered.length);
    const row = group.items.find((i) => i.key === marked);
    assert.equal(row?.href, `sales/${marked}`);
    assert.match(row?.detail ?? "", /added offer #77 at 5 PLN/);
  });

  it("editing the sale by hand leaves the marker standing", async () => {
    const saleId = await newSale();
    await mark(saleId, "created", [added(5, "20")]);
    await updateSaleTransactionUrl(userId, saleId, "https://example.com/t/5");
    await updateSaleAmount(userId, saleId, "commission", "1.00");
    await setSaleStatus(userId, saleId, "paid");
    const review = (await getSaleDetail(userId, saleId))!.apiReview;
    assert.deepEqual(review?.actions, ["added offer #5 at 20 PLN"]);
  });

  it("Confirm clears it — the sale leaves the filter and the bell — and a second confirm is a no-op", async () => {
    const saleId = await newSale();
    await mark(saleId, "created", [added(9, "3")]);

    assert.equal(await confirmSaleReview(userId, saleId), true);
    assert.equal((await getSaleDetail(userId, saleId))!.apiReview, null);
    const filtered = (await listSalesPaginated(userId, collectionId, { toReview: true })).items;
    assert.ok(!filtered.some((s) => s.id === saleId));
    assert.ok(!(await reviewGroup())?.items.some((i) => i.key === saleId));

    assert.equal(await confirmSaleReview(userId, saleId), false);
  });

  it("a write after a confirm starts afresh rather than resurrecting the confirmed one", async () => {
    const saleId = await newSale();
    await mark(saleId, "created", [added(11, "4")]);
    await confirmSaleReview(userId, saleId);
    await mark(saleId, "changed", [added(12, "6")]);
    const review = (await getSaleDetail(userId, saleId))!.apiReview;
    assert.equal(review?.created, false);
    assert.deepEqual(review?.actions, ["added offer #12 at 6 PLN"]);
  });

  it("nobody but the owner can confirm", async () => {
    const saleId = await newSale();
    await mark(saleId, "created", []);
    await assert.rejects(() => confirmSaleReview(otherUserId, saleId));
    assert.notEqual((await getSaleDetail(userId, saleId))!.apiReview, null);
  });
});
