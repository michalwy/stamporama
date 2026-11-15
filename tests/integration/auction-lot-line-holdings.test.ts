import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { valuateAuctionLotLines } from "../../src/lib/auction-lines";
import { getAuctionSaleDetail } from "../../src/lib/auctions";
import { resolveAuctionLotAnchors } from "../../src/lib/auction-lot-anchors";

// An auction lot line shows the copies already held, and those bought and still on the way (#2543).
// The roll-up is unit-tested in `lot-line-holdings.test.ts`; what earns a database here is that the
// counting set is the held-copies one (a damaged copy is not counted), that the line's own condition
// is what the chip counts while the others reach the tooltip, that the lot carries the mark, and that
// the popover's *you hold* is told apart from the copies on the way.

describe("auction lot line holdings (#2543)", () => {
  let userId: string;
  let collectionId: string;
  let mnhId: string;
  let mhId: string;
  let heldStampId: string;
  let otherStampId: string;
  let saleId: string;
  let heldLotId: string;
  let otherLotId: string;
  let nextItemNo = 1;

  async function copy(stampId: string, conditionId: string, deliveryState: string) {
    await prisma.item.create({
      data: { collectionId, itemNo: nextItemNo++, stampId, conditionId, deliveryState, inCollection: deliveryState === "delivered" },
    });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-line-holdings-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User line-holdings-${ts}`,
        email: `test-line-holdings-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-line-holdings-${ts}`, name: `Line holdings ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    mhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Hinged", abbreviation: "MH", sortOrder: 1 },
      })
    ).id;
    heldStampId = (await prisma.stamp.create({ data: { collectionId, name: "Held" } })).id;
    otherStampId = (await prisma.stamp.create({ data: { collectionId, name: "Other" } })).id;

    // Two in hand at MNH (one still to sort), one bought and on its way, one MH, one damaged.
    await copy(heldStampId, mnhId, "delivered");
    await copy(heldStampId, mnhId, "to_sort");
    await copy(heldStampId, mnhId, "ordered");
    await copy(heldStampId, mhId, "delivered");
    await copy(heldStampId, mnhId, "damaged");
    // The other stamp is held only at MH, against an MNH line.
    await copy(otherStampId, mhId, "delivered");

    const sellerId = (await prisma.contact.create({ data: { collectionId, name: "Seller", seller: true } })).id;
    const platformId = (await prisma.platform.create({ data: { collectionId, name: "Allegro" } })).id;
    saleId = (
      await prisma.auctionSale.create({ data: { collectionId, sellerId, platformId, name: "Sale", currency: "EUR" } })
    ).id;
    const lot = (n: number, stampId: string) =>
      prisma.auctionLot.create({
        data: {
          auctionSaleId: saleId,
          auctionLotNo: n,
          lotNo: String(n),
          endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          status: "open",
          lines: { create: [{ stampId, conditionId: mnhId, quantity: 1 }] },
        },
      });
    heldLotId = (await lot(1, heldStampId)).id;
    otherLotId = (await lot(2, otherStampId)).id;
  });

  after(async () => {
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("counts held and on the way at the line's condition, and lists the others", async () => {
    const compositions = await valuateAuctionLotLines(collectionId, [heldLotId, otherLotId]);
    const held = compositions.get(heldLotId)!.lines[0].holdings;
    assert.ok(held);
    assert.equal(held.held, 2);
    assert.equal(held.onTheWay, 1);
    assert.deepEqual(
      held.conditions.map((c) => [c.abbreviation, c.own, c.held, c.onTheWay]),
      [
        ["MNH", true, 2, 1],
        ["MH", false, 1, 0],
      ]
    );

    const other = compositions.get(otherLotId)!.lines[0].holdings;
    assert.ok(other);
    assert.equal(other.held + other.onTheWay, 0);
    assert.deepEqual(other.conditions.map((c) => c.abbreviation), ["MH"]);
  });

  it("marks the lot whose line has copies at its own condition, and only that one", async () => {
    const detail = await getAuctionSaleDetail(userId, saleId);
    assert.equal(detail.lots.find((l) => l.id === heldLotId)!.holdsCopies, true);
    assert.equal(detail.lots.find((l) => l.id === otherLotId)!.holdsCopies, false);
  });

  it("tells the popover's copies on the way apart from those held", async () => {
    const anchors = await resolveAuctionLotAnchors(collectionId, [heldLotId]);
    const line = anchors.get(heldLotId)!.lines[0];
    assert.equal(line.owned, 3);
    assert.equal(line.ownedOnTheWay, 1);
  });
});
