import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canPreviewFacebookPost,
  FACEBOOK_POST_PREVIEW_LABEL_LANGUAGES,
  FACEBOOK_POST_PREVIEW_TOKEN_PREFIX,
  facebookPostPreviewLabelLanguage,
  facebookPostPreviewLabels,
  facebookPostPreviewLink,
  facebookPostPreviewMark,
  facebookPostPreviewPath,
  facebookPostPreviewPhotoPath,
  facebookPostPreviewPhotoSrcs,
  facebookPostPreviewStanding,
  hasFacebookPostPreviewLabels,
  isFacebookPostPreviewTokenShape,
} from "../../src/lib/facebook-post-preview-rules";
import { SPECIFICATION_LABEL_LANGUAGES } from "../../src/lib/offer-specification-labels";

// A Facebook post's preview for a buyer (#2212) — the pure half.

const lots = (...states: string[]) => states.map((state) => ({ state }));

describe("the post preview link's shape (#2212)", () => {
  it("accepts its own prefix with something after it", () => {
    assert.equal(isFacebookPostPreviewTokenShape(`${FACEBOOK_POST_PREVIEW_TOKEN_PREFIX}abc`), true);
  });

  it("rejects the prefix alone, an empty string and every other credential", () => {
    assert.equal(isFacebookPostPreviewTokenShape(FACEBOOK_POST_PREVIEW_TOKEN_PREFIX), false);
    assert.equal(isFacebookPostPreviewTokenShape(""), false);
    for (const other of ["stmpa_abc", "stmpx_abc", "stmps_abc", "stmpo_abc"]) {
      assert.equal(isFacebookPostPreviewTokenShape(other), false, other);
    }
  });

  it("addresses the page and its photos outside any collection", () => {
    assert.equal(facebookPostPreviewPath("stmpf_x"), "/fb/stmpf_x");
    assert.equal(facebookPostPreviewPhotoPath("stmpf_x", "p1", "full"), "/api/fb/stmpf_x/photos/p1/full");
  });

  it("addresses every lot's photos by id", () => {
    assert.deepEqual(
      facebookPostPreviewPhotoSrcs({ lots: [{ photoIds: ["a", "b"] }, { photoIds: [] }, { photoIds: ["c"] }] }, (id) => `/x/${id}`),
      { a: "/x/a", b: "/x/b", c: "/x/c" }
    );
  });
});

describe("what the preview shows of a post (#2212)", () => {
  it("shows a Ready, pending or published post", () => {
    assert.equal(facebookPostPreviewStanding(lots("ready", "ready")), "shown");
    assert.equal(facebookPostPreviewStanding(lots("pending", "pending")), "shown");
    assert.equal(facebookPostPreviewStanding(lots("active", "sold")), "shown");
  });

  it("says a post taken back to preparing is being updated", () => {
    assert.equal(facebookPostPreviewStanding(lots("ready", "preparing")), "updating");
  });

  it("keeps showing a post that is over with something sold", () => {
    assert.equal(facebookPostPreviewStanding(lots("sold", "withdrawn")), "shown");
  });

  it("says a withdrawn or deleted post is no longer current", () => {
    assert.equal(facebookPostPreviewStanding(lots("withdrawn", "withdrawn")), "gone");
    assert.equal(facebookPostPreviewStanding([]), "gone");
    assert.equal(facebookPostPreviewStanding(null), "gone");
  });

  it("is offered once the post is Ready and while it waits or is up — not while it is prepared or over", () => {
    assert.equal(canPreviewFacebookPost(lots("ready")), true);
    assert.equal(canPreviewFacebookPost(lots("pending")), true);
    assert.equal(canPreviewFacebookPost(lots("active", "sold")), true);
    assert.equal(canPreviewFacebookPost(lots("ready", "preparing")), false);
    assert.equal(canPreviewFacebookPost(lots("sold", "withdrawn")), false);
  });

  it("marks a sold lot Sold and a withdrawn one unavailable", () => {
    assert.equal(facebookPostPreviewMark("sold"), "sold");
    assert.equal(facebookPostPreviewMark("withdrawn"), "unavailable");
    assert.equal(facebookPostPreviewMark("active"), null);
  });

  it("hands out the post's link only once the group has approved it", () => {
    const url = "https://facebook.com/groups/1/posts/2";
    assert.equal(facebookPostPreviewLink([{ state: "pending", url }]), null);
    assert.equal(facebookPostPreviewLink([{ state: "ready", url }]), null);
    assert.equal(facebookPostPreviewLink([{ state: "active", url }]), url);
    assert.equal(facebookPostPreviewLink([{ state: "sold", url }, { state: "active", url }]), url);
  });
});

describe("the preview's own words (#2212)", () => {
  it("speaks every language a specification does", () => {
    assert.deepEqual(FACEBOOK_POST_PREVIEW_LABEL_LANGUAGES, SPECIFICATION_LABEL_LANGUAGES);
  });

  it("falls back to English for a language it has no words in", () => {
    assert.equal(hasFacebookPostPreviewLabels("ja"), false);
    assert.equal(facebookPostPreviewLabels("ja").sold, "Sold");
    assert.equal(facebookPostPreviewLabelLanguage("ja"), "en");
    assert.equal(facebookPostPreviewLabelLanguage(null), "en");
  });

  it("reads a regional code by its language", () => {
    assert.equal(facebookPostPreviewLabels("pl-PL").sold, "Sprzedane");
    assert.equal(facebookPostPreviewLabelLanguage("pl-PL"), "pl");
  });

  it("has every word in every language", () => {
    const keys = Object.keys(facebookPostPreviewLabels("en")).sort();
    for (const language of FACEBOOK_POST_PREVIEW_LABEL_LANGUAGES) {
      const labels = facebookPostPreviewLabels(language);
      assert.deepEqual(Object.keys(labels).sort(), keys, language);
      for (const key of keys) assert.ok(labels[key as keyof typeof labels].trim(), `${language}.${key}`);
    }
  });
});
