import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
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
import {
  claimNextOfferPhotoGeneration,
  enqueueOfferPhotoGeneration,
  purgeClosedOfferPhotos,
  runOfferPhotoGeneration,
} from "../../src/lib/offer-photo-generation";
import {
  buildFacebookPostPhotos,
  claimNextFacebookLotPhoto,
  FacebookLotPhotosNotReadyError,
  readFacebookPostLotPhotos,
  runFacebookLotPhoto,
  type FacebookPostLotPhoto,
} from "../../src/lib/facebook-lot-photos";
import { removeFacebookLot } from "../../src/lib/facebook-posts";
import { getStorage, variantKey } from "../../src/lib/storage";

// Bytes go through the filesystem backend, pointed at a throwaway directory (the photo tests' rule).
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-fb-captions-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// A post of several lots with each lot's text in its photo's caption (#1841): the group's setting and
// the post's override, the captions and shared text frozen at publication, and the photos — one per
// lot, a lot of front and back joined into one, drawn once in the background and stored (#1861). The pure halves — rendering, gaps, the arrangement —
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

/** A ZIP read back by walking its local file headers, in written order (as `offer-photo-generation`'s). */
function readZipEntries(archive: Buffer): { name: string; contents: Buffer }[] {
  const entries: { name: string; contents: Buffer }[] = [];
  let offset = 0;
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const payload = archive.subarray(start, start + compressedSize);
    entries.push({ name, contents: method === 0 ? Buffer.from(payload) : inflateRawSync(payload) });
    offset = start + compressedSize;
  }
  return entries;
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

  /** Draw every queued lot photo of these offers, as the worker would. */
  async function drawLotPhotos(...offerIds: string[]) {
    for (const offerId of offerIds) {
      assert.equal(await claimNextFacebookLotPhoto({ offerId }), offerId, `lot photo of ${offerId} queued`);
      await runFacebookLotPhoto(offerId);
    }
  }

  const byOffer = (lots: FacebookPostLotPhoto[], offerId: string) => lots.find((l) => l.offerId === offerId)!;

  /** The stored bytes of a ready lot photo. */
  async function storedBytes(photoId: string): Promise<Buffer> {
    const photo = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    const object = await getStorage(photo.storageBackend).get(
      variantKey(photo.storageKey, "full", photo.mime),
      photo.mime,
      "delivery"
    );
    const chunks: Buffer[] = [];
    for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async function bytesExist(storageKey: string, mime: string): Promise<boolean> {
    return getStorage("filesystem")
      .get(variantKey(storageKey, "full", mime), mime, "delivery")
      .then(() => true, () => false);
  }

  it("draws one photo per lot in the background and serves the stored one — front and back joined", async () => {
    await updateFacebookGroup(userId, groupId, groupValues());
    const a = await offer();
    const b = await offer();
    const { postId } = await createFacebookPost(userId, collectionId, [a, b]);
    await generate(a, "both");
    await generate(b, "front");

    // Reading the post queues what is missing; nothing is drawn while it waits, and the ZIP waits too.
    const queued = await readFacebookPostLotPhotos(userId, postId);
    assert.deepEqual(queued.map((l) => [l.lotNo, l.state.status]), [[1, "generating"], [2, "generating"]]);
    await assert.rejects(() => buildFacebookPostPhotos(userId, postId), FacebookLotPhotosNotReadyError);
    assert.equal(await prisma.photo.count({ where: { offerId: a, facebookLotPhoto: { isNot: null } } }), 0);

    await drawLotPhotos(a, b);
    const ready = await readFacebookPostLotPhotos(userId, postId);
    const lotA = byOffer(ready, a);
    assert.equal(lotA.state.status, "ready");
    assert.match(lotA.fileName, /^lot-01-\d+\.jpg$/);
    if (lotA.state.status !== "ready") return;

    const joined = await storedBytes(lotA.state.photoId);
    const meta = await sharp(joined).metadata();
    // A 3:4 front and its back, aimed at portrait: stacked would be 3:8, side by side 6:4 — the
    // former comes closer to the band, so the joined image is taller than wide.
    assert.ok(meta.height! > meta.width!, `${meta.width}×${meta.height}`);
    // The separator is drawn: a grey line across the middle of the white gap between the halves.
    const { data, info } = await sharp(joined).raw().toBuffer({ resolveWithObject: true });
    const row = Math.floor(info.height / 2);
    const pixel = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    const middle = [-2, -1, 0, 1, 2].map((d) => pixel(Math.floor(info.width / 2), row + d));
    assert.ok(middle.some((v) => v < 140), `a separator line near the middle: ${middle.join(", ")}`);

    // A stored generated photo of the offer — counted and swept with its images — outside its plan.
    const stored = await prisma.photo.findUniqueOrThrow({ where: { id: lotA.state.photoId } });
    assert.equal(stored.offerId, a);
    assert.equal(stored.kind, "generated");
    assert.equal(await prisma.offerPhotoEntry.count({ where: { photoId: stored.id } }), 0);

    // Reading again draws nothing: the same photo, and no run queued.
    const again = await readFacebookPostLotPhotos(userId, postId);
    assert.deepEqual(byOffer(again, a).state, lotA.state);
    assert.equal(await claimNextFacebookLotPhoto({ offerId: a }), null);

    const archive = readZipEntries((await buildFacebookPostPhotos(userId, postId)).bytes);
    assert.deepEqual(
      archive.map((e) => e.name),
      ready.map((l) => l.fileName)
    );
    assert.match(archive[1].name, /^lot-02-/);
    assert.ok(archive[0].contents.equals(joined), "the ZIP carries the stored photo itself");

    // Laid out in its text, the post downloads every lot's own images as before, and its stored lot
    // photos go — rows and bytes.
    await setFacebookPostLayout(userId, postId, "text");
    assert.equal(await prisma.facebookLotPhoto.count({ where: { offerId: { in: [a, b] } } }), 0);
    assert.equal(await prisma.photo.count({ where: { id: stored.id } }), 0);
    assert.equal(await bytesExist(stored.storageKey, stored.mime), false);
    assert.deepEqual(await readFacebookPostLotPhotos(userId, postId), []);
    const plain = await buildFacebookPostPhotos(userId, postId);
    const plainNames = new Set([...plain.bytes.toString("latin1").matchAll(/lot-\d\d-[\w-]+\.jpg/g)].map((m) => m[0]));
    assert.equal(plainNames.size, 3, [...plainNames].join(", "));
  });

  it("rebuilds a lot photo when the offer's images change, and never serves the stale one", async () => {
    await updateFacebookGroup(userId, groupId, groupValues());
    const a = await offer();
    const b = await offer();
    const { postId } = await createFacebookPost(userId, collectionId, [a, b]);
    await generate(a, "both");
    await generate(b, "front");
    await readFacebookPostLotPhotos(userId, postId);
    await drawLotPhotos(a, b);
    const before = byOffer(await readFacebookPostLotPhotos(userId, postId), a).state;
    assert.equal(before.status, "ready");
    if (before.status !== "ready") return;

    // The offer's own run replaces its images but not the lot photo, which is drawn from them.
    await generate(a, "front");
    assert.equal(await prisma.photo.count({ where: { id: before.photoId } }), 1, "the offer's run leaves it alone");
    const stale = await readFacebookPostLotPhotos(userId, postId);
    assert.equal(byOffer(stale, a).state.status, "generating", "stale is shown as being generated");
    assert.equal(byOffer(stale, b).state.status, "ready", "the other lot is untouched");

    await drawLotPhotos(a);
    const after = byOffer(await readFacebookPostLotPhotos(userId, postId), a).state;
    assert.equal(after.status, "ready");
    if (after.status !== "ready") return;
    assert.notEqual(after.photoId, before.photoId);
    assert.equal(await prisma.photo.count({ where: { id: before.photoId } }), 0, "the old photo is gone");
    // Fronts only now: one image, used as it is.
    const meta = await sharp(await storedBytes(after.photoId)).metadata();
    assert.ok(meta.width! < meta.height!, "the single 3:4 front");

    // The collage shape is part of what it is drawn from.
    await prisma.offer.update({ where: { id: b }, data: { collageBackground: "#000000" } });
    assert.equal(byOffer(await readFacebookPostLotPhotos(userId, postId), b).state.status, "generating");
  });

  it("keeps the photo a published post went up with, and drops a lot's when it leaves its post", async () => {
    await updateFacebookGroup(userId, groupId, groupValues());
    const a = await offer();
    const b = await offer();
    const c = await offer();
    const { postId } = await createFacebookPost(userId, collectionId, [a, b, c]);
    await generate(a, "both");
    await generate(b, "front");
    await generate(c, "front");
    await readFacebookPostLotPhotos(userId, postId);
    await drawLotPhotos(a, b, c);

    // Taken out before the post is up: its photo goes, rows and bytes.
    const lotC = byOffer(await readFacebookPostLotPhotos(userId, postId), c).state;
    assert.equal(lotC.status, "ready");
    if (lotC.status !== "ready") return;
    const photoC = await prisma.photo.findUniqueOrThrow({ where: { id: lotC.photoId } });
    await removeFacebookLot(userId, c);
    assert.equal(await prisma.facebookLotPhoto.count({ where: { offerId: c } }), 0);
    assert.equal(await prisma.photo.count({ where: { id: photoC.id } }), 0);
    assert.equal(await bytesExist(photoC.storageKey, photoC.mime), false);

    const posted = byOffer(await readFacebookPostLotPhotos(userId, postId), a).state;
    await publishOfferOrPost(userId, a, "https://www.facebook.com/groups/190000/posts/2");
    await generate(a, "front");
    const kept = await readFacebookPostLotPhotos(userId, postId);
    assert.deepEqual(byOffer(kept, a).state, posted, "published, it keeps the photo it went up with");
    assert.equal(await claimNextFacebookLotPhoto({ offerId: a }), null, "and nothing is queued");

    // Closed long enough, the offer's generated images go — the lot photo with them.
    if (posted.status !== "ready") return;
    await prisma.offer.update({ where: { id: a }, data: { state: "withdrawn", closedAt: new Date(0) } });
    await purgeClosedOfferPhotos(new Date(), { offerId: a });
    assert.equal(await prisma.photo.count({ where: { id: posted.photoId } }), 0);
  });
});
