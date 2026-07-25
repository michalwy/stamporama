import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PHOTO_SIDES,
  MAX_PHOTO_COUNT_LIMIT,
  normalizePhotoSides,
  parseOfferPhotoConfigInput,
  parsePlatformPhotoLimits,
} from "../../src/lib/offer-photo-config";

const NO_LIMITS = { maxPhotos: "", maxPhotoEdge: "", maxPhotoFileSizeMib: "" };

const BLANK_CONFIG = {
  photoSides: "front",
  photoLabelTemplate: "",
  collageRows: "",
  collageColumns: "",
  collageGap: "",
  collageBackground: "",
  collageLabelStripHeight: "",
};

const FULL_CONFIG = {
  photoSides: "both",
  photoLabelTemplate: "{catalog}",
  collageRows: "5",
  collageColumns: "4",
  collageGap: "24",
  collageBackground: "#FFF",
  collageLabelStripHeight: "40",
};

describe("normalizePhotoSides", () => {
  it("keeps a known side", () => {
    assert.equal(normalizePhotoSides("both"), "both");
    assert.equal(normalizePhotoSides(" Back "), "back");
  });

  it("falls back to the default for anything unknown", () => {
    assert.equal(normalizePhotoSides(null), DEFAULT_PHOTO_SIDES);
    assert.equal(normalizePhotoSides(""), DEFAULT_PHOTO_SIDES);
    assert.equal(normalizePhotoSides("sideways"), DEFAULT_PHOTO_SIDES);
  });
});

describe("parsePlatformPhotoLimits", () => {
  it("reads blank fields as no limit at all", () => {
    const result = parsePlatformPhotoLimits(NO_LIMITS);
    assert.ok(result.ok);
    assert.deepEqual(result.value, {
      maxPhotos: null,
      maxPhotoEdge: null,
      maxPhotoFileSizeMib: null,
    });
  });

  it("parses stated limits", () => {
    const result = parsePlatformPhotoLimits({
      maxPhotos: "8",
      maxPhotoEdge: "1600",
      maxPhotoFileSizeMib: "10",
    });
    assert.ok(result.ok);
    assert.deepEqual(result.value, {
      maxPhotos: 8,
      maxPhotoEdge: 1600,
      maxPhotoFileSizeMib: 10,
    });
  });

  it("rejects a limit outside its bounds or not a number", () => {
    const tooMany = parsePlatformPhotoLimits({ ...NO_LIMITS, maxPhotos: "0" });
    assert.equal(tooMany.ok, false);

    const overCap = parsePlatformPhotoLimits({
      ...NO_LIMITS,
      maxPhotos: String(MAX_PHOTO_COUNT_LIMIT + 1),
    });
    assert.equal(overCap.ok, false);

    const notANumber = parsePlatformPhotoLimits({ ...NO_LIMITS, maxPhotoEdge: "big" });
    assert.equal(notANumber.ok, false);
  });
});

describe("parseOfferPhotoConfigInput", () => {
  it("parses a complete configuration, normalising the colour", () => {
    const result = parseOfferPhotoConfigInput(FULL_CONFIG);
    assert.ok(result.ok);
    assert.equal(result.value.photoSides, "both");
    assert.equal(result.value.photoLabelTemplate, "{catalog}");
    assert.deepEqual(result.value.collage, {
      collageRows: 5,
      collageColumns: 4,
      collageGap: 24,
      collageBackground: "#ffffff",
      collageLabelStripHeight: 40,
    });
  });

  it("treats an all-blank collage group as no collage numbers yet", () => {
    const result = parseOfferPhotoConfigInput(BLANK_CONFIG);
    assert.ok(result.ok);
    assert.equal(result.value.collage, null);
    assert.equal(result.value.photoLabelTemplate, null);
  });

  it("rejects a half-filled collage group", () => {
    const result = parseOfferPhotoConfigInput({ ...BLANK_CONFIG, collageRows: "3" });
    assert.equal(result.ok, false);
  });

  it("rejects an invalid collage value", () => {
    const badColour = parseOfferPhotoConfigInput({ ...FULL_CONFIG, collageBackground: "white" });
    assert.equal(badColour.ok, false);

    const badRows = parseOfferPhotoConfigInput({ ...FULL_CONFIG, collageRows: "0" });
    assert.equal(badRows.ok, false);
  });

  it("falls back to the default side rather than failing on an unknown one", () => {
    const result = parseOfferPhotoConfigInput({ ...BLANK_CONFIG, photoSides: "nonsense" });
    assert.ok(result.ok);
    assert.equal(result.value.photoSides, DEFAULT_PHOTO_SIDES);
  });
});
