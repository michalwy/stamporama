import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allegroImageRejection,
  describeAllegroImageRefusal,
  isAllegroImageMime,
} from "../../src/lib/allegro-image-rules";

// #487's judgements: what the image store takes, and what one refusal of a picture means. The point
// of pinning these down is that both answers are about *one image* — a listing published with fewer
// pictures than the collector prepared is the failure this whole path is designed against.

describe("isAllegroImageMime", () => {
  it("takes the three formats the store accepts as a binary body", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
      assert.equal(isAllegroImageMime(mime), true, mime);
    }
    assert.equal(isAllegroImageMime("image/gif"), false);
    assert.equal(isAllegroImageMime("application/pdf"), false);
  });
});

describe("allegroImageRejection", () => {
  it("passes an image the store can take", () => {
    assert.equal(allegroImageRejection({ fileName: "wegry-01.jpg", mime: "image/jpeg" }), null);
  });

  it("names the file and its format, so the refusal is about a picture", () => {
    const reason = allegroImageRejection({ fileName: "wegry-01.gif", mime: "image/gif" });
    assert.ok(reason);
    assert.ok(reason.includes("wegry-01.gif"));
    assert.ok(reason.includes("image/gif"));
  });

  it("invents no size limit — Allegro publishes none, and a 413 is its own answer to give", () => {
    // A twelve-megabyte JPEG is not refused here: whether it is too large is the store's decision.
    assert.equal(
      allegroImageRejection({ fileName: "big.jpg", mime: "image/jpeg" }),
      null
    );
  });
});

describe("describeAllegroImageRefusal", () => {
  const cases: [number | null, string][] = [
    [413, "too large"],
    [415, "does not accept"],
    [422, "could not process"],
  ];

  for (const [status, phrase] of cases) {
    it(`turns a ${status} into what the collector does next`, () => {
      const message = describeAllegroImageRefusal({
        fileName: "wegry-02.jpg",
        status,
        detail: "",
      });
      assert.ok(message.includes("wegry-02.jpg"));
      assert.ok(message.includes(phrase), message);
    });
  }

  it("keeps Allegro's own words rather than replacing them", () => {
    const message = describeAllegroImageRefusal({
      fileName: "wegry-03.jpg",
      status: 413,
      detail: "Image pixel count is too large",
    });
    assert.ok(message.includes("Image pixel count is too large"));
  });

  it("still names the image when the failure has no status at all", () => {
    const message = describeAllegroImageRefusal({
      fileName: "wegry-04.jpg",
      status: null,
      detail: "Could not reach Allegro.",
    });
    assert.ok(message.includes("wegry-04.jpg"));
    assert.ok(message.includes("Could not reach Allegro."));
  });
});
