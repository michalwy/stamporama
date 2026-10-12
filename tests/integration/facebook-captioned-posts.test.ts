import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState, updateOfferPhotoConfig } from "../../src/lib/offers";
import { stageUpload, applyPhotoChangeSet } from "../../src/lib/photos";
import { setFacebookPlatform } from "../../src/lib/facebook";
import { createFacebookGroup, updateFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS, type FacebookGroupValues } from "../../src/lib/facebook-group-rules";
import { getFacebookOfferKit } from "../../src/lib/facebook-auctions";
import { createFacebookPost, publishOfferOrPost, setFacebookPostLayout } from "../../src/lib/facebook-posts";
import {
  facebookPartsText,
  facebookPostSource,
  readFacebookFrozenLot,
  renderFacebookCaptionedPost,
} from "../../src/lib/facebook-post-rules";
import { claimNextOfferPhotoGeneration, enqueueOfferPhotoGeneration, runOfferPhotoGeneration } from "../../src/lib/offer-photo-generation";
import { buildFacebookPostPhotos, renderFacebookPostLotPhoto } from "../../src/lib/facebook-lot-photos";

// Bytes go through the filesystem backend, pointed at a throwaway directory (the photo tests' rule).
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-fb-captions-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// A post of several lots with each lot's text in its photo's caption (#1841): the group's setting and
// the post's override, the captions and shared text frozen at publication, and the photos — one per
// lot, a lot of front and back joined into one. The pure halves — rendering, gaps, the arrangement —
// are `tests/unit/facebook-post-rules.test.ts` and `tests/unit/facebook-lot-photo-rules.test.ts`.

function groupValues(overrides: Partial<FacebookGroupValues> = {}): FacebookGroupValues {
  return {
    ...FACEBOOK_GROUP_DEFAULTS,
    name: "Znaczki — serie",
    url: "https://www.facebook.com/groups/190000",
    postTemplate: "{lot}. {title}",
    standingNote: "Shipping 5 PLN.",
    multiLotLayout: "captions",
    auctionCaptionTemplate: "{lot}. {title} from {startingPrice}",
    captionPostTemplate: "Series, lots {offer}\n{terms}",
    custom: ["postTemplate", "standingNote", "multiLotLayout", "auctionCaptionTemplate", "captionPostTemplate"],
    ...overrides,
  };
}

/** A solid PNG scan, distinct per colour. */
async function scan(width: number, height: number, red: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: red, g: 120, b: 200 } } })
    .png()
    .toBuffer();
}

describe("a captioned Facebook post (#1841)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbcaptions-${ts}`;
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
        data: { slug: `col-fbcaptions-${ts}`, name: `fbcaptions-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.contact.create({
        data: { collectionId, name: "Facebook", platform: true, platformCurrency: "PLN", maxPhotoEdge: 2000 },
      })
    ).id;
    await setFacebookPlatform(userId, collectionId, facebookId);
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    groupId = (await createFacebookGroup(userId, collectionId, groupValues())).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  /** A copy with a front scan, and a back one when asked. */
  async function newItem(withBack: boolean): Promise<string> {
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
    for (const [role, red] of withBack ? ([["front", 20], ["back", 220]] as const) : ([["front", 20]] as const)) {
      const upload = await stageUpload(userId, collectionId, { bytes: await scan(120, 160, red), mime: "image/png" });
      await applyPhotoChangeSet(userId, item.id, {
        add: [{ uploadId: upload.id, role, title: null, sortOrder: 0 }],
        update: [],
        remove: [],
      });
    }
    return item.id;
  }

  async function offer(): Promise<string> {
    const id = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: "0.00",
        startingPrice: "3.00",
        currency: "PLN",
        listingDate: null,
        state: "preparing",
        facebookGroupId: groupId,
      },
      { seedItemIds: [await newItem(true)] }
    );
    await setOfferState(userId, id, "ready");
    return id;
  }

  /** The post as the offer's card draws it: its shared text, and each caption in lot order. */
  async function captioned(offerId: string) {
    const kit = (await getFacebookOfferKit(offerId))!;
    const source = facebookPostSource({ ...kit.group, layout: kit.layout }, kit.lots, (iso) => iso ?? "");
    const post = renderFacebookCaptionedPost(source.captions, source.standingNote, source.lots, kit.post?.postNo ?? null);
    return {
      layout: source.layout,
      post: facebookPartsText(post.post),
      captions: post.captions.map((c) => facebookPartsText(c.parts)),
    };
  }

  async function generate(offerId: string, photoSides: "front" | "both") {
    await updateOfferPhotoConfig(userId, offerId, {
      photoSides,
      preferSingles: false,
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: {
        collageGridMode: "auto",
        collageGridShape: "portrait",
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 5,
        collageBackground: "#ffffff",
        collageLabelPercent: 0,
      },
    });
    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);
  }

  it("lays a post out as its group says, and as the post says once it overrides it", async () => {
    await updateFacebookGroup(userId, groupId, groupValues());
    const a = await offer();
    const b = await offer();
    const { postId } = await createFacebookPost(userId, collectionId, [a, b]);
    const kit = (await getFacebookOfferKit(a))!;
    assert.equal(kit.layout, "captions");
    assert.equal(kit.post?.layout, null);
    const { offerNo: noA } = await prisma.offer.findUniqueOrThrow({ where: { id: a }, select: { offerNo: true } });
    const { offerNo: noB } = await prisma.offer.findUniqueOrThrow({ where: { id: b }, select: { offerNo: true } });
    assert.deepEqual(await captioned(a), {
      layout: "captions",
      post: `Series, lots ${noA}, ${noB}\nShipping 5 PLN.`,
      captions: ["1. Mercury from 3 PLN", "2. Mercury from 3 PLN"],
    });

    await setFacebookPostLayout(userId, postId, "text");
    assert.equal((await getFacebookOfferKit(a))!.layout, "text");
    await setFacebookPostLayout(userId, postId, null);
    assert.equal((await getFacebookOfferKit(a))!.layout, "captions", "null follows the group again");
    await assert.rejects(() => setFacebookPostLayout(`${userId}-other`, postId, "text"), /Collection not found/);
  });

  it("freezes the captions and the shared text at publication, and keeps the layout", async () => {
    await updateFacebookGroup(userId, groupId, groupValues());
    const a = await offer();
    const b = await offer();
    const { postId } = await createFacebookPost(userId, collectionId, [a, b]);
    await publishOfferOrPost(userId, a, "https://www.facebook.com/groups/190000/posts/1");
    const asPosted = await captioned(b);
    const frozen = readFacebookFrozenLot(
      (await prisma.offer.findUniqueOrThrow({ where: { id: b }, select: { facebookPostSnapshot: true } }))
        .facebookPostSnapshot
    );
    assert.equal(frozen?.layout, "captions");
    assert.equal(frozen?.template, "{lot}. {title} from {startingPrice}");
    assert.equal(frozen?.postText, "Series, lots {offer}\n{terms}");

    await updateFacebookGroup(
      userId,
      groupId,
      groupValues({
        multiLotLayout: "text",
        auctionCaptionTemplate: "CHANGED {title}",
        captionPostTemplate: "CHANGED",
        standingNote: "Other note",
      })
    );
    assert.deepEqual(await captioned(b), asPosted, "a published post reads as it was posted");
    await assert.rejects(() => setFacebookPostLayout(userId, postId, "text"), /stays laid out as it was posted/);
  });

  it("downloads one photo per lot — a lot of front and back joined into one", async () => {
    await updateFacebookGroup(userId, groupId, groupValues());
    const a = await offer();
    const b = await offer();
    const { postId } = await createFacebookPost(userId, collectionId, [a, b]);
    await generate(a, "both");
    await generate(b, "front");

    const joined = await renderFacebookPostLotPhoto(userId, postId, a);
    const meta = await sharp(joined.bytes).metadata();
    assert.equal(joined.mime, "image/jpeg");
    // A 3:4 front and its back, aimed at portrait: stacked would be 3:8, side by side 6:4 — the
    // former comes closer to the band, so the joined image is taller than wide.
    assert.ok(meta.height! > meta.width!, `${meta.width}×${meta.height}`);
    // The separator is drawn: a grey line across the middle of the white gap between the halves.
    const { data, info } = await sharp(joined.bytes).raw().toBuffer({ resolveWithObject: true });
    const row = Math.floor(info.height / 2);
    const pixel = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    const middle = [-2, -1, 0, 1, 2].map((d) => pixel(Math.floor(info.width / 2), row + d));
    assert.ok(middle.some((v) => v < 140), `a separator line near the middle: ${middle.join(", ")}`);

    const single = await renderFacebookPostLotPhoto(userId, postId, b);
    const singleMeta = await sharp(single.bytes).metadata();
    assert.ok(singleMeta.width! > 0, "a lot that is one photo is that photo");

    const archive = await buildFacebookPostPhotos(userId, postId);
    const names = [...archive.bytes.toString("latin1").matchAll(/lot-\d\d-[\w-]+\.jpg/g)].map((m) => m[0]);
    const unique = [...new Set(names)];
    assert.equal(unique.length, 2, unique.join(", "));
    assert.match(unique[0], /^lot-01-/);
    assert.match(unique[1], /^lot-02-/);

    const outsider = await offer();
    await assert.rejects(() => renderFacebookPostLotPhoto(userId, postId, outsider), /not a lot of this post/);

    // Laid out in its text, the post downloads every lot's own images as before.
    await setFacebookPostLayout(userId, postId, "text");
    const plain = await buildFacebookPostPhotos(userId, postId);
    const plainNames = new Set([...plain.bytes.toString("latin1").matchAll(/lot-\d\d-[\w-]+\.jpg/g)].map((m) => m[0]));
    assert.equal(plainNames.size, 3, [...plainNames].join(", "));
  });
});
