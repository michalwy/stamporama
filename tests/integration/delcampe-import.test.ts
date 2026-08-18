import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer } from "../../src/lib/offers";
import { setDelcampePlatform } from "../../src/lib/delcampe";
import { DelcampeImportError, importDelcampeActiveItems } from "../../src/lib/delcampe-import";
import { getDelcampeWorklist } from "../../src/lib/delcampe-worklist";

// Reconciling a Delcampe active-items export (#611). The pure half is asserted against file text in
// `tests/unit/delcampe-import-rules.test.ts`; what needs a database is the three things #611 is
// *for*:
//
//   - importing an export moves the exported batch to `active`, with listing ids and URLs;
//   - a subsequent import notices the listings that have come down, and touches nothing else;
//   - a duplicated reference is reported for a decision rather than resolved by guessing.
//
// And the one write that reaches an offer's own figures: an auction's bidding (#481's rule).

const HEADER =
  "id_auction,title,personal_reference,description,id_category,shipping_model,weight,visits_number,end_date,GMT,present_price,quantity,bids_number,best_bidder";

describe("Delcampe active-items import (#611)", () => {
  let userId: string;
  let collectionId: string;
  let collectionSlug: string;
  let platformId: string;
  let conditionId: string;

  /** An offer with one copy in it, in whatever state the caller wants — `ready` is a batch that has
   *  been exported and not yet confirmed. The listing preconditions themselves are #418's and are
   *  not what this test is about, so the state is written directly. */
  async function preparedOffer(
    name: string,
    price: string,
    state: string,
    listingType = "fixed"
  ): Promise<{ id: string; offerNo: number }> {
    const id = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price,
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    const stamp = await prisma.stamp.create({ data: { collectionId, name } });
    const item = await createItem(userId, collectionId, {
      stampId: stamp.id,
      conditionId,
      forSale: true,
    });
    await addOfferSet(userId, id, [item.id]);
    await prisma.offer.update({
      where: { id },
      data: {
        name,
        state,
        listingType,
        ...(listingType === "auction" ? { startingPrice: price } : {}),
      },
    });
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id },
      select: { offerNo: true },
    });
    return { id, offerNo: offer.offerNo };
  }

  /** One row of the file, as Delcampe writes it: a dot decimal, a zone of its own. */
  function line(
    itemId: string,
    offerNo: number | null,
    options: { price?: string; bids?: number; title?: string; reference?: string } = {}
  ): string {
    const reference =
      options.reference ?? (offerNo === null ? "" : `https://stamps.example.test/o/${collectionSlug}/${offerNo}`);
    return [
      itemId,
      `"${options.title ?? `Listing ${itemId}`}"`,
      reference,
      "",
      "24678",
      '"Fee template"',
      "",
      "4",
      '"2026-08-28 14:53:00"',
      '"GMT +1.0"',
      options.price ?? "17.44",
      "1",
      String(options.bids ?? 0),
      "",
    ].join(",");
  }

  function file(...rows: string[]): string {
    return [HEADER, ...rows].join("\r\n") + "\r\n";
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-delcimp-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User delcimp-${ts}`,
        email: `test-delcimp-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionSlug = `col-delcimp-${ts}`;
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: collectionSlug,
          name: `Collection delcimp-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Delcampe",
          platform: true,
          platformCurrency: "EUR",
          maxPhotos: 6,
        },
      })
    ).id;
    await setDelcampePlatform(userId, collectionId, platformId);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("moves the exported batch to active, with the listing id and its address", async () => {
    const first = await preparedOffer("Poland 1921 Sowing Man", "1.50", "ready");
    const second = await preparedOffer("Saar 1947 overprint", "17.44", "ready");

    const outcome = await importDelcampeActiveItems(
      userId,
      collectionId,
      file(line("2508054797", first.offerNo), line("2508054798", second.offerNo)),
      "active-items-2026-08-18.csv"
    );

    assert.equal(outcome.rowsRead, 2);
    assert.equal(outcome.matched, 2);
    assert.equal(outcome.activated.length, 2);
    assert.equal(outcome.unmatched.length, 0);
    assert.equal(outcome.cameDown.length, 0);

    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: first.id },
      select: { state: true, url: true, delcampeItemId: true },
    });
    // The transition happens on the platform's own word, never at export time.
    assert.equal(offer.state, "active");
    assert.equal(offer.delcampeItemId, "2508054797");
    assert.equal(offer.url, "https://www.delcampe.net/en_US/collectibles/item/2508054797.html");

    const listing = await prisma.delcampeListing.findFirstOrThrow({
      where: { collectionId, itemId: "2508054797" },
    });
    assert.equal(listing.status, "ACTIVE");
    assert.equal(listing.offerId, first.id);
    assert.equal(listing.matchedBy, "reference");
    assert.equal(listing.presentPrice?.toFixed(2), "17.44");
    assert.equal(listing.currency, "EUR");
    assert.equal(listing.endsAt?.toISOString(), "2026-08-28T13:53:00.000Z");

    const state = await prisma.delcampeImportState.findUniqueOrThrow({ where: { collectionId } });
    assert.equal(state.lastFileName, "active-items-2026-08-18.csv");
    assert.equal(state.lastRowCount, 2);
  });

  it("notices what has come down, and changes nothing about the offer behind it", async () => {
    const kept = await prisma.delcampeListing.findFirstOrThrow({
      where: { collectionId, itemId: "2508054797" },
      select: { offerId: true, observedAt: true },
    });
    const [first, second] = await prisma.offer.findMany({
      where: { collectionId },
      orderBy: { offerNo: "asc" },
      select: { id: true, offerNo: true, state: true },
    });
    assert.equal(second.state, "active");

    const outcome = await importDelcampeActiveItems(
      userId,
      collectionId,
      file(line("2508054797", first.offerNo)),
      "active-items-2026-08-19.csv"
    );

    assert.equal(outcome.cameDown.length, 1);
    assert.equal(outcome.cameDown[0].itemId, "2508054798");
    assert.equal(outcome.cameDown[0].offerNo, second.offerNo);

    const gone = await prisma.delcampeListing.findFirstOrThrow({
      where: { collectionId, itemId: "2508054798" },
    });
    assert.equal(gone.status, "ENDED");
    // The date is when it was last seen **up**, and is not restamped by the import that noticed it.
    assert.ok(gone.observedAt.getTime() <= kept.observedAt.getTime());

    // The offer is untouched: absence says the listing came down, not that it sold, and which of
    // those it was is #612's question.
    const after = await prisma.offer.findUniqueOrThrow({
      where: { id: second.id },
      select: { state: true, delcampeItemId: true },
    });
    assert.equal(after.state, "active");
    assert.equal(after.delcampeItemId, "2508054798");

    const worklist = await getDelcampeWorklist(userId, collectionId);
    assert.equal(worklist.cameDown.length, 1);
    assert.equal(worklist.cameDown[0].offer.offerNo, second.offerNo);
    assert.equal(worklist.counts.up, 1);
    assert.equal(worklist.import.lastFileName, "active-items-2026-08-19.csv");
  });

  it("refuses both listings when two of them name one offer", async () => {
    const offer = await preparedOffer("Bavaria 1911 Luitpold", "4.00", "ready");

    const outcome = await importDelcampeActiveItems(
      userId,
      collectionId,
      file(line("2600000001", offer.offerNo), line("2600000002", offer.offerNo)),
      null
    );

    assert.equal(outcome.matched, 0);
    assert.equal(outcome.unmatched.length, 2);
    assert.ok(outcome.unmatched.every((row) => row.problem === "duplicate-reference"));

    // Neither is applied and the offer is left exactly as it was — the collector corrects one of the
    // two references on Delcampe and imports again.
    const after = await prisma.offer.findUniqueOrThrow({
      where: { id: offer.id },
      select: { state: true, delcampeItemId: true, url: true },
    });
    assert.equal(after.state, "ready");
    assert.equal(after.delcampeItemId, null);
    assert.equal(after.url, null);

    const worklist = await getDelcampeWorklist(userId, collectionId);
    const reported = worklist.unmatched.filter((row) => row.problem === "duplicate-reference");
    assert.equal(reported.length, 2);
    assert.equal(reported[0].referenceOfferNo, offer.offerNo);
  });

  it("reports a listing whose reference names no offer here", async () => {
    const outcome = await importDelcampeActiveItems(
      userId,
      collectionId,
      file(line("2700000001", 99_999), line("2700000002", null, { reference: "a note of my own" })),
      null
    );
    const problems = outcome.unmatched.map((row) => row.problem).sort();
    assert.deepEqual(problems, ["no-reference", "unknown-offer"]);
  });

  it("carries an auction's bidding onto the offer, and leaves a quick buy's price alone", async () => {
    const auction = await preparedOffer("Danzig 1923 airmail", "5.00", "active", "auction");
    const fixed = await preparedOffer("Silesia 1920 plebiscite", "9.00", "active");

    await importDelcampeActiveItems(
      userId,
      collectionId,
      file(
        line("2800000001", auction.offerNo, { price: "23.50", bids: 4 }),
        line("2800000002", fixed.offerNo, { price: "99.00" })
      ),
      null
    );

    const bid = await prisma.offer.findUniqueOrThrow({
      where: { id: auction.id },
      select: { price: true, bidderCount: true, inActiveBidding: true, priceCheckedAt: true, endsAt: true },
    });
    assert.equal(bid.price.toFixed(2), "23.50");
    assert.equal(bid.bidderCount, 4);
    assert.equal(bid.inActiveBidding, true);
    assert.ok(bid.priceCheckedAt);
    assert.equal(bid.endsAt?.toISOString(), "2026-08-28T13:53:00.000Z");

    // The quick buy's figure is the collector's own statement; a file that disagrees is drift
    // (#542) to be shown, not a number to be overwritten.
    const quick = await prisma.offer.findUniqueOrThrow({
      where: { id: fixed.id },
      select: { price: true, priceCheckedAt: true },
    });
    assert.equal(quick.price.toFixed(2), "9.00");
    assert.equal(quick.priceCheckedAt, null);
  });

  it("refuses a file that is not an active-items export, before it writes anything", async () => {
    await assert.rejects(
      () => importDelcampeActiveItems(userId, collectionId, "buyer,item\nA,B\n", "sold-items.csv"),
      (err: unknown) => err instanceof DelcampeImportError && /id_auction/.test(err.message)
    );
    const state = await prisma.delcampeImportState.findUniqueOrThrow({ where: { collectionId } });
    assert.notEqual(state.lastFileName, "sold-items.csv");
  });
});
