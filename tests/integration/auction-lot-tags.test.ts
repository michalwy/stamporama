import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  applyAuctionLotTagChanges,
  deleteTag,
  getTags,
  getTagUsage,
  setAuctionLotTagEntries,
  setAuctionLotTags,
} from "../../src/lib/tags";
import {
  auctionLotFilterCounts,
  getAuctionSaleDetail,
  listAuctionLots,
} from "../../src/lib/auctions";
import { NO_TAGS } from "../../src/lib/tag-filter";

// Tags on auction lots (#1625): the fourth thing a tag hangs on.
//
// What is pinned is what the types cannot say: a lot's dialog **replaces** its set while a bulk pass
// over ticked lots **adds and removes** and leaves every unnamed tag alone (an accidental replace
// compiles and strips a selection); the tags ride on the lot rows both auction screens draw; the
// lots list narrows by them under *any* and *all*, its facet counts with it; a lot the collection
// does not own is never reached; and Settings counts lots in what a tag is on.

const ts = Date.now();

describe("tags on auction lots (#1625)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let saleId: string;
  let otherLotId: string;
  const lot: Record<"A" | "B" | "C", string> = { A: "", B: "", C: "" };
  const tag: Record<"danzig" | "agent" | "gum", string> = { danzig: "", agent: "", gum: "" };

  async function tagsOn(lotId: string): Promise<string[]> {
    const rows = await prisma.auctionLotTag.findMany({
      where: { auctionLotId: lotId },
      select: { tag: { select: { name: true } } },
    });
    return rows.map((r) => r.tag.name).sort();
  }

  async function listedIds(filters: Parameters<typeof listAuctionLots>[2]): Promise<string[]> {
    return (await listAuctionLots(userId, collectionId, filters)).items.map((l) => l.id).sort();
  }

  before(async () => {
    userId = `test-user-lottags-${ts}`;
    otherUserId = `test-user-lottags-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-lottags-${ts}`, name: "Lot tags", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-lottags-other-${ts}`,
          name: "Someone else's",
          baseCurrency: "EUR",
          ownerId: otherUserId,
        },
      })
    ).id;

    const sale = async (cid: string) => {
      const platformId = (
        await prisma.contact.create({ data: { collectionId: cid, name: "Allegro", platform: true } })
      ).id;
      const sellerId = (
        await prisma.contact.create({ data: { collectionId: cid, name: "Philkam", seller: true } })
      ).id;
      return (
        await prisma.auctionSale.create({
          data: { collectionId: cid, sellerId, platformId, name: "Philkam · Allegro", currency: "EUR" },
        })
      ).id;
    };
    saleId = await sale(collectionId);
    const otherSaleId = await sale(otherCollectionId);

    const endsAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    let seq = 0;
    const create = async (auctionSaleId: string, title: string) =>
      (
        await prisma.auctionLot.create({
          data: { auctionSaleId, auctionLotNo: 9700 + ++seq, status: "open", title, endsAt },
        })
      ).id;
    lot.A = await create(saleId, "Lot A");
    lot.B = await create(saleId, "Lot B");
    lot.C = await create(saleId, "Lot C");
    otherLotId = await create(otherSaleId, "Not yours");

    for (const [key, name] of [
      ["danzig", "for the Danzig album"],
      ["agent", "agent-found"],
      ["gum", "ask about the gum"],
    ] as const) {
      tag[key] = (await prisma.tag.create({ data: { collectionId, name } })).id;
    }
  });

  after(async () => {
    await prisma.auctionSale.deleteMany({
      where: { collectionId: { in: [collectionId, otherCollectionId] } },
    });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("puts tags on one lot from its dialog, creating a typed name, and replaces the set on the next write", async () => {
    await setAuctionLotTagEntries(userId, lot.A, [
      { id: tag.agent, name: "agent-found", color: null },
      { id: null, name: "rare", color: "teal" },
    ]);
    assert.deepEqual(await tagsOn(lot.A), ["agent-found", "rare"]);
    // The typed name became a tag in the dictionary, born with the lot that carries it.
    assert.ok((await getTags(userId, collectionId)).some((t) => t.name === "rare"));

    await setAuctionLotTags(userId, lot.A, [tag.danzig]);
    assert.deepEqual(await tagsOn(lot.A), ["for the Danzig album"], "the set was appended to");
  });

  it("carries a lot's tags on the rows of the lots list and of its sale's screen", async () => {
    await setAuctionLotTags(userId, lot.A, [tag.gum, tag.danzig]);
    const listed = (await listAuctionLots(userId, collectionId)).items.find((l) => l.id === lot.A);
    assert.deepEqual(
      listed?.tags.map((t) => t.name),
      ["ask about the gum", "for the Danzig album"],
      "not in the dictionary's order"
    );
    const detail = await getAuctionSaleDetail(userId, saleId);
    assert.deepEqual(
      detail.lots.find((l) => l.id === lot.A)?.tags.map((t) => t.name),
      ["ask about the gum", "for the Danzig album"]
    );
    assert.deepEqual(detail.lots.find((l) => l.id === lot.B)?.tags, []);
  });

  it("adds a tag across ticked lots without disturbing what each already carries", async () => {
    await setAuctionLotTags(userId, lot.A, [tag.danzig]);
    await setAuctionLotTags(userId, lot.B, [tag.gum]);
    await setAuctionLotTags(userId, lot.C, []);
    const reached = await applyAuctionLotTagChanges(userId, collectionId, [lot.A, lot.B], {
      addTagIds: [tag.agent],
    });
    assert.equal(reached, 2);
    assert.deepEqual(await tagsOn(lot.A), ["agent-found", "for the Danzig album"]);
    assert.deepEqual(await tagsOn(lot.B), ["agent-found", "ask about the gum"]);
    assert.deepEqual(await tagsOn(lot.C), [], "a lot nobody ticked was reached");
  });

  it("removes a named tag and adds another in one pass, leaving every unnamed one where it is", async () => {
    await setAuctionLotTags(userId, lot.A, [tag.danzig, tag.agent]);
    await setAuctionLotTags(userId, lot.B, [tag.gum]);
    await applyAuctionLotTagChanges(userId, collectionId, [lot.A, lot.B], {
      addTagIds: [tag.gum],
      removeTagIds: [tag.agent],
    });
    assert.deepEqual(await tagsOn(lot.A), ["ask about the gum", "for the Danzig album"]);
    // Already carrying the added tag is not a second row, and not carrying the removed one is fine.
    assert.deepEqual(await tagsOn(lot.B), ["ask about the gum"]);
  });

  it("never reaches a lot or a tag that is not this collection's", async () => {
    const foreignTag = (await prisma.tag.create({ data: { collectionId: otherCollectionId, name: "theirs" } })).id;
    const reached = await applyAuctionLotTagChanges(userId, collectionId, [lot.C, otherLotId], {
      addTagIds: [tag.danzig, foreignTag],
    });
    assert.equal(reached, 1, "a lot from another collection was counted");
    assert.deepEqual(await tagsOn(lot.C), ["for the Danzig album"]);
    assert.deepEqual(await tagsOn(otherLotId), []);
    await assert.rejects(() => setAuctionLotTags(userId, otherLotId, [tag.danzig]));
    await assert.rejects(() =>
      applyAuctionLotTagChanges(otherUserId, collectionId, [lot.A], { addTagIds: [tag.danzig] })
    );
  });

  it("writes nothing when the pass names no tag at all", async () => {
    await setAuctionLotTags(userId, lot.A, [tag.danzig]);
    assert.equal(await applyAuctionLotTagChanges(userId, collectionId, [lot.A], {}), 0);
    assert.deepEqual(await tagsOn(lot.A), ["for the Danzig album"]);
  });

  it("narrows the lots list by tag, any or all, and the facet counts with it", async () => {
    await setAuctionLotTags(userId, lot.A, [tag.danzig, tag.agent]);
    await setAuctionLotTags(userId, lot.B, [tag.agent]);
    await setAuctionLotTags(userId, lot.C, []);

    assert.deepEqual(await listedIds({ tagIds: [tag.danzig, tag.agent] }), [lot.A, lot.B].sort());
    assert.deepEqual(await listedIds({ tagIds: [tag.danzig, tag.agent], tagMode: "all" }), [lot.A]);
    assert.deepEqual(await listedIds({ tagIds: [NO_TAGS] }), [lot.C]);
    assert.deepEqual(await listedIds({ tagIds: [tag.gum] }), []);

    const counts = await auctionLotFilterCounts(userId, collectionId, {
      tagIds: [tag.danzig, tag.agent],
      tagMode: "all",
    });
    assert.equal(counts.total, 1);
    // The baseline the band reports against is the list with nothing narrowing it.
    assert.equal(counts.unfiltered, 3);
    assert.equal(counts.allSellers, 1, "the seller facet ignored the tag filter");

    // A sale's own lots are narrowed by the same filter when asked through the same read.
    assert.deepEqual(await listedIds({ saleId, tagIds: [tag.agent] }), [lot.A, lot.B].sort());
  });

  it("counts lots in what a tag is on, and deleting the tag takes it off them", async () => {
    await setAuctionLotTags(userId, lot.A, [tag.gum]);
    await setAuctionLotTags(userId, lot.B, [tag.gum]);
    const usage = await getTagUsage(userId, tag.gum);
    assert.equal(usage.lotCount, 2);
    assert.equal(
      (await getTags(userId, collectionId)).find((t) => t.id === tag.gum)?.lotCount,
      2
    );
    await deleteTag(userId, tag.gum);
    assert.deepEqual(await tagsOn(lot.A), []);
    assert.equal(await prisma.auctionLot.count({ where: { id: lot.A } }), 1, "the lot went with it");
  });

  it("goes with the lot when the lot is deleted", async () => {
    const doomed = (
      await prisma.auctionLot.create({
        data: {
          auctionSaleId: saleId,
          auctionLotNo: 9799,
          status: "open",
          endsAt: new Date(Date.now() + 3600_000),
        },
      })
    ).id;
    await setAuctionLotTags(userId, doomed, [tag.danzig]);
    await prisma.auctionLot.delete({ where: { id: doomed } });
    assert.equal(await prisma.auctionLotTag.count({ where: { auctionLotId: doomed } }), 0);
    assert.equal(await prisma.tag.count({ where: { id: tag.danzig } }), 1, "the tag went with the lot");
  });
});
