import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyPostPhotoSettingsPatch,
  isEmptyPostPhotoSettingsPatch,
  parsePostPhotoSettingsPatch,
  samePhotoConfig,
  sharedPhotoSettings,
  type LotPhotoConfig,
} from "../../src/lib/facebook-post-photo-settings-rules";
import { readPhotoConfigFields } from "../../src/lib/offer-photo-config";

// A post's *Photo settings…* (#2032): what the lots share, what differs, and a save writing only what
// was changed.

const COLLAGE = {
  collageGridMode: "auto",
  collageGridShape: "landscape",
  collageRows: 3,
  collageColumns: 4,
  collageGapPercent: 5,
  collageBackground: "#ffffff",
  collageLabelPercent: 4,
} as const;

const LOT: LotPhotoConfig = {
  photoSides: "front",
  preferSingles: true,
  photoLabelLeftTemplate: "{ref}",
  photoLabelRightTemplate: null,
  collage: { ...COLLAGE },
  coverSymbols: null,
  groupByChecklist: false,
  groupCollage: null,
};

/** A form as the dialog posts it, with every field blank unless given. */
function form(fields: Record<string, string>) {
  return readPhotoConfigFields((name) => fields[name] ?? "");
}

describe("sharedPhotoSettings (#2032)", () => {
  it("shows a setting every lot shares with its value", () => {
    const shared = sharedPhotoSettings([LOT, { ...LOT, collage: { ...COLLAGE } }]);
    assert.deepEqual(shared.photoSides, { same: true, value: "front" });
    assert.deepEqual(shared.collage, { same: true, value: COLLAGE });
    assert.deepEqual(shared.coverSymbols, { same: true, value: null });
  });

  it("says a setting differs where any lot holds another value", () => {
    const shared = sharedPhotoSettings([LOT, LOT, { ...LOT, photoSides: "both", collage: { ...COLLAGE, collageRows: 2 } }]);
    assert.deepEqual(shared.photoSides, { same: false });
    assert.deepEqual(shared.collage, { same: false });
    assert.deepEqual(shared.preferSingles, { same: true, value: true });
  });

  it("tells no collage from one", () => {
    assert.deepEqual(sharedPhotoSettings([LOT, { ...LOT, collage: null }]).collage, { same: false });
  });
});

describe("applyPostPhotoSettingsPatch (#2032)", () => {
  it("writes only the settings in the patch, leaving each lot's others as they were", () => {
    const other = { ...LOT, photoLabelLeftTemplate: "{catalog}", collage: null };
    const next = applyPostPhotoSettingsPatch(other, { photoSides: "both" });
    assert.equal(next.photoSides, "both");
    assert.equal(next.photoLabelLeftTemplate, "{catalog}");
    assert.equal(next.collage, null);
  });

  it("writes a cleared setting — null is a value, not a gap", () => {
    assert.equal(applyPostPhotoSettingsPatch(LOT, { photoLabelLeftTemplate: null }).photoLabelLeftTemplate, null);
    assert.equal(applyPostPhotoSettingsPatch(LOT, { collage: null }).collage, null);
  });

  it("pairs each lot's own sides to the template picked while the sides are not written", () => {
    const patch = { collage: { ...COLLAGE }, collagePairSides: true };
    assert.equal(applyPostPhotoSettingsPatch({ ...LOT, photoSides: "both" }, patch).photoSides, "paired");
    assert.equal(applyPostPhotoSettingsPatch({ ...LOT, photoSides: "front" }, patch).photoSides, "front");
    assert.equal(
      applyPostPhotoSettingsPatch({ ...LOT, photoSides: "both" }, { ...patch, photoSides: "back" }).photoSides,
      "back"
    );
  });

  it("leaves a lot already holding the patch's values the same", () => {
    assert.ok(samePhotoConfig(LOT, applyPostPhotoSettingsPatch(LOT, { photoSides: "front", collage: { ...COLLAGE } })));
    assert.ok(!samePhotoConfig(LOT, applyPostPhotoSettingsPatch(LOT, { preferSingles: false })));
  });
});

describe("parsePostPhotoSettingsPatch (#2032)", () => {
  it("keeps only the settings named as changed", () => {
    const parsed = parsePostPhotoSettingsPatch(
      form({ photoSides: "both", photoLabelLeftTemplate: "{ref}", coverSymbols: "on" }),
      ["photoSides"],
      null
    );
    assert.deepEqual(parsed, { ok: true, value: { photoSides: "both" } });
  });

  it("reads an unticked switch named as changed as off", () => {
    const parsed = parsePostPhotoSettingsPatch(form({}), ["preferSingles", "groupByChecklist"], null);
    assert.deepEqual(parsed, { ok: true, value: { preferSingles: false, groupByChecklist: false } });
  });

  it("validates a collage given to every lot", () => {
    const parsed = parsePostPhotoSettingsPatch(form({ collageRows: "3" }), ["collage"], null);
    assert.equal(parsed.ok, false);
  });

  it("carries the template's pairing", () => {
    assert.deepEqual(parsePostPhotoSettingsPatch(form({}), [], "1"), { ok: true, value: { collagePairSides: true } });
  });

  it("is empty when nothing was changed", () => {
    const parsed = parsePostPhotoSettingsPatch(form({ photoSides: "back" }), [], null);
    assert.ok(parsed.ok && isEmptyPostPhotoSettingsPatch(parsed.value));
  });
});
