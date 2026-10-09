import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createContact } from "../../src/lib/contacts";
import { createOffer, addOfferSet, getOfferDetail, updateOfferPhotoConfig } from "../../src/lib/offers";
import { stageUpload, applyPhotoChangeSet } from "../../src/lib/photos";
import {
  claimNextOfferPhotoGeneration,
  enqueueOfferPhotoGeneration,
  getOfferPhotoPlanState,
  runOfferPhotoGeneration,
} from "../../src/lib/offer-photo-generation";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-offer-photo-groups-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Offer photos grouping a set's copies by checklist (#1673). The grouping rules are unit-tested
// (`offer-photo-checklist-groups.test.ts`); what is exercised here is the wiring that needs a
// database: the platform seeding the switch and the group template, the checklist slots read through
// the copies' stamps (standard checklists only), each image rendered on its own template, and the
// stored images going out of date when a checklist changes.

async function scan(red: number): Promise<Buffer> {
  return sharp({ create: { width: 100, height: 100, channels: 3, background: { r: red, g: 90, b: 160 } } })
    .png()
    .toBuffer();
}

describe("offer photos grouped by checklist (#1673)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let offerId: string;
  const stampIds = new Map<string, string>();
  const itemIds = new Map<string, string>();

  /** The copies' names for a list of copy ids. */
  const named = (ids: readonly string[]) => {
    const byId = new Map([...itemIds].map(([name, id]) => [id, name]));
    return ids.map((id) => byId.get(id) ?? id).join(",");
  };

  async function checklist(name: string, kind: string, members: string[]) {
    return prisma.checklist.create({
      data: {
        collectionId,
        name,
        kind,
        stamps: {
          create: members.map((member, sortOrder) => ({ stampId: stampIds.get(member)!, sortOrder })),
        },
      },
    });
  }

  async function generate() {
    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);
    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.status, "ready", state.error ?? "not ready");
    return state;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-photo-groups-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User photo-groups-${ts}`,
        email: `test-photo-groups-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-photo-groups-${ts}`,
          name: `Collection photo-groups-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;

    // Two templates that cannot be confused in the finished image: singles stacked one above the
    // other (tall), a series in one row of four (wide).
    const template = (name: string, rows: number, columns: number) =>
      prisma.collageTemplate.create({
        data: { collectionId, name, rows, columns, gapPercent: 5, background: "#000000", labelPercent: 0 },
      });
    const singles = await template("Singles 2×1", 2, 1);
    const series = await template("Series 1×4", 1, 4);
    const foreign = await prisma.collection.create({
      data: { slug: `col-photo-groups-other-${ts}`, name: "Other", baseCurrency: "EUR", ownerId: userId },
    });
    const foreignTemplate = await prisma.collageTemplate.create({
      data: { collectionId: foreign.id, name: "Elsewhere", rows: 3, columns: 3, gapPercent: 5 },
    });

    // Through the contact domain, so the platform form's write path is what is exercised: a group
    // template from another collection is dropped, one from this collection is kept.
    const dropped = await createContact(userId, collectionId, {
      name: `Elsewhere ${ts}`,
      platform: true,
      photoGroupByChecklist: true,
      defaultGroupCollageTemplateId: foreignTemplate.id,
    });
    assert.equal(dropped.defaultGroupCollageTemplateId, null);
    const platform = await createContact(userId, collectionId, {
      name: `Facebook ${ts}`,
      platform: true,
      maxPhotoEdge: 800,
      defaultCollageTemplateId: singles.id,
      photoGroupByChecklist: true,
      defaultGroupCollageTemplateId: series.id,
    });
    assert.equal(platform.photoGroupByChecklist, true);
    assert.equal(platform.defaultGroupCollageTemplateId, series.id);
    platformId = platform.id;

    // The lot, in catalogue order. `x` is on both A and B; `c1` is the only offered stamp of C; D is
    // specialised, so its two stamps are singles.
    const lot = ["s1", "a1", "b1", "x", "a2", "b2", "c1", "d1", "d2", "a3"];
    for (const [index, name] of [...lot, "c2"].entries()) {
      const stamp = await prisma.stamp.create({
        data: { collectionId, name, primaryCatalogSortKey: catalogSortKeyOf(String(index + 1)) },
      });
      stampIds.set(name, stamp.id);
    }
    await checklist("A", "standard", ["a1", "a2", "a3", "x"]);
    await checklist("B", "standard", ["b1", "b2", "x"]);
    await checklist("C", "standard", ["c1", "c2"]);
    await checklist("D", "specialised", ["d1", "d2"]);

    for (const [index, name] of lot.entries()) {
      const item = await createItem(userId, collectionId, {
        stampId: stampIds.get(name)!,
        conditionId,
        forSale: true,
      });
      const upload = await stageUpload(userId, collectionId, {
        bytes: await scan(10 + index * 20),
        mime: "image/png",
      });
      await applyPhotoChangeSet(userId, item.id, {
        add: [{ uploadId: upload.id, role: "front", title: null, sortOrder: 0 }],
        update: [],
        remove: [],
      });
      itemIds.set(name, item.id);
    }

    offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "10.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, lot.map((name) => itemIds.get(name)!));
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("seeds the switch and the group template's numbers from the platform", async () => {
    const detail = (await getOfferDetail(userId, offerId))!;
    assert.equal(detail.photoConfig.groupByChecklist, true);
    assert.equal(detail.photoConfig.collage?.collageColumns, 1);
    assert.deepEqual(detail.photoConfig.groupCollage, {
      collageGridMode: "fixed",
      collageGridShape: "landscape",
      collageRows: 1,
      collageColumns: 4,
      collageGapPercent: 5,
      collageBackground: "#000000",
      collageLabelPercent: 0,
    });
  });

  it("renders each checklist group on images of its own and template, then the singles", async () => {
    const state = await generate();
    assert.deepEqual(
      state.images.map((image) => named(image.itemIds)),
      // A takes `x` (four of the set's copies against B's three) and lists it in A's order; B keeps
      // two. C has one offered copy and D is specialised, so those copies are singles.
      ["a1,a2,a3,x", "b1,b2", "s1,c1", "d1,d2"]
    );
    const [groupA, groupB, firstSingles, secondSingles] = state.images;
    assert.ok(groupA.width > groupA.height, "a group is laid out on the 1×4 series template");
    assert.ok(groupB.width > groupB.height, "a short group is one row of the series template");
    assert.ok(firstSingles.height > firstSingles.width, "singles are stacked on the 2×1 template");
    assert.ok(secondSingles.height > secondSingles.width);
    assert.equal(state.outOfDate, false);
  });

  it("puts the stored photos out of date when a checklist changes, and regroups on regenerating", async () => {
    // `c1` joining B makes it a third copy of B.
    const b = await prisma.checklist.findFirstOrThrow({ where: { collectionId, name: "B" } });
    await prisma.checklistStamp.create({
      data: { checklistId: b.id, stampId: stampIds.get("c1")!, sortOrder: 5 },
    });
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).outOfDate, true);

    const state = await generate();
    assert.deepEqual(
      state.images.map((image) => named(image.itemIds)),
      ["a1,a2,a3,x", "b1,b2,c1", "s1,d1", "d2"]
    );
  });

  it("generates photos as today with grouping off", async () => {
    const detail = (await getOfferDetail(userId, offerId))!;
    await updateOfferPhotoConfig(userId, offerId, { ...detail.photoConfig, groupByChecklist: false });
    const state = await generate();
    assert.deepEqual(
      state.images.map((image) => named(image.itemIds)),
      ["s1,a1", "b1,x", "a2,b2", "c1,d1", "d2,a3"]
    );
    assert.ok(state.images.every((image) => image.height > image.width), "all on the singles template");
  });

  it("lays groups out on the singles template when the offer has no group template", async () => {
    const detail = (await getOfferDetail(userId, offerId))!;
    await updateOfferPhotoConfig(userId, offerId, {
      ...detail.photoConfig,
      groupByChecklist: true,
      groupCollage: null,
    });
    const state = await generate();
    assert.deepEqual(
      state.images.map((image) => named(image.itemIds)),
      // Two per image now, a group continuing on the next image of its own.
      ["a1,a2", "a3,x", "b1,b2", "c1", "s1,d1", "d2"]
    );
  });
});
