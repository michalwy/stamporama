import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, setOfferState, patchOffer } from "../../src/lib/offers";
import { listSellableOffers } from "../../src/lib/sales";

// What the sale-line dialog calls an offer (#1026, following #1023 for the Add-to-offer picker).
//
// `listSellableOffers` selected no `Offer.name` at all and labelled every row
// `labeller.offer(r.sets)`, so a listing could not be found in that dialog by the title the
// collector had written on it — while the search box promised *Filter by offer*. The reader now
// carries `offerName` beside `offerLabel`, and the dialog prints the first with the second beneath
// it and matches both.
//
// The titled and the untitled case are checked together on purpose: a fallback seen only where it
// falls back is half a look, and what the row prints and what the box matches are the same fields.
describe("sellable offers name a listing by its title (#1026)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let titledId: string;
  let untitledId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-sellname-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User sellname-${ts}`,
        email: `test-sellname-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-sellname-${ts}`,
        name: `Collection sellname-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp S" } });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;

    const mk = async () =>
      (await createItem(userId, collectionId, { stampId: stamp.id, conditionId: condition.id, forSale: true })).id;

    // Two live listings on one platform: one the collector named, one he did not. Only `active`
    // offers are sellable, so each goes preparing → ready → active once its set is composed.
    titledId = await createOffer(userId, collectionId, {
      platformId, url: null, price: "5.00", currency: "EUR", listingDate: null, state: "preparing",
    });
    await addOfferSet(userId, titledId, [await mk()]);
    untitledId = await createOffer(userId, collectionId, {
      platformId, url: null, price: "6.00", currency: "EUR", listingDate: null, state: "preparing",
    });
    await addOfferSet(userId, untitledId, [await mk()]);
    for (const id of [titledId, untitledId]) {
      await setOfferState(userId, id, "ready");
      await setOfferState(userId, id, "active");
    }
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const read = async (offerId: string) => {
    const rows = await listSellableOffers(userId, collectionId, { platformId });
    const hit = rows.find((o) => o.offerId === offerId);
    assert.ok(hit, "the live listing is sellable");
    return hit!;
  };

  it("carries the stored title beside the derived label, and null where there is none", async () => {
    const untitled = await read(untitledId);
    assert.equal(untitled.offerName, null, "an untitled listing reports no title");
    assert.ok(untitled.offerLabel.length > 0, "…and still carries the label derived from its sets");

    await patchOffer(userId, titledId, { name: "Poland definitives — dealer lot" });
    const titled = await read(titledId);
    assert.equal(titled.offerName, "Poland definitives — dealer lot");

    // The derived label keeps its own field whatever the title says: the dialog prints it *beneath*
    // the title, never concatenated onto it, and never twice where there is no title.
    const derived = titled.offerLabel;
    assert.ok(derived.length > 0);
    assert.ok(
      !derived.includes("Poland definitives"),
      "the derived label is derived from the sets, not from the title"
    );

    // Blank clears it back to null (#209) and the row falls back to the derived label alone.
    await patchOffer(userId, titledId, { name: null });
    const cleared = await read(titledId);
    assert.equal(cleared.offerName, null);
    assert.equal(cleared.offerLabel, derived, "clearing the title leaves the derived label untouched");
  });

  it("gives the dialog's search a title to match that the derived label does not carry", async () => {
    // The point of the second field: the box runs one comparison over both, so a collector who
    // remembers what he called the listing finds it, and one who remembers what is in it still
    // does. Were the reader still label-only, the first of these would be unmatchable.
    await patchOffer(userId, titledId, { name: "Kilo box — August" });
    const titled = await read(titledId);
    const q = "kilo box";
    assert.ok(
      titled.offerName!.toLowerCase().includes(q),
      "the title the collector typed is on the wire for the box to match"
    );
    assert.ok(
      !titled.offerLabel.toLowerCase().includes(q),
      "and it is not reachable through the derived label — which is why the field had to be added"
    );
    await patchOffer(userId, titledId, { name: null });
  });
});
