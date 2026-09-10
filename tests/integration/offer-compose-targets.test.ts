import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  findStampConditionCollisions,
  listComposeTargetSetCopies,
  listComposeTargets,
  patchOffer,
} from "../../src/lib/offers";
import { catalogKeyMatches } from "../../src/lib/catalog-number";

// What the Add-to-offer picker is handed when it opens (#188, #867).
//
// #867 took the enriched copies out of it: they were read for every set of every non-terminal offer
// in the collection, and the picker only wants them for a set the collector actually expands. What
// stayed behind is the part the closed picker genuinely uses them for — whether a set matches the
// search box — which is now resolved on the server, so the cases below are the ones that would
// silently stop matching if that resolution ever drifted from the labeller's.
//
// The collision half (#513, narrowed by #732) is deliberately re-checked here rather than taken on
// trust: `offers.ts` records that the picker's note and the selection bar's chip read one source so
// that they cannot disagree, and a change that narrows what the picker reads is exactly how that
// stops being true.

describe("Add-to-offer picker targets (#867)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let platformId: string;
  let conditionId: string;
  /** The copy in the offer below: Michel Poland 200, in "Album 1 · A-14", issue "Definitives". */
  let listed: string;
  let offerId: string;
  let offerSetId: string;
  /** A second copy of the very same stamp + condition, unlisted — the collision candidate. */
  let candidate: string;
  /** A set in another collection, for the lazy read's scoping. */
  let foreignSetId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-compose-targets-${ts}`;
    otherUserId = `test-user-compose-targets-other-${ts}`;
    for (const [id, tag] of [
      [userId, "ct"],
      [otherUserId, "ct-other"],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${tag}-${ts}`,
          email: `test-${tag}-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-ct-${ts}`, name: `Collection ct-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-ct-other-${ts}`,
          name: `Collection ct-other-${ts}`,
          baseCurrency: "EUR",
          ownerId: otherUserId,
        },
      })
    ).id;

    platformId = (await prisma.contact.create({ data: { collectionId, name: "Colnect", platform: true } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const area = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "Poland",
        catalogPrefix: "PL",
        primaryCatalogVendorId: vendor.id,
        collectionAreaVendors: { create: [{ catalogVendorId: vendor.id }] },
      },
    });
    const issue = await prisma.issue.create({
      data: { collectionId, issueNo: 9101, collectionAreaId: area.id, name: "Definitives", year: 1960 },
    });

    const stamp = await prisma.stamp.create({
      data: {
        collectionId,
        name: "Warsaw Mermaid",
        stampAreaLinks: { create: [{ collectionAreaId: area.id, isPrimary: true }] },
      },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: stamp.id, catalogVendorId: vendor.id, number: "200" },
    });
    await prisma.issueMember.create({ data: { issueId: issue.id, stampId: stamp.id } });

    const location = await prisma.location.create({ data: { collectionId, name: "Album 1" } });
    listed = (await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true })).id;
    await prisma.item.update({
      where: { id: listed },
      data: { locationId: location.id, locationRef: "A-14" },
    });
    candidate = (await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true })).id;

    offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "9.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    offerSetId = await addOfferSet(userId, offerId, [listed]);

    // A set in a collection this user does not own, for the lazy read's scoping.
    const foreignPlatform = await prisma.contact.create({
      data: { collectionId: otherCollectionId, name: "Colnect", platform: true },
    });
    const foreignCondition = await prisma.stampCondition.create({
      data: { collectionId: otherCollectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    const foreignStamp = await prisma.stamp.create({
      data: { collectionId: otherCollectionId, name: "Elsewhere" },
    });
    const foreignItem = await createItem(otherUserId, otherCollectionId, {
      stampId: foreignStamp.id,
      conditionId: foreignCondition.id,
      forSale: true,
    });
    const foreignOffer = await createOffer(otherUserId, otherCollectionId, {
      platformId: foreignPlatform.id,
      url: null,
      price: "1.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    foreignSetId = await addOfferSet(otherUserId, foreignOffer, [foreignItem.id]);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  async function theSet() {
    const { offers } = await listComposeTargets(userId, collectionId, [candidate]);
    const offer = offers.find((o) => o.offerId === offerId);
    assert.ok(offer, "the preparing offer is a target");
    const set = offer.sets.find((s) => s.offerSetId === offerSetId);
    assert.ok(set, "its set is listed");
    return { offer, set };
  }

  it("carries the set's stamp name, issue name and location ref as one search string", async () => {
    const { set } = await theSet();
    // Lowercased, because every caller of it lowercases the query and nothing else.
    assert.match(set.searchText, /warsaw mermaid/);
    assert.match(set.searchText, /definitives/);
    assert.match(set.searchText, /a-14/);
  });

  it("carries catalog match keys that resolve the area's prefix, so every spelling hits", async () => {
    const { set } = await theSet();
    // The three spellings the picker's box has always accepted (#104): the full identity, the
    // prefix run together, and the bare number.
    for (const typed of ["Mi PL 200", "PL200", "200", "mi·pl 200"]) {
      assert.ok(catalogKeyMatches(typed, set.catalogKeys), `"${typed}" should match`);
    }
    // …and a number this stamp does not carry still does not.
    assert.equal(catalogKeyMatches("Mi PL 201", set.catalogKeys), false);
  });

  it("enriches a set's copies only when asked, and returns them under the set's own ids", async () => {
    const copies = await listComposeTargetSetCopies(userId, collectionId, offerSetId);
    assert.ok(copies);
    assert.deepEqual(
      copies.map((c) => c.id),
      [listed]
    );
    // A full inventory row, which is what the expandable details render.
    assert.equal(copies[0].stampName, "Warsaw Mermaid");
    assert.equal(copies[0].locationRef, "A-14");
    assert.ok(copies[0].value, "the row carries its valuation");
  });

  it("reads a set outside the collection as absent rather than as somebody else's copies", async () => {
    assert.equal(await listComposeTargetSetCopies(userId, collectionId, foreignSetId), null);
    assert.equal(await listComposeTargetSetCopies(userId, collectionId, "no-such-set"), null);
  });

  // The row's two labels (#1023). The picker used to read the derived label alone, so a listing
  // could not be found by the title the collector had written on it — while the search box's
  // placeholder promised *by offer*. Both halves are checked here because they are one behaviour:
  // the field the row prints and the field the box matches are the same field.
  it("carries the offer's stored title beside the derived label, and null while it has none", async () => {
    const stored = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { name: true },
    });
    const { offer } = await theSet();
    assert.equal(offer.name, stored.name, "the picker reports the title the offer actually holds");
    // The derived label keeps its own field whatever the title says: it is the row's second line
    // once there is a title, and its first line while there is not. Never concatenated into one.
    assert.equal(offer.label, offer.sets[0].label, "one set reads as that set's label");

    await patchOffer(userId, offerId, { name: "Poland definitives — dealer lot" });
    const titled = (await theSet()).offer;
    assert.equal(titled.name, "Poland definitives — dealer lot");
    assert.equal(titled.label, offer.label, "the derived label is untouched by the title");

    // Blank clears it back to null and the row falls back to the derived label alone (#209).
    await patchOffer(userId, offerId, { name: null });
    assert.equal((await theSet()).offer.name, null);
  });

  it("still reports the stamp × condition collision, from the source the chip reads (#513/#732)", async () => {
    const { offer } = await theSet();
    assert.deepEqual(offer.collidingItemIds, [candidate]);
    // The selection bar's chip, asked the same question through the other entry point: one source,
    // so the two cannot disagree about what collides.
    const chip = await findStampConditionCollisions(userId, collectionId, [candidate], { platformId });
    assert.deepEqual(
      chip.map((c) => c.offerId),
      [offerId]
    );
    assert.deepEqual(chip[0].itemIds, offer.collidingItemIds);
  });

  it("never disables a colliding destination — it holds none of the copies being added", async () => {
    const { offer } = await theSet();
    // `containsItemIds` is what the picker disables on, and a collision is through *other* copies,
    // so it stays empty: the destination is warned about and remains pickable.
    assert.deepEqual(offer.containsItemIds, []);
    assert.deepEqual(offer.sets[0].containsItemIds, []);
  });

  it("reports a copy the offer already lists, so the picker can leave it out of the add", async () => {
    const { offer, set } = (await (async () => {
      const { offers } = await listComposeTargets(userId, collectionId, [listed]);
      const o = offers.find((x) => x.offerId === offerId)!;
      return { offer: o, set: o.sets[0] };
    })());
    assert.deepEqual(offer.containsItemIds, [listed]);
    assert.deepEqual(set.containsItemIds, [listed]);
  });
});
