import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createSale, addSaleCopySet, listSaleCopies } from "../../src/lib/sales";
import {
  copiesInLanguage,
  readOrderSummaryLanguage,
  setOrderSummaryLanguage,
} from "../../src/lib/order-summary-language";

// The order summary in the buyer's language (#2604): the buyer's language, else the platform's listing
// language, else the collection's; a choice saved on the buyer; the copies' names translated where the
// collection has a translation and in its own wording where it has none.

const ts = Date.now();

describe("the order summary in the buyer's language (#2604)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let platformId: string;
  let areaId: string;
  let conditionId: string;
  let certificateId: string;
  let translatedStampId: string;
  let issueId: string;

  async function saleTo(buyerId: string | null): Promise<string> {
    return createSale(userId, collectionId, {
      platformId,
      buyerId,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-11-21T00:00:00Z"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
  }

  async function buyer(name: string, language: string | null): Promise<string> {
    return (await prisma.contact.create({ data: { collectionId, name, buyer: true, language } })).id;
  }

  before(async () => {
    userId = `test-user-order-summary-language-${ts}`;
    otherUserId = `test-user-order-summary-language-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: `Test User ${id}`, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-order-summary-language-${ts}`, name: "Order summaries", baseCurrency: "PLN", defaultLanguage: "pl", ownerId: userId },
      })
    ).id;
    // The sale's platform lists in English; German is used by another platform.
    platformId = (await prisma.platform.create({ data: { collectionId, name: `Delcampe ${ts}`, titleLanguage: "en" } })).id;
    await prisma.platform.create({ data: { collectionId, name: `Briefmarken ${ts}`, titleLanguage: "de" } });
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Polska" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: {
          collectionId,
          name: "Kasowany",
          abbreviation: "⊙",
          sortOrder: 0,
          translations: { create: [{ language: "de", name: "Gestempelt" }] },
        },
      })
    ).id;
    certificateId = (
      await prisma.certificateStatus.create({ data: { collectionId, name: "Atest", abbreviation: "A", sortOrder: 0 } })
    ).id;
    issueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 1, collectionAreaId: areaId, name: "Zamki", translations: { create: [{ language: "de", name: "Burgen" }] } },
      })
    ).id;
    translatedStampId = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: "Wawel",
          issuedYear: 1960,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          issueMemberships: { create: [{ issueId }] },
          translations: { create: [{ language: "de", name: "Wawelburg" }] },
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("opens in the buyer's language, else the platform's listing language, and offers the languages the collection uses", async () => {
    const german = await readOrderSummaryLanguage(userId, await saleTo(await buyer("Hans Müller", "de")));
    // The collection's own language first, then the others by name.
    assert.deepEqual(german, { language: "de", languages: ["pl", "en", "de"], hasBuyer: true, translateTo: "de" });

    const unknown = await readOrderSummaryLanguage(userId, await saleTo(await buyer("Anon", null)));
    assert.equal(unknown!.language, "en");

    // The collection's own language needs no translating.
    const polish = await readOrderSummaryLanguage(userId, await saleTo(await buyer("Jan", "pl")));
    assert.deepEqual([polish!.language, polish!.translateTo], ["pl", null]);

    assert.equal(await readOrderSummaryLanguage(otherUserId, await saleTo(null)), null);
  });

  it("saves a choice on the buyer, so their next sale opens in it — and takes only a language the collection uses", async () => {
    const hans = await buyer("Hans Weber", "de");
    const saleId = await saleTo(hans);
    assert.equal(await setOrderSummaryLanguage(userId, saleId, "en"), "en");
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: hans } })).language, "en");
    assert.equal((await readOrderSummaryLanguage(userId, await saleTo(hans)))!.language, "en");

    await assert.rejects(setOrderSummaryLanguage(userId, saleId, "ja"), /not one this collection uses/);
    await assert.rejects(setOrderSummaryLanguage(otherUserId, saleId, "pl"), /not found/);
  });

  it("keeps the choice in the page's address on a sale with no buyer", async () => {
    const saleId = await saleTo(null);
    assert.equal((await readOrderSummaryLanguage(userId, saleId))!.language, "en");
    assert.equal((await readOrderSummaryLanguage(userId, saleId, "de"))!.language, "de");
    // A language the collection does not use is not taken from the address.
    assert.equal((await readOrderSummaryLanguage(userId, saleId, "ja"))!.language, "en");
    await assert.rejects(setOrderSummaryLanguage(userId, saleId, "de"), /no buyer/);
    // A buyer's sale is in the buyer's language whatever the address says.
    const buyerSale = await saleTo(await buyer("Hans Schmidt", "de"));
    assert.equal((await readOrderSummaryLanguage(userId, buyerSale, "en"))!.language, "de");
  });

  it("names the stamp, series, condition and certificate in the language where the collection has a translation, else in its own wording", async () => {
    const plainStampId = (
      await prisma.stamp.create({
        data: { collectionId, name: "Sukiennice", issuedYear: 1961, stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] } },
      })
    ).id;
    const translated = await createItem(userId, collectionId, {
      stampId: translatedStampId,
      conditionId,
      certificateStatusId: certificateId,
      forSale: true,
      deliveryState: "delivered",
    });
    const plain = await createItem(userId, collectionId, { stampId: plainStampId, conditionId, forSale: true, deliveryState: "delivered" });
    const saleId = await saleTo(null);
    await addSaleCopySet(userId, saleId, { itemIds: [translated.id, plain.id], price: "10.00" });
    const copies = await listSaleCopies(userId, saleId);

    const names = (list: typeof copies) =>
      Object.fromEntries(
        list.map((c) => [c.id, [c.stampName, c.issueName, c.conditionName, c.conditionAbbreviation, c.certificateStatusName]])
      );
    const german = names(await copiesInLanguage(copies, "de"));
    assert.deepEqual(german[translated.id], ["Wawelburg", "Burgen", "Gestempelt", "⊙", "Atest"]);
    assert.deepEqual(german[plain.id], ["Sukiennice", null, "Gestempelt", "⊙", null]);

    // The collection's own language returns the copies as they are.
    assert.deepEqual(names(await copiesInLanguage(copies, null)), names(copies));
  });
});
