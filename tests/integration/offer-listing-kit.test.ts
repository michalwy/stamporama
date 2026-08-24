import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, getOfferDetail, setOfferState } from "../../src/lib/offers";
import { setColnectConditionMapping } from "../../src/lib/colnect";
import { getOfferListingKit } from "../../src/lib/listing-kit";
import { addSaleLines, createSale } from "../../src/lib/sales";
import {
  getOfferListedVariantChoice,
  setOfferListedVariant,
} from "../../src/lib/listing-variant-choice";

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
    // Sales first: a sold copy is `Restrict`-ed by `sale_line_item` (the no-double-sale backstop),
    // so the collection cannot be cascaded away while its sales still name the copies — this file
    // sells one since #700.
    await prisma.sale.deleteMany({ where: { collectionId } });
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

  it("counts only what is still there to buy after a partial sale (#700)", async () => {
    const a = await stamp("PL sold-a", "1301");
    const offerId = await offer([[await copy(a)], [await copy(a)], [await copy(a)]]);
    await prisma.offer.update({ where: { id: offerId }, data: { state: "active" } });

    const before = await getOfferListingKit(userId, collectionId, offerId);
    assert.equal(before?.quantity, 3);

    // One set sells through this very offer — the listing stays up for the other two.
    const sets = await prisma.offerSet.findMany({
      where: { offerId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, items: { select: { itemId: true } } },
    });
    const saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-08-24"),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    await addSaleLines(userId, saleId, [
      {
        offerId,
        offerSetId: sets[0].id,
        price: "12.50",
        itemIds: sets[0].items.map((i) => i.itemId),
      },
    ]);

    const after = await getOfferListingKit(userId, collectionId, offerId);
    // The form the Assistant fills must offer two, not the three the offer has ever held: the sold
    // copy has gone, and the photo plan already stopped picturing it (#315).
    assert.equal(after?.quantity, 2);
    // …and the copies it describes come from a set that is still there.
    const soldItemIds = new Set(sets[0].items.map((i) => i.itemId));
    assert.ok(after?.items.every((i) => !soldItemIds.has(i.itemId)));
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

  // ── What the **On Colnect** card says about that variant (#423/#616) ───────
  //
  // The card reads the same resolution the kit does, so the two can never name different variants —
  // which is the whole reason these live beside the kit's own cases rather than in a suite of their
  // own: the umbrella fixtures above are exactly what they need. What is checked here is the half
  // the kit has no opinion on — which entry the row's *links* stand under, and whether the row says
  // so while the listing is still blocked.

  it("names the cheapest variant on the card and points the row's links at it", async () => {
    const base = await umbrella("PL card var", [
      { number: "970a", colnectId: "2701", price: "30.00" },
      { number: "970b", colnectId: "2702", price: "12.00" },
    ]);
    const detail = await getOfferDetail(userId, await offer([[await copy(base)]]));
    const row = detail!.platformItems[0];
    assert.equal(row.catalogItemVariant, "Mi\u00b7PL 970b");
    assert.ok(row.catalogUrl?.endsWith("2702"), "the catalog link opens the variant's page");
    assert.ok(row.marketUrl?.includes("2702"), "and the market search asks about that variant");
    assert.equal(row.searchUrl, null, "a matched entry has a page, so nothing to search for");
  });

  it("names the variant that has to be matched, and searches for **its** number", async () => {
    // The one case the card used to go silent on, and the one where knowing the target matters most:
    // the listing is blocked precisely because this variant carries no item-ID. Searching the
    // umbrella's number would take the collector to a page they must not match it to — that would
    // assert the umbrella *is* that variant (#616).
    const base = await umbrella("PL card unmatched", [
      { number: "980a", colnectId: null, price: "12.00" },
      { number: "980b", colnectId: "2802", price: "30.00" },
    ]);
    const detail = await getOfferDetail(userId, await offer([[await copy(base)]]));
    const row = detail!.platformItems[0];
    assert.equal(row.catalogItemVariant, "Mi\u00b7PL 980a");
    assert.equal(row.catalogUrl, null);
    assert.equal(row.marketUrl, null);
    assert.ok(row.searchUrl?.includes("PL+980a"), `searched for the variant: ${row.searchUrl}`);
    assert.equal(row.unpricedVariantStampId, null, "this is a matching gap, not a pricing one");
  });

  it("names no variant while the tree is not fully priced — none is known to be cheapest", async () => {
    const base = await umbrella("PL card unpriced", [
      { number: "990a", colnectId: "2901" },
      { number: "990b", colnectId: "2902", price: "12.00" },
    ]);
    const detail = await getOfferDetail(userId, await offer([[await copy(base)]]));
    const row = detail!.platformItems[0];
    assert.equal(row.catalogItemVariant, null);
    assert.equal(row.unpricedVariantStampId, base, "the row offers the price grid instead");
  });

  it("names nothing on an umbrella matched by hand — it stands under itself", async () => {
    const base = await umbrella("PL card own id", [
      { number: "995a", colnectId: "2951", price: "12.00" },
    ]);
    await prisma.stamp.update({ where: { id: base }, data: { colnectId: "2950" } });
    const detail = await getOfferDetail(userId, await offer([[await copy(base)]]));
    const row = detail!.platformItems[0];
    assert.equal(row.catalogItemVariant, null);
    assert.ok(row.catalogUrl?.endsWith("2950"));
  });

  // ── Saying by hand which variant it is listed under ───────────────────────
  //
  // The derivation above is a default. `OfferListedVariant` is the collector overriding it on one
  // offer — for a piece they can rule a variant out on, for the variant that is actually traded, or
  // to post an offer without pricing a whole tree first. It short-circuits the rollup rather than
  // competing with it, so what is checked here is that every reader takes the same answer and that
  // the two things a choice must not do — write to the stamp, move the valuation — still hold.

  /** The variant of `base` carrying `number`. */
  async function variantOf(base: string, number: string): Promise<string> {
    return (
      await prisma.stamp.findFirstOrThrow({
        where: { parentId: base, catalogNumbers: { some: { number } } },
        select: { id: true },
      })
    ).id;
  }

  it("lists under the variant the offer names, not the cheapest one", async () => {
    const base = await umbrella("PL chosen", [
      { number: "8010a", colnectId: "3001", price: "30.00" },
      { number: "8010b", colnectId: "3002", price: "12.00" },
    ]);
    const offerId = await offer([[await copy(base)]]);
    // Left alone it would go under `8010b`, the cheapest.
    assert.equal((await getOfferListingKit(userId, collectionId, offerId))?.items[0].catalogItemId, "3002");

    await setOfferListedVariant(userId, offerId, base, mnhId, await variantOf(base, "8010a"));
    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(kit?.blockers, []);
    assert.equal(kit?.items[0].catalogItemId, "3001");
    assert.equal(kit?.items[0].catalogItemSource?.label, "Mi\u00b7PL 8010a");

    // The card reads the same answer and says it was chosen rather than inferred.
    const row = (await getOfferDetail(userId, offerId))!.platformItems[0];
    assert.equal(row.catalogItemVariant, "Mi\u00b7PL 8010a");
    assert.equal(row.catalogItemVariantChosen, true);
    assert.ok(row.catalogUrl?.endsWith("3001"));
    assert.equal(row.variantChoiceStampId, base, "the row can still open the picker");

    // And nothing was written onto the stamp: the umbrella is still an unidentified variant.
    assert.equal(
      (await prisma.stamp.findUnique({ where: { id: base }, select: { colnectId: true } }))?.colnectId,
      null
    );
  });

  it("answers a tree that is not fully priced, which the derivation refuses (#617)", async () => {
    // The whole point of the escape hatch: knowing what you want to sell should not require pricing
    // every variant first.
    const base = await umbrella("PL chosen unpriced", [
      { number: "8020a", colnectId: "3101" },
      { number: "8020b", colnectId: "3102", price: "12.00" },
    ]);
    const offerId = await offer([[await copy(base)]]);
    assert.deepEqual(
      (await getOfferListingKit(userId, collectionId, offerId))?.blockers.map((b) => b.code),
      ["no-variant-price"]
    );

    await setOfferListedVariant(userId, offerId, base, mnhId, await variantOf(base, "8020a"));
    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(kit?.blockers, []);
    assert.equal(kit?.items[0].catalogItemId, "3101");
    const row = (await getOfferDetail(userId, offerId))!.platformItems[0];
    assert.equal(row.unpricedVariantStampId, null, "the pricing gap no longer blocks this listing");
    assert.equal(row.catalogItemVariant, "Mi\u00b7PL 8020a");
  });

  it("still refuses a chosen variant that carries no item-ID, naming that variant", async () => {
    const base = await umbrella("PL chosen unmatched", [
      { number: "8030a", colnectId: null, price: "30.00" },
      { number: "8030b", colnectId: "3202", price: "12.00" },
    ]);
    const offerId = await offer([[await copy(base)]]);
    const unmatched = await variantOf(base, "8030a");
    await setOfferListedVariant(userId, offerId, base, mnhId, unmatched);

    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(kit?.blockers.map((b) => b.code), ["missing-catalog-id"]);
    assert.deepEqual(kit?.blockers[0].subjects, ["Mi\u00b7PL 8030a"]);
    assert.deepEqual(kit?.blockers[0].stampIds, [unmatched]);
    // The card names it and points Search at *its* number, so it can be matched from the offer.
    const row = (await getOfferDetail(userId, offerId))!.platformItems[0];
    assert.equal(row.catalogItemVariant, "Mi\u00b7PL 8030a");
    assert.ok(row.searchUrl?.includes("PL+8030a"));
  });

  it("goes back to the derivation when the choice is cleared", async () => {
    const base = await umbrella("PL chosen cleared", [
      { number: "8040a", colnectId: "3301", price: "30.00" },
      { number: "8040b", colnectId: "3302", price: "12.00" },
    ]);
    const offerId = await offer([[await copy(base)]]);
    await setOfferListedVariant(userId, offerId, base, mnhId, await variantOf(base, "8040a"));
    await setOfferListedVariant(userId, offerId, base, mnhId, null);

    const row = (await getOfferDetail(userId, offerId))!.platformItems[0];
    assert.equal(row.catalogItemVariant, "Mi\u00b7PL 8040b", "the cheapest one again");
    assert.equal(row.catalogItemVariantChosen, false);
  });

  it("keeps the choice to the offer that made it", async () => {
    // A copy can sit in several offers' sets at once, which is exactly why the choice is keyed on the
    // offer and not on the copy.
    const base = await umbrella("PL chosen scoped", [
      { number: "8050a", colnectId: "3401", price: "30.00" },
      { number: "8050b", colnectId: "3402", price: "12.00" },
    ]);
    const shared = await copy(base);
    const mine = await offer([[shared]]);
    const other = await offer([[shared]]);
    await setOfferListedVariant(userId, mine, base, mnhId, await variantOf(base, "8050a"));

    assert.equal((await getOfferListingKit(userId, collectionId, mine))?.items[0].catalogItemId, "3401");
    assert.equal((await getOfferListingKit(userId, collectionId, other))?.items[0].catalogItemId, "3402");
  });

  it("refuses a stamp the offer does not hold, and a variant outside the tree", async () => {
    const base = await umbrella("PL chosen refusals", [
      { number: "8060a", colnectId: "3501", price: "12.00" },
    ]);
    const elsewhere = await umbrella("PL chosen elsewhere", [
      { number: "8070a", colnectId: "3601", price: "12.00" },
    ]);
    const offerId = await offer([[await copy(base)]]);

    const outside = await variantOf(elsewhere, "8070a");
    const inside = await variantOf(base, "8060a");

    await assert.rejects(
      () => setOfferListedVariant(userId, offerId, elsewhere, mnhId, outside),
      /holds no copy/
    );
    await assert.rejects(
      () => setOfferListedVariant(userId, offerId, base, mnhId, outside),
      /not a variant of the one being listed/
    );
    await assert.rejects(
      () => setOfferListedVariant(otherUserId, offerId, base, mnhId, inside),
      /not found or access denied/
    );
  });

  it("offers the whole tree, marks the automatic pick and names what automatic means", async () => {
    const base = await umbrella("PL chosen picker", [
      { number: "8080a", colnectId: "3701", price: "30.00" },
      { number: "8080b", colnectId: null, price: "12.00" },
    ]);
    const offerId = await offer([[await copy(base)]]);
    const choice = await getOfferListedVariantChoice(userId, offerId, base, mnhId);

    assert.deepEqual(choice.options.map((o) => o.label), ["Mi\u00b7PL 8080a", "Mi\u00b7PL 8080b"]);
    assert.deepEqual(choice.options.map((o) => o.matched), [true, false]);
    assert.deepEqual(choice.options.map((o) => o.price), ["30.00", "12.00"]);
    // The cheapest is `8080b`, and it is unmatched — so the derivation resolves nothing and says
    // which of #617's two gaps is in the way.
    assert.deepEqual(choice.options.map((o) => o.automatic), [false, false]);
    assert.equal(choice.automaticLabel, null);
    assert.equal(choice.automaticGap, "unmatched-variant");
    assert.equal(choice.chosenStampId, null);

    await setOfferListedVariant(userId, offerId, base, mnhId, await variantOf(base, "8080a"));
    assert.equal(
      (await getOfferListedVariantChoice(userId, offerId, base, mnhId)).chosenStampId,
      await variantOf(base, "8080a")
    );
  });

  it("is null for another owner's offer and for the wrong collection", async () => {
    const offerId = await offer([[await copy(await stamp("PL i", "1008"))]]);
    assert.equal(await getOfferListingKit(otherUserId, collectionId, offerId), null);
    assert.equal(await getOfferListingKit(userId, otherCollectionId, offerId), null);
  });
});
