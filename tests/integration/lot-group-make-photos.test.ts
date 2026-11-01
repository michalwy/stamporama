import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, updateOfferPhotoConfig } from "../../src/lib/offers";
import { applyPhotoChangeSet, stageUpload } from "../../src/lib/photos";
import {
  claimNextOfferPhotoGeneration,
  getOfferPhotoPlanState,
  runOfferPhotoGeneration,
} from "../../src/lib/offer-photo-generation";
import { makeLotGroupPhotos } from "../../src/lib/offer-lot-groups";
import type { LotGroup } from "../../src/lib/offer-lot-group-rules";
import type { OfferState } from "../../src/lib/offer-rules";
import { addProposalLots, createProposal, getDirectPlatform, moveProposal } from "../../src/lib/proposals";

// A throwaway directory for the filesystem backend, as the other photo-generation tests use.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-lot-group-photos-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// *Make photos* on a proposal's and a post's screen (#2323), through the tools they share (#2313):
//
//   - the lots with no photos are queued from their own settings, whatever their state — an Active lot
//     past what *Mark ready* reaches — and a lot with photos is left alone;
//   - a lot whose photos cannot be made is answered with its reason, and the rest go ahead;
//   - *Regenerate every lot* queues every lot, photos or not;
//   - only while the group may change, as every other tool.

const COLLAGE = {
  collageGridMode: "fixed" as const,
  collageGridShape: "landscape" as const,
  collageRows: 2,
  collageColumns: 2,
  collageGapPercent: 8,
  collageBackground: "#ffffff",
  collageLabelPercent: 16,
};

describe("Make photos over a group's lots (#2323)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let directId: string;
  let buyerId: string;
  let seq = 0;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-lot-group-photos-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-lot-group-photos-${ts}`, name: "Lot group photos", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    directId = (await getDirectPlatform(collectionId)).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Anna Nowak", buyer: true } })).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  /** A Direct offer of one copy, in `state`, with collage numbers — and a scan unless `scanned` is false. */
  async function lot(state: OfferState, scanned = true): Promise<string> {
    seq += 1;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: `Stamp ${seq}` } })).id;
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" });
    if (scanned) {
      const bytes = await sharp({
        create: { width: 120, height: 160, channels: 3, background: { r: 20 + seq, g: 90, b: 160 } },
      })
        .png()
        .toBuffer();
      const upload = await stageUpload(userId, collectionId, { bytes, mime: "image/png" });
      await applyPhotoChangeSet(userId, item.id, {
        add: [{ uploadId: upload.id, role: "front", title: null, sortOrder: 0 }],
        update: [],
        remove: [],
      });
    }
    const offerId = await createOffer(
      userId,
      collectionId,
      { platformId: directId, url: null, price: "5.00", startingPrice: null, currency: "EUR", listingDate: null },
      { seedItemIds: [item.id] }
    );
    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "front",
      preferSingles: false,
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: COLLAGE,
    });
    if (state !== "preparing") await prisma.offer.update({ where: { id: offerId }, data: { state } });
    return offerId;
  }

  async function proposal(lots: string[]): Promise<{ group: LotGroup; proposalId: string }> {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    await addProposalLots(userId, proposalId, lots);
    return { group: { kind: "proposal", id: proposalId }, proposalId };
  }

  /** Drain this offer's queued run, as the worker would. */
  async function render(offerId: string): Promise<void> {
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);
  }

  const status = async (offerId: string) => (await getOfferPhotoPlanState(userId, offerId)).status;

  it("queues the lots with no photos, whatever their state, and leaves a lot with photos alone", async () => {
    const [made, active, ready] = [await lot("preparing"), await lot("active"), await lot("ready")];
    const { group } = await proposal([made, active, ready]);
    assert.deepEqual((await makeLotGroupPhotos(userId, group, "missing")).queued, [made, active, ready]);
    for (const id of [made, active, ready]) await render(id);
    assert.equal(await status(active), "ready", "an Active lot gets its photos with no setting changed");

    const fresh = await lot("active");
    await addProposalLots(userId, group.id, [fresh]);
    const second = await makeLotGroupPhotos(userId, group, "missing");
    assert.deepEqual(second, { queued: [fresh], skipped: [] }, "only the lot that has none");
    assert.deepEqual(
      await makeLotGroupPhotos(userId, group, "missing"),
      { queued: [], skipped: [] },
      "a lot whose photos are being made is not queued twice"
    );
    await render(fresh);
  });

  it("names a lot whose photos cannot be made, and the rest go ahead", async () => {
    const [scanless, scanned] = [await lot("active", false), await lot("active")];
    const { group } = await proposal([scanless, scanned]);
    const result = await makeLotGroupPhotos(userId, group, "missing");
    assert.deepEqual(result.queued, [scanned]);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].offerId, scanless);
    assert.match(result.skipped[0].message, /no scans/);
    await render(scanned);
  });

  it("regenerates every lot, photos or not, and leaves a withdrawn lot alone", async () => {
    const [first, second, withdrawn] = [await lot("ready"), await lot("active"), await lot("active")];
    const { group } = await proposal([first, second, withdrawn]);
    await prisma.offer.update({ where: { id: withdrawn }, data: { state: "withdrawn" } });
    assert.deepEqual((await makeLotGroupPhotos(userId, group, "missing")).queued, [first, second]);
    await render(first);
    await render(second);

    assert.deepEqual((await makeLotGroupPhotos(userId, group, "missing")).queued, [], "every open lot has photos");
    assert.deepEqual((await makeLotGroupPhotos(userId, group, "all")).queued, [first, second]);
    assert.equal(await status(first), "queued");
    await render(first);
    await render(second);
  });

  it("is refused once the proposal is sent, and for a stranger's proposal", async () => {
    const { group, proposalId } = await proposal([await lot("ready")]);
    await assert.rejects(makeLotGroupPhotos("someone-else", group, "missing"), /Proposal not found/);
    await moveProposal(userId, proposalId, "send");
    await assert.rejects(makeLotGroupPhotos(userId, group, "missing"), /has been sent/);
    await assert.rejects(makeLotGroupPhotos(userId, group, "all"), /has been sent/);
  });
});
