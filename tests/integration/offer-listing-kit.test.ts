import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import { setColnectConditionMapping } from "../../src/lib/colnect";
import { getOfferListingKit } from "../../src/lib/listing-kit";

// The listing kit (#405): one read that says what an offer wants filled into a marketplace form.
// The precondition rules themselves are unit-tested (`listing-preconditions.test.ts`); what needs a
// real database is the resolution behind them — the Colnect item-ID off the stamp (#247), the grade
// off the collection's condition mapping (#404), the quantity off the sets, and the refusal when any
// of the three has nothing to say.

describe("offer listing kit (#405)", () => {
  let userId: string;
  let collectionId: string;
  let otherUserId: string;
  let otherCollectionId: string;
  let platformId: string;
  let mnhId: string;
  let usedId: string;
  // The pieces an unknown-variant umbrella's item-ID is derived through (#616): a priced catalogue
  // in an area that names it, and a subtype whose children act as variants.
  let vendorId: string;
  let catalogEditionId: string;
  let areaId: string;
  let variantSubtypeId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-kit-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User kit-${ts}`,
        email: `test-kit-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    otherUserId = `test-user-kit-other-${ts}`;
    await prisma.user.create({
      data: {
        id: otherUserId,
        name: `Test User kit other-${ts}`,
        email: `test-kit-other-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-kit-${ts}`,
          name: `Collection kit-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-kit-other-${ts}`,
          name: `Collection kit other-${ts}`,
          baseCurrency: "EUR",
          ownerId: otherUserId,
        },
      })
    ).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Colnect",
          platform: true,
          platformModule: "colnect",
          platformCurrency: "EUR",
          descriptionTemplate: "Stamps as pictured.",
        },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    const catalogNameId = (
      await prisma.catalogName.create({
        data: { vendorId, name: "Michel Katalog", currency: "EUR" },
      })
    ).id;
    catalogEditionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId, year: 2024 } })
    ).id;
    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogNameId },
      })
    ).id;
    // The area's own catalogue and its vendor prefix, which is what a number is printed with
    // (`Mi·PL 900b`, #66) — the form a variant is named in when the listing says what it went under.
    await prisma.collectionAreaCatalog.create({
      data: { collectionAreaId: areaId, catalogNameId },
    });
    await prisma.collectionAreaVendor.create({
      data: { collectionAreaId: areaId, catalogVendorId: vendorId, areaPrefix: "PL" },
    });
    variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: {
          collectionId,
          name: "Colour variety",
          actsAsVariant: true,
          isDefault: true,
          sortOrder: 0,
        },
      })
    ).id;
    // Only MNH is mapped to start with; the Used case is what the unmapped precondition rides on.
    await setColnectConditionMapping(userId, mnhId, "1");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.collection.deleteMany({ where: { ownerId: otherUserId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  let seq = 0;

  /** A stamp carrying (or not) a Colnect item-ID (#247). */
  async function stamp(name: string, colnectId: string | null): Promise<string> {
    seq += 1;
    return (
      await prisma.stamp.create({ data: { collectionId, name: `${name} ${seq}`, colnectId } })
    ).id;
  }

  /** A base stamp with variant children (ADR-0010 §3), each priced and each with its own number and
   *  item-ID — the shape an umbrella listing is derived over (#616). Returns the umbrella. */
  async function umbrella(
    name: string,
    /** `price` absent leaves the variant unpriced, which is what an unresolvable rollup needs (#617). */
    variants: {
      number: string;
      colnectId: string | null;
      price?: string;
      conditionId?: string;
    }[]
  ): Promise<string> {
    seq += 1;
    const base = await prisma.stamp.create({
      data: { collectionId, name: `${name} ${seq}`, colnectId: null },
    });
    await prisma.stampCollectionArea.create({
      data: { stampId: base.id, collectionAreaId: areaId, isPrimary: true },
    });
    for (const v of variants) {
      const child = await prisma.stamp.create({
        data: {
          collectionId,
          parentId: base.id,
          name: `${name} ${seq} ${v.number}`,
          subtypeId: variantSubtypeId,
          colnectId: v.colnectId,
        },
      });
      await prisma.stampCollectionArea.create({
        data: { stampId: child.id, collectionAreaId: areaId, isPrimary: true },
      });
      await prisma.stampCatalogNumber.create({
        data: { stampId: child.id, catalogVendorId: vendorId, number: v.number },
      });
      if (v.price !== undefined) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: child.id,
            catalogEditionId,
            conditionId: v.conditionId ?? mnhId,
            certificateStatusId: null,
            price: v.price,
            currency: "EUR",
          },
        });
      }
    }
    return base.id;
  }

  async function copy(stampId: string, conditionId = mnhId): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  /** An offer over the given sets, moved to `ready` unless asked otherwise. */
  async function offer(
    sets: string[][],
    over: { state?: "preparing" | "ready"; price?: string } = {}
  ): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: over.price ?? "12.50",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    for (const itemIds of sets) await addOfferSet(userId, offerId, itemIds);
    // Written directly rather than through `setOfferState`: several of these offers fail a listing
    // precondition on purpose — the endpoint's refusal is what is under test — and that same
    // evaluation now gates the transition (#418, `offer-ready-gate.test.ts`).
    if ((over.state ?? "ready") === "ready") {
      await prisma.offer.update({ where: { id: offerId }, data: { state: "ready" } });
    }
    return offerId;
  }

  it("serves the payload for a Ready offer: item-IDs, graded conditions, quantity, price, texts", async () => {
    const a = await stamp("PL a", "1001");
    const b = await stamp("PL b", "1002");
    const offerId = await offer([
      [await copy(a), await copy(b)],
      [await copy(a), await copy(b)],
    ]);

    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.ok(kit);
    assert.deepEqual(kit.blockers, []);
    assert.equal(kit.state, "ready");
    assert.equal(kit.platform.name, "Colnect");
    assert.equal(kit.price, "12.50");
    assert.equal(kit.currency, "EUR");
    // Two interchangeable sets are one listing of quantity 2, described by one of them.
    assert.equal(kit.quantity, 2);
    assert.deepEqual(
      kit.items.map((i) => i.catalogItemId),
      ["1001", "1002"]
    );
    assert.deepEqual(
      kit.items.map((i) => [i.condition.platformValue, i.condition.platformLabel]),
      [
        ["1", "MNH - Mint Never Hinged"],
        ["1", "MNH - Mint Never Hinged"],
      ]
    );
    assert.equal(kit.description, "Stamps as pictured.");
    assert.equal(kit.descriptionFormat, "plain");
    assert.ok(kit.title.length > 0);
    // Nothing has been generated, so the upload set is empty rather than absent.
    assert.deepEqual(kit.photos.images, []);
    assert.equal(kit.photos.status, "none");
  });

  it("refuses a platform the Assistant has no module for, and says nothing else", async () => {
    const handListed = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    const offerId = await createOffer(userId, collectionId, {
      platformId: handListed,
      url: null,
      price: "9.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [await copy(await stamp("PL hand", null))]);
    await setOfferState(userId, offerId, "ready");

    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(kit?.blockers.map((b) => b.code), ["no-platform-module"]);
    assert.equal(kit?.platform.module, null);
  });

  it("refuses an offer that is not Ready", async () => {
    const offerId = await offer([[await copy(await stamp("PL c", "1003"))]], {
      state: "preparing",
    });
    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(kit?.blockers.map((b) => b.code), ["not-ready"]);
  });

  it("refuses a copy whose stamp carries no Colnect item-ID, and names the stamp", async () => {
    const unmatched = await stamp("PL d", null);
    const offerId = await offer([[await copy(await stamp("PL e", "1004")), await copy(unmatched)]]);

    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(kit?.blockers.map((b) => b.code), ["missing-catalog-id"]);
    assert.deepEqual(kit?.blockers[0].stampIds, [unmatched]);
    // The payload still says what it knows — nothing is guessed into the gap.
    assert.deepEqual(
      kit?.items.map((i) => i.catalogItemId),
      ["1004", null]
    );
  });

  it("refuses a condition with no Colnect grade, then serves it once mapped", async () => {
    const offerId = await offer([[await copy(await stamp("PL f", "1005"), usedId)]]);

    const before = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(before?.blockers.map((b) => b.code), ["unmapped-condition"]);
    assert.deepEqual(before?.blockers[0].subjects, ["Used"]);
    assert.equal(before?.items[0].condition.platformValue, null);

    await setColnectConditionMapping(userId, usedId, "4");
    try {
      const after = await getOfferListingKit(userId, collectionId, offerId);
      assert.deepEqual(after?.blockers, []);
      assert.equal(after?.items[0].condition.platformValue, "4");
      assert.equal(after?.items[0].condition.platformLabel, "U - Used");
    } finally {
      await setColnectConditionMapping(userId, usedId, null);
    }
  });

  it("refuses sets that are not interchangeable — a quantity would misdescribe them", async () => {
    const a = await stamp("PL g", "1006");
    const b = await stamp("PL h", "1007");
    const offerId = await offer([[await copy(a)], [await copy(b)]]);

    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(kit?.blockers.map((b) => b.code), ["mixed-sets"]);
    assert.equal(kit?.quantity, 2);
  });

  // ── An unknown-variant umbrella (#616) ─────────────────────────────────────
  //
  // Colnect keys a sale on one specific variant, and the practice for a piece that cannot be resolved
  // that far is to list it under its **cheapest** one. The item-ID is derived by the same rule that
  // values the copy, so a listing and its valuation cannot describe different variants.

  it("lists an unknown-variant umbrella under its cheapest variant, and names it", async () => {
    const base = await umbrella("PL var", [
      { number: "900a", colnectId: "2001", price: "30.00" },
      { number: "900b", colnectId: "2002", price: "12.00" },
      { number: "900c", colnectId: "2003", price: "40.00" },
    ]);
    const offerId = await offer([[await copy(base)]]);

    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(kit?.blockers, []);
    assert.equal(kit?.items[0].catalogItemId, "2002");
    assert.equal(kit?.items[0].catalogItemSource?.label, "Mi·PL 900b");
    // Nothing is written back: the umbrella is still unmatched, this being a claim about one
    // listing rather than about the stamp's identity.
    assert.equal(
      (await prisma.stamp.findUnique({ where: { id: base }, select: { colnectId: true } }))
        ?.colnectId,
      null
    );
  });

  it("resolves per condition — the cheapest MNH variant need not be the cheapest used", async () => {
    const base = await umbrella("PL var cond", [
      { number: "910a", colnectId: "2101", price: "30.00" },
      { number: "910b", colnectId: "2102", price: "12.00" },
    ]);
    // The second variant is dear used, so the used copy stands under the first.
    await prisma.stampCatalogPrice.createMany({
      data: [
        {
          stampId: (await prisma.stamp.findFirstOrThrow({
            where: { parentId: base, catalogNumbers: { some: { number: "910a" } } },
            select: { id: true },
          })).id,
          catalogEditionId,
          conditionId: usedId,
          certificateStatusId: null,
          price: "5.00",
          currency: "EUR",
        },
        {
          stampId: (await prisma.stamp.findFirstOrThrow({
            where: { parentId: base, catalogNumbers: { some: { number: "910b" } } },
            select: { id: true },
          })).id,
          catalogEditionId,
          conditionId: usedId,
          certificateStatusId: null,
          price: "18.00",
          currency: "EUR",
        },
      ],
    });
    await setColnectConditionMapping(userId, usedId, "4");
    try {
      const mnh = await getOfferListingKit(
        userId,
        collectionId,
        await offer([[await copy(base, mnhId)]])
      );
      const used = await getOfferListingKit(
        userId,
        collectionId,
        await offer([[await copy(base, usedId)]])
      );
      assert.equal(mnh?.items[0].catalogItemId, "2102");
      assert.equal(used?.items[0].catalogItemId, "2101");
    } finally {
      await setColnectConditionMapping(userId, usedId, null);
    }
  });

  it("keeps an umbrella's own item-ID where one was matched by hand", async () => {
    const base = await umbrella("PL var matched", [
      { number: "920a", colnectId: "2201", price: "12.00" },
    ]);
    await prisma.stamp.update({ where: { id: base }, data: { colnectId: "2200" } });
    const kit = await getOfferListingKit(
      userId,
      collectionId,
      await offer([[await copy(base)]])
    );
    assert.equal(kit?.items[0].catalogItemId, "2200");
    assert.equal(kit?.items[0].catalogItemSource, null);
  });

  it("still refuses when the cheapest variant carries no item-ID of its own", async () => {
    const base = await umbrella("PL var unmatched", [
      { number: "930a", colnectId: null, price: "12.00" },
      { number: "930b", colnectId: "2302", price: "30.00" },
    ]);
    const kit = await getOfferListingKit(
      userId,
      collectionId,
      await offer([[await copy(base)]])
    );
    // The dearer variant is not tried in its place: that would stand the listing under a different
    // claim about the goods.
    assert.deepEqual(kit?.blockers.map((b) => b.code), ["missing-catalog-id"]);
    assert.equal(kit?.items[0].catalogItemId, null);
    // And it is the **variant** that is named (#617), not the umbrella the collector picked: that is
    // the stamp the match window has to be pointed at.
    assert.deepEqual(kit?.blockers[0].subjects, ["Mi·PL 930a"]);
    const cheapest = await prisma.stamp.findFirstOrThrow({
      where: { parentId: base, catalogNumbers: { some: { number: "930a" } } },
      select: { id: true },
    });
    assert.deepEqual(kit?.blockers[0].stampIds, [cheapest.id]);
  });

  it("refuses a tree where nothing is priced, and names the variants (#617)", async () => {
    // Nothing under the umbrella is priced, so the rollup has nothing to choose between — a gap in
    // the catalogue prices, fixed in each variant's own price grid, and not the same fault as an
    // unmatched variant.
    const base = await umbrella("PL var unpriced", [
      { number: "940a", colnectId: "2401" },
      { number: "940b", colnectId: "2402" },
    ]);
    const kit = await getOfferListingKit(
      userId,
      collectionId,
      await offer([[await copy(base)]])
    );
    assert.deepEqual(kit?.blockers.map((b) => b.code), ["no-variant-price"]);
    assert.equal(kit?.items[0].catalogItemId, null);
    assert.deepEqual(kit?.blockers[0].subjects, ["Mi\u00b7PL 940a", "Mi\u00b7PL 940b"]);
  });

  it("refuses a **partly** priced tree — the cheapest variant is not known yet (#617)", async () => {
    // The one price recorded happens to sit on the dearest variant. Listing under it because it is
    // the only priced one would quietly sell the copy under exactly the wrong entry, so the offer is
    // refused and the unpriced variants are named.
    const base = await umbrella("PL var partly priced", [
      { number: "950a", colnectId: "2501" },
      { number: "950b", colnectId: "2502", price: "80.00" },
      { number: "950c", colnectId: "2503" },
    ]);
    const kit = await getOfferListingKit(
      userId,
      collectionId,
      await offer([[await copy(base)]])
    );
    assert.deepEqual(kit?.blockers.map((b) => b.code), ["no-variant-price"]);
    assert.equal(kit?.items[0].catalogItemId, null);
    assert.equal(kit?.items[0].catalogItemSource, null);
    assert.deepEqual(kit?.blockers[0].subjects, ["Mi\u00b7PL 950a", "Mi\u00b7PL 950c"]);
    const unpriced = await prisma.stamp.findMany({
      where: { parentId: base, catalogNumbers: { some: { number: { in: ["950a", "950c"] } } } },
      select: { id: true },
      orderBy: { name: "asc" },
    });
    assert.deepEqual(
      [...(kit?.blockers[0].stampIds ?? [])].sort(),
      unpriced.map((s) => s.id).sort()
    );
  });

  it("expects no price of an intermediate variant — its value is its own children's (#617)", async () => {
    // A deep tree (309 \u2192 309A \u2192 309AP): the middle node is itself an umbrella, so a catalog
    // prices it through its children and an unpriced one is not a gap. Every leaf being priced, the
    // listing resolves to the cheapest of them.
    const base = await umbrella("PL var deep", [{ number: "960a", colnectId: "2601", price: "40.00" }]);
    const middle = await prisma.stamp.create({
      data: {
        collectionId,
        parentId: base,
        name: "PL var deep middle",
        subtypeId: variantSubtypeId,
        colnectId: "2610",
      },
    });
    await prisma.stampCollectionArea.create({
      data: { stampId: middle.id, collectionAreaId: areaId, isPrimary: true },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: middle.id, catalogVendorId: vendorId, number: "960b" },
    });
    const leaf = await prisma.stamp.create({
      data: {
        collectionId,
        parentId: middle.id,
        name: "PL var deep leaf",
        subtypeId: variantSubtypeId,
        colnectId: "2611",
      },
    });
    await prisma.stampCollectionArea.create({
      data: { stampId: leaf.id, collectionAreaId: areaId, isPrimary: true },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: leaf.id, catalogVendorId: vendorId, number: "960ba" },
    });
    await prisma.stampCatalogPrice.create({
      data: {
        stampId: leaf.id,
        catalogEditionId,
        conditionId: mnhId,
        certificateStatusId: null,
        price: "15.00",
        currency: "EUR",
      },
    });

    const kit = await getOfferListingKit(
      userId,
      collectionId,
      await offer([[await copy(base)]])
    );
    assert.deepEqual(kit?.blockers, []);
    assert.equal(kit?.items[0].catalogItemId, "2611");
    assert.equal(kit?.items[0].catalogItemSource?.label, "Mi\u00b7PL 960ba");
  });

  it("is null for another owner's offer and for the wrong collection", async () => {
    const offerId = await offer([[await copy(await stamp("PL i", "1008"))]]);
    assert.equal(await getOfferListingKit(otherUserId, collectionId, offerId), null);
    assert.equal(await getOfferListingKit(userId, otherCollectionId, offerId), null);
  });
});
