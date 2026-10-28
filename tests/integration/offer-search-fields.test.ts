import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, listOffersPaginated, offerFilterCounts } from "../../src/lib/offers";
import type { OfferSearchField } from "../../src/lib/offer-search-fields";

// #2242: the Offers list's search box matches only the fields ticked beside it. `40381234` is made
// to read as every field at once — a title, an offer's own number, a catalogue number, a location
// ref and a listing's number in its address — so each field ticked alone has to find its own offer
// and nothing else.

const ts = Date.now();
const TEXT = "40381234";

describe("offer search narrowed to the ticked fields (#2242)", () => {
  let userId: string;
  let collectionId: string;
  const ids: Record<OfferSearchField | "derivedTitle" | "plain", string> = {} as never;
  let plainNo: number;

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-offersearchfields-${ts}`,
          name: "Offer search fields",
          email: `test-offersearchfields-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-offersearchfields-${ts}`, name: "S", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const platformId = (
      await prisma.platform.create({
        data: { collectionId, name: "FieldsMarket", platformCurrency: "EUR" },
      })
    ).id;
    const vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;

    async function offer(opts: {
      name: string | null;
      stampName?: string;
      catalogNumber?: string;
      locationRef?: string;
      url?: string;
      offerNo?: number;
    }): Promise<string> {
      const stampId = (
        await prisma.stamp.create({ data: { collectionId, name: opts.stampName ?? "Chopin" } })
      ).id;
      if (opts.catalogNumber) {
        await prisma.stampCatalogNumber.create({
          data: { stampId, catalogVendorId: vendorId, number: opts.catalogNumber },
        });
      }
      const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
      if (opts.locationRef) {
        await prisma.item.update({ where: { id: item.id }, data: { locationRef: opts.locationRef } });
      }
      const id = await createOffer(
        userId,
        collectionId,
        {
          platformId,
          url: opts.url ?? null,
          price: "5.00",
          currency: "EUR",
          listingDate: null,
          state: "preparing",
        },
        { seedItemIds: [item.id] }
      );
      await prisma.offer.update({
        where: { id },
        data: { name: opts.name, ...(opts.offerNo ? { offerNo: opts.offerNo } : {}) },
      });
      return id;
    }

    ids.title = await offer({ name: `Lot ${TEXT}` });
    ids.derivedTitle = await offer({ name: null, stampName: `Overprint ${TEXT}` });
    ids.offerNumber = await offer({ name: "Numbered", offerNo: Number(TEXT) });
    ids.catalogNumber = await offer({ name: "Catalogued", catalogNumber: TEXT });
    ids.locationRef = await offer({ name: "Filed", locationRef: TEXT });
    ids.listingUrl = await offer({ name: "Linked", url: `https://allegro.pl/oferta/stamp-${TEXT}` });
    ids.plain = await offer({ name: "Warsaw" });
    plainNo = (
      await prisma.offer.findUniqueOrThrow({ where: { id: ids.plain }, select: { offerNo: true } })
    ).offerNo;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function search(term: string, searchFields?: OfferSearchField[]): Promise<string[]> {
    const { items } = await listOffersPaginated(userId, collectionId, {
      search: term,
      searchFields,
      pageSize: 100,
    });
    return items.map((o) => o.id).sort();
  }

  it("matches every field while nothing is narrowed", async () => {
    const all = Object.entries(ids)
      .filter(([k]) => k !== "plain")
      .map(([, id]) => id)
      .sort();
    assert.deepEqual(await search(TEXT), all);
  });

  it("finds only the offer each field ticked alone names", async () => {
    assert.deepEqual(await search(TEXT, ["title"]), [ids.title, ids.derivedTitle].sort());
    for (const field of ["offerNumber", "catalogNumber", "locationRef", "listingUrl"] as const) {
      assert.deepEqual(await search(TEXT, [field]), [ids[field]], field);
    }
  });

  it("matches the union of the fields ticked", async () => {
    assert.deepEqual(
      await search(TEXT, ["catalogNumber", "locationRef"]),
      [ids.catalogNumber, ids.locationRef].sort()
    );
  });

  it("finds nothing when the ticked fields cannot read the text, rather than everything", async () => {
    assert.deepEqual(await search("Warsaw", ["offerNumber", "listingUrl"]), []);
  });

  it("reads `#12` as that offer and nothing else, whatever is ticked", async () => {
    assert.deepEqual(await search(`#${plainNo}`, ["locationRef"]), [ids.plain]);
    assert.deepEqual(await search(`#${TEXT}`), [ids.offerNumber]);
  });

  it("narrows the toolbar counts the same way", async () => {
    const counts = await offerFilterCounts(userId, collectionId, {
      search: TEXT,
      searchFields: ["locationRef"],
    });
    assert.equal(counts.total, 1);
  });
});
