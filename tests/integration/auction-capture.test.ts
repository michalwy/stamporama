import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  AuctionActionBlockedError,
  captureAuctionLot,
  findLotsForListings,
  findOpenAuctionSale,
  listAuctionLots,
} from "../../src/lib/auctions";
import { setAllegroPlatform } from "../../src/lib/allegro";

// Capturing a lot from a marketplace page (#355; ADR-0021 §8). What is worth a real database here is
// everything the extension deliberately does **not** decide: which platform the page belongs to,
// which contact its seller is, which parcel the lot lands in, and whether a listing already tracked
// becomes a second lot or a refreshed bid.

// The fixture is shared with the lookup suite below (#575), which reads back exactly what these
// captures wrote — the same collection is the point of it.
let userId: string;
let collectionId: string;

describe("auction lot capture (#355)", () => {
  let platformId: string;

  const hourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);

  /** One listing as the Allegro module reads it. */
  function listing(overrides: Partial<Parameters<typeof captureAuctionLot>[2]> = {}) {
    return {
      platformOfferId: "18795065609",
      url: "https://allegro.pl/oferta/18795065609",
      title: "Fi 348-357, Wyzwolenie 10 miast",
      lotNo: "18795065609",
      sellerName: "Philkam_znaczki",
      endsAt: hourFromNow(),
      startingPrice: null,
      currentBid: "107.00",
      ...overrides,
    };
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-capture-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User capture-${ts}`,
        email: `test-capture-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-capture-${ts}`,
        name: `Collection capture-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Allegro", platform: true, platformCurrency: "PLN" },
      })
    ).id;
  });

  it("refuses while no platform is marked as Allegro", async () => {
    await assert.rejects(
      () => captureAuctionLot(userId, collectionId, listing(), { dryRun: false }),
      (e: unknown) =>
        e instanceof AuctionActionBlockedError && e.reason === "no-platform-module"
    );
  });

  it("previews without creating the seller or the sale", async () => {
    await setAllegroPlatform(userId, collectionId, platformId);

    const preview = await captureAuctionLot(userId, collectionId, listing(), { dryRun: true });
    assert.equal(preview.outcome, "created");
    assert.equal(preview.lotId, null);
    assert.equal(preview.saleCreated, true);
    assert.equal(preview.sellerCreated, true);
    assert.equal(preview.sellerName, "Philkam_znaczki");
    assert.equal(preview.platformName, "Allegro");
    // The platform locks PLN (#196), so a seller met for the first time opens in it rather than in
    // the collection's base currency.
    assert.equal(preview.saleCurrency, "PLN");

    // Nothing was written.
    assert.equal(
      await prisma.contact.count({ where: { collectionId, name: "Philkam_znaczki" } }),
      0
    );
    assert.equal(await prisma.auctionSale.count({ where: { collectionId } }), 0);
  });

  it("creates the seller, the parcel and the lot", async () => {
    const result = await captureAuctionLot(userId, collectionId, listing(), { dryRun: false });
    assert.equal(result.outcome, "created");
    assert.ok(result.lotId);
    assert.equal(result.saleCreated, true);
    assert.equal(result.sellerCreated, true);
    assert.equal(result.saleName, "Philkam_znaczki · Allegro");

    const lot = await prisma.auctionLot.findUniqueOrThrow({ where: { id: result.lotId! } });
    assert.equal(lot.title, "Fi 348-357, Wyzwolenie 10 miast");
    assert.equal(lot.url, "https://allegro.pl/oferta/18795065609");
    assert.equal(lot.lotNo, "18795065609");
    assert.equal(lot.currentBid?.toString(), "107");
    // A recorded bid is an observation, so it is dated.
    assert.ok(lot.checkedAt);

    // The seller was created carrying the seller role, so their auction defaults have somewhere to
    // live from the next lot onwards.
    const seller = await prisma.contact.findFirstOrThrow({
      where: { collectionId, name: "Philkam_znaczki" },
    });
    assert.equal(seller.seller, true);
  });

  it("refreshes the bid instead of duplicating an already-tracked listing", async () => {
    const before = await prisma.auctionLot.findFirstOrThrow({
      where: { auctionSale: { collectionId } },
    });
    const checkedBefore = before.checkedAt;

    const result = await captureAuctionLot(
      userId,
      collectionId,
      // Reached by a different address, with a title the collector would not want overwritten.
      listing({
        url: "https://allegro.pl/produkt/some-slug?offerId=18795065609",
        title: "something else entirely",
        lotNo: "999",
        currentBid: "112.00",
      }),
      { dryRun: false }
    );

    assert.equal(result.outcome, "refreshed");
    assert.equal(result.lotId, before.id);
    assert.equal(result.previousBid, "107.00");

    const after = await prisma.auctionLot.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(after.currentBid?.toString(), "112");
    assert.equal(after.title, "Fi 348-357, Wyzwolenie 10 miast", "the title is the collector's");
    assert.equal(after.lotNo, "18795065609", "and so is the lot number");
    assert.notEqual(after.checkedAt?.getTime(), checkedBefore?.getTime());
    assert.equal(await prisma.auctionLot.count({ where: { auctionSale: { collectionId } } }), 1);
  });

  it("joins the seller's open parcel on the next capture", async () => {
    const seller = await prisma.contact.findFirstOrThrow({
      where: { collectionId, name: "Philkam_znaczki" },
    });
    const open = await findOpenAuctionSale(userId, collectionId, seller.id, platformId);
    assert.ok(open);

    const result = await captureAuctionLot(
      userId,
      collectionId,
      listing({ platformOfferId: "18795099999", url: "https://allegro.pl/oferta/18795099999" }),
      { dryRun: false }
    );
    assert.equal(result.outcome, "created");
    assert.equal(result.saleCreated, false);
    assert.equal(result.saleId, open!.id);
    assert.equal(result.sellerCreated, false);

    const { items } = await listAuctionLots(userId, collectionId, {});
    assert.equal(items.length, 2);
  });

  it("matches an existing seller by name whatever case the page printed", async () => {
    const preview = await captureAuctionLot(
      userId,
      collectionId,
      listing({
        platformOfferId: "18795088888",
        url: "https://allegro.pl/oferta/18795088888",
        sellerName: "philkam_ZNACZKI",
      }),
      { dryRun: true }
    );
    assert.equal(preview.sellerCreated, false);
    assert.equal(preview.sellerName, "Philkam_znaczki");
    assert.equal(preview.saleCreated, false);
  });

  it("does not mistake one offer id for part of another", async () => {
    // "8795065609" is a substring of the tracked "18795065609": a bare `contains` match would call
    // this the same listing and refresh a bid that belongs to a different auction.
    const preview = await captureAuctionLot(
      userId,
      collectionId,
      listing({ platformOfferId: "8795065609", url: "https://allegro.pl/oferta/8795065609" }),
      { dryRun: true }
    );
    assert.equal(preview.outcome, "created");
  });

  it("recognises a lot that carries only the offer number", async () => {
    // Added by hand from the listing, with the number typed in and no URL — which is exactly what
    // the number field is for. A capture of that auction must refresh it, not make a second one.
    const seller = await prisma.contact.findFirstOrThrow({
      where: { collectionId, name: "Philkam_znaczki" },
    });
    const sale = await prisma.auctionSale.findFirstOrThrow({
      where: { collectionId, sellerId: seller.id, platformId },
    });
    const byHand = await prisma.auctionLot.create({
      data: {
        auctionSaleId: sale.id,
        // Past the collection's counter: this row bypasses `allocateEntityNumber` (#432). Note the
        // two numbers side by side — `auctionLotNo` is ours, `lotNo` is what the collector typed.
        auctionLotNo: 9001,
        lotNo: "18795044444",
        title: "typed in by hand",
        endsAt: hourFromNow(),
      },
    });

    const result = await captureAuctionLot(
      userId,
      collectionId,
      listing({
        platformOfferId: "18795044444",
        url: "https://allegro.pl/oferta/18795044444",
        lotNo: "18795044444",
      }),
      { dryRun: false }
    );
    assert.equal(result.outcome, "refreshed");
    assert.equal(result.lotId, byHand.id);
  });

  it("never reads a house sale's lot number as an offer number", async () => {
    // `lotNo` is one field over two vocabularies: `Lot 42` in a printed catalogue and an Allegro
    // offer number. The match is scoped to sales on the platform being captured from, so a lot
    // numbered 42 in a house sale is not the Allegro auction whose offer id happens to be 42.
    const house = await prisma.contact.create({
      data: { collectionId, name: `Köhler-${Date.now()}`, seller: true, platform: true },
    });
    const houseSale = await prisma.auctionSale.create({
      data: {
        collectionId,
        sellerId: house.id,
        platformId: house.id,
        name: "Köhler 385",
        currency: "EUR",
      },
    });
    await prisma.auctionLot.create({
      data: { auctionSaleId: houseSale.id, auctionLotNo: 9002, lotNo: "42", endsAt: hourFromNow() },
    });

    const preview = await captureAuctionLot(
      userId,
      collectionId,
      listing({ platformOfferId: "42", url: "https://allegro.pl/oferta/42", lotNo: "42" }),
      { dryRun: true }
    );
    assert.equal(preview.outcome, "created");
  });

  it("refuses a listing that names no seller", async () => {
    await assert.rejects(
      () =>
        captureAuctionLot(
          userId,
          collectionId,
          listing({
            platformOfferId: "18795077777",
            url: "https://allegro.pl/oferta/18795077777",
            sellerName: null,
          }),
          { dryRun: true }
        ),
      (e: unknown) => e instanceof AuctionActionBlockedError && e.reason === "no-seller"
    );
  });
});

// ── The link back from the listing to the lot (#575) ─────────────────────────
//
// The Assistant standing on an auction page asks the instance whether it is already tracked. It is
// the capture's own matching rule asked as a **read**, so what is worth a real database here is that
// the two agree: a listing the capture would refresh is one this reports, by whichever of the two
// fields the lot happens to carry, and a listing the capture would treat as new reports nothing.
//
// It runs against the collection the suite above has already filled, which is exactly the mixture
// worth asking: captured lots, one added by hand carrying only the number, and a house sale whose
// `Lot 42` must never be read as an offer number.

describe("finding the lots behind marketplace listings (#575)", () => {
  it("names the lot tracking a captured listing, and where to read it", async () => {
    const [match] = await findLotsForListings(userId, collectionId, ["18795065609"]);
    assert.ok(match, "the listing the suite captured is tracked");
    assert.equal(match.platformOfferId, "18795065609");
    assert.equal(match.title, "Fi 348-357, Wyzwolenie 10 miast");
    assert.equal(match.saleName, "Philkam_znaczki · Allegro");
    // Still being bid on: `pending` is the derived outcome of an open lot (ADR-0021 §4).
    assert.equal(match.outcome, "pending");
    assert.ok(match.auctionLotNo > 0);
    // A lot has no page of its own, so the address is its sale's, focused on it (#431).
    assert.match(match.path, /\/auctions\/sales\/[^/]+\?lot=/);
  });

  it("recognises a lot that carries only the offer number, as the capture does", async () => {
    const [match] = await findLotsForListings(userId, collectionId, ["18795044444"]);
    assert.ok(match);
    assert.equal(match.matchedBy, "lot-no");
    assert.equal(match.title, "typed in by hand");
  });

  it("answers many listings in one call, and says nothing about the ones it never bid on", async () => {
    const matches = await findLotsForListings(userId, collectionId, [
      "18795065609",
      "18795099999",
      "17000000001",
    ]);
    assert.deepEqual(
      matches.map((m) => m.platformOfferId).sort(),
      ["18795065609", "18795099999"]
    );
  });

  it("does not mistake one offer id for part of another", async () => {
    // The capture's own rule: "8795065609" sits inside the tracked "18795065609", and a bare
    // `contains` would send the collector to a different auction's lot.
    assert.deepEqual(await findLotsForListings(userId, collectionId, ["8795065609"]), []);
  });

  it("never reads a house sale's lot number as an offer number", async () => {
    assert.deepEqual(await findLotsForListings(userId, collectionId, ["42"]), []);
  });
});
