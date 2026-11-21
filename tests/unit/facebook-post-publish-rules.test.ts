import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FacebookPostPhotos } from "../../src/lib/facebook-lot-photos";
import {
  facebookPostPhotoFiles,
  facebookPostPhotosHeld,
  facebookPostPublishedMessage,
  facebookPostPublishVia,
  type PublishLot,
} from "../../src/lib/facebook-post-publish-rules";

// Publishing a Facebook post, shared by the desk's post screen and the post's phone screen (#2629): the
// photos it puts up in lot order, when they cannot be taken yet, the lot the publish is asked through,
// and what is said afterwards. The phone's publish itself is `tests/integration/phone-posts.test.ts`.

function lot(offerId: string, lotNo: number | null, state = "ready", frozen: unknown = null): PublishLot {
  return { offerId, lotNo, state, frozen };
}

const text = (lots: { offerId: string; status?: string; images: string[] }[]): FacebookPostPhotos => ({
  layout: "text",
  lots: lots.map((l) => ({
    offerId: l.offerId,
    status: (l.status ?? "ready") as never,
    images: l.images.map((name, i) => ({ photoId: `${l.offerId}-p${i + 1}`, fileName: name })),
  })),
});

describe("facebookPostPhotoFiles", () => {
  it("lists a post laid out as text by lot, each lot's upload set named as in the ZIP", () => {
    const files = facebookPostPhotoFiles(
      [lot("a", 1), lot("b", 2)],
      text([
        { offerId: "b", images: ["b-01.jpg"] },
        { offerId: "a", images: ["a-01.jpg", "a-02.jpg"] },
      ])
    );
    assert.deepEqual(
      files.map((f) => [f.photoId, f.fileName, f.lotNo, f.index, f.of]),
      [
        ["a-p1", "lot-01-a-01.jpg", 1, 1, 2],
        ["a-p2", "lot-01-a-02.jpg", 1, 2, 2],
        ["b-p1", "lot-02-b-01.jpg", 2, 1, 1],
      ]
    );
  });

  it("leaves out a lot sold before the post went up, the others keeping their numbers", () => {
    const files = facebookPostPhotoFiles(
      [lot("a", 1, "sold"), lot("b", 2)],
      text([
        { offerId: "a", images: ["a-01.jpg"] },
        { offerId: "b", images: ["b-01.jpg"] },
      ])
    );
    assert.deepEqual(files.map((f) => f.fileName), ["lot-02-b-01.jpg"]);
  });

  it("gives a captioned post's lot its one drawn photo, and none until it is drawn", () => {
    const photos: FacebookPostPhotos = {
      layout: "captions",
      lots: [
        { offerId: "a", lotNo: 1, fileName: "lot-01-a.jpg", state: { status: "ready", photoId: "pa" } },
        { offerId: "b", lotNo: 2, fileName: "lot-02-b.jpg", state: { status: "generating" } },
      ],
    };
    assert.deepEqual(
      facebookPostPhotoFiles([lot("a", 1), lot("b", 2)], photos).map((f) => [f.key, f.photoId, f.fileName]),
      [["a", "pa", "lot-01-a.jpg"]]
    );
  });

  it("has nothing before the photos are read", () => {
    assert.deepEqual(facebookPostPhotoFiles([lot("a", 1)], undefined), []);
  });
});

describe("facebookPostPhotosHeld", () => {
  it("names the lots whose photos are being made again, laid out as text", () => {
    const photos = text([
      { offerId: "a", images: ["a.jpg"] },
      { offerId: "b", status: "running", images: ["b.jpg"] },
      { offerId: "c", status: "queued", images: ["c.jpg"] },
    ]);
    assert.equal(
      facebookPostPhotosHeld([lot("a", 1), lot("b", 2), lot("c", 3)], photos),
      "The photos of lots 2, 3 are still being generated — download the photos once they are ready."
    );
  });

  it("names a captioned lot still being drawn, or failed, as the ZIP does", () => {
    const photos: FacebookPostPhotos = {
      layout: "captions",
      lots: [
        { offerId: "a", lotNo: 1, fileName: "a.jpg", state: { status: "generating" } },
        { offerId: "b", lotNo: 2, fileName: "b.jpg", state: { status: "ready", photoId: "pb" } },
      ],
    };
    assert.match(facebookPostPhotosHeld([lot("a", 1), lot("b", 2)], photos) ?? "", /The photo of lot 1 is still being generated/);
    const failed: FacebookPostPhotos = {
      layout: "captions",
      lots: [{ offerId: "a", lotNo: 1, fileName: "a.jpg", state: { status: "failed", error: "x" } }],
    };
    assert.match(facebookPostPhotosHeld([lot("a", 1)], failed) ?? "", /lot 1 is not generated: drawing failed/);
  });

  it("holds nothing back for a lot left out, or once every photo is in", () => {
    const photos = text([{ offerId: "a", status: "running", images: [] }, { offerId: "b", images: ["b.jpg"] }]);
    assert.equal(facebookPostPhotosHeld([lot("a", 1, "withdrawn"), lot("b", 2)], photos), null);
    assert.equal(facebookPostPhotosHeld([lot("b", 2)], text([{ offerId: "b", images: ["b.jpg"] }])), null);
  });
});

describe("facebookPostPublishVia", () => {
  it("publishes through a lot that goes up, and approves through a pending one", () => {
    const lots = [lot("a", 1, "sold"), lot("b", 2, "ready"), lot("c", 3, "pending")];
    assert.equal(facebookPostPublishVia(lots, false), "b");
    assert.equal(facebookPostPublishVia(lots, true), "c");
    assert.equal(facebookPostPublishVia([], false), undefined);
  });
});

describe("facebookPostPublishedMessage", () => {
  const ready = [lot("a", 1), lot("b", 2)];
  it("says the post is up, submitted or approved", () => {
    assert.equal(facebookPostPublishedMessage(7, ready, { approving: false, target: "active" }), "Post #7 is up — all 2 lots active");
    assert.equal(facebookPostPublishedMessage(7, [lot("a", 1)], { approving: false, target: "active" }), "Post #7 is up");
    assert.equal(
      facebookPostPublishedMessage(7, ready, { approving: false, target: "pending" }),
      "Post #7 submitted — waiting for the group's approval"
    );
    assert.equal(
      facebookPostPublishedMessage(7, [lot("a", 1, "pending")], { approving: true, target: "active" }),
      "Post #7 approved — all its lots are up"
    );
  });

  it("says what stayed behind — sold before it went up, or while it waited", () => {
    assert.equal(
      facebookPostPublishedMessage(7, [lot("a", 1, "sold"), lot("b", 2)], { approving: false, target: "active" }),
      "Post #7 is up — 1 of its 2 lots active, the sold ones left out"
    );
    assert.equal(
      facebookPostPublishedMessage(7, [lot("a", 1, "sold", {}), lot("b", 2, "pending")], { approving: true, target: "active" }),
      "Post #7 approved — the lots that were waiting are up"
    );
  });
});
