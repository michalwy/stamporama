import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, listOffersPaginated, offerFilterCounts } from "../../src/lib/offers";

// The offers list's search box (#465): finding one listing among hundreds by whatever the collector
// happens to know about it — the title, the offer's own number, a catalog number of a copy in it, or
// the marketplace link a sale notification carried.

describe("offer list search (#465)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let vendorId: string;

  /** offer id → what it is here for. */
  let titled: string;
  let untitled: string;
  let linked: string;
  let titledNo: number;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-offersearch-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User offersearch-${ts}`,
        email: `test-offersearch-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-offersearch-${ts}`,
          name: `Collection offersearch-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "SearchMarket", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;

    async function offerHolding(
      stampName: string,
      catalogNumber: string | null,
      header: { name?: string | null; url?: string | null; locationRef?: string }
    ): Promise<string> {
      const stampId = (await prisma.stamp.create({ data: { collectionId, name: stampName } })).id;
      if (catalogNumber) {
        await prisma.stampCatalogNumber.create({
          data: { stampId, catalogVendorId: vendorId, number: catalogNumber },
        });
      }
      const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
      if (header.locationRef) {
        await prisma.item.update({
          where: { id: item.id },
          data: { locationRef: header.locationRef },
        });
      }
      const id = await createOffer(
        userId,
        collectionId,
        {
          platformId,
          url: header.url ?? null,
          price: "5.00",
          currency: "EUR",
          listingDate: null,
          state: "preparing",
        },
        { seedItemIds: [item.id] }
      );
      // The title is written straight in: what is under test is how the list *reads* it, not the
      // template that generates one.
      if (header.name !== undefined) {
        await prisma.offer.update({ where: { id }, data: { name: header.name } });
      }
      return id;
    }

    titled = await offerHolding("Warsaw Panorama", "865", { name: "Poland 1960 Warsaw set" });
    untitled = await offerHolding("Krakow Cloth Hall", "912", { name: null, locationRef: "A234" });
    linked = await offerHolding("Gdansk Crane", "1001", {
      name: "Gdansk single",
      url: "https://allegro.pl/oferta/gdansk-crane-16123456",
    });
    titledNo = (
      await prisma.offer.findUniqueOrThrow({ where: { id: titled }, select: { offerNo: true } })
    ).offerNo;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function search(term: string): Promise<string[]> {
    const { items } = await listOffersPaginated(userId, collectionId, {
      search: term,
      pageSize: 100,
    });
    return items.map((o) => o.id);
  }

  it("finds an offer by a fragment of its stored title, case-insensitively", async () => {
    assert.deepEqual(await search("warsaw set"), [titled]);
  });

  it("finds an untitled offer by the stamp name its shown label is derived from", async () => {
    assert.deepEqual(await search("Cloth Hall"), [untitled]);
    // A titled offer is matched on its title and nothing else — the collector wrote it deliberately,
    // and it is what the list is showing.
    assert.deepEqual(await search("Warsaw Panorama"), []);
  });

  it("finds an offer by a catalog number of a copy it holds, titled or not", async () => {
    assert.deepEqual(await search("912"), [untitled]);
    assert.deepEqual(await search("1001"), [linked]);
  });

  it("finds an offer by the filing ref of a copy in it, as the inventory list does (#303)", async () => {
    assert.deepEqual(await search("A234"), [untitled]);
    assert.deepEqual(await search("a23"), [untitled], "case-insensitive substring, like everything else");
  });

  it("matches the offer's own number in addition to the text, bare or behind a #", async () => {
    assert.ok((await search(String(titledNo))).includes(titled));
    assert.ok((await search(`#${titledNo}`)).includes(titled));
  });

  it("finds a listing by a pasted link, however the address was copied", async () => {
    for (const entry of [
      "https://allegro.pl/oferta/gdansk-crane-16123456",
      "http://www.allegro.pl/oferta/gdansk-crane-16123456/",
      "https://allegro.pl/oferta/gdansk-crane-16123456?utm_source=mail",
      "allegro.pl/oferta/gdansk-crane-16123456",
    ]) {
      assert.deepEqual(await search(entry), [linked], entry);
    }
  });

  it("finds a listing by the offer number a notification quotes, at the address's boundaries", async () => {
    assert.deepEqual(await search("16123456"), [linked]);
    // …and never as a bare substring: a longer id whose middle happens to hold this one is a
    // different listing.
    assert.deepEqual(await search("1612345"), []);
  });

  it("composes with the other filters rather than replacing them", async () => {
    const { items } = await listOffersPaginated(userId, collectionId, {
      search: "Gdansk",
      states: ["active"],
      pageSize: 100,
    });
    assert.deepEqual(items, [], "the searched offer is preparing, not active");
  });

  it("narrows the toolbar counts the way any other filter does (#332)", async () => {
    const counts = await offerFilterCounts(userId, collectionId, { search: "Gdansk" });
    assert.equal(counts.total, 1);
    assert.equal(counts.states.preparing, 1);
    assert.equal(counts.platforms[platformId], 1);
  });
});
