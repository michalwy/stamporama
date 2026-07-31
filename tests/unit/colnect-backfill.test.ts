import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  proposeBackfill,
  splitColnectNumber,
  type BackfillRefInput,
  type BackfillTarget,
} from "../../src/lib/colnect-backfill";

// Backfilling missing catalog numbers from a matched Colnect item (#280). The interesting part is
// the prefix split: we store bare numbers, Colnect prints them joined with a country code.

const V_MI = "vendor-mi";
const V_SN = "vendor-sn";

const ref = (
  catalog: string,
  printedNumber: string,
  catalogVendorId: string,
  vendorAbbreviation: string
): BackfillRefInput => ({ catalog, printedNumber, catalogVendorId, vendorAbbreviation });

const target = (
  numbers: Record<string, string>,
  prefixes: Record<string, string | null>
): BackfillTarget => ({
  numbersByVendor: new Map(Object.entries(numbers)),
  prefixByVendor: new Map(Object.entries(prefixes)),
});

describe("splitColnectNumber", () => {
  it("takes a digit-free leading token as the area prefix", () => {
    assert.deepEqual(splitColnectNumber("PL 3690"), { areaPrefix: "PL", number: "3690" });
    assert.deepEqual(splitColnectNumber("PL Bl.140"), { areaPrefix: "PL", number: "Bl.140" });
  });

  it("keeps prefixless values whole, letters and all", () => {
    for (const value of ["BL132", "P169", "ATM2.2x", "3706-3711"]) {
      assert.deepEqual(splitColnectNumber(value), { areaPrefix: null, number: value });
    }
  });

  it("does not split a spaced range whose leading token carries digits", () => {
    assert.deepEqual(splitColnectNumber("3706 - 3711"), {
      areaPrefix: null,
      number: "3706 - 3711",
    });
  });
});

describe("proposeBackfill", () => {
  it("fills a catalog the stamp lacks, stripping the matching area prefix", () => {
    const out = proposeBackfill(
      [ref("Sn", "PL 3382", V_SN, "Sn")],
      target({ [V_MI]: "3690" }, { [V_MI]: "PL", [V_SN]: "PL" })
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].status, "would-fill");
    assert.equal(out[0].number, "3382");
    assert.equal(out[0].label, "Sn·PL 3382");
  });

  it("stores a prefixless number verbatim even under a prefixed area", () => {
    const out = proposeBackfill(
      [ref("Sn", "BL132", V_SN, "Sn")],
      target({}, { [V_SN]: "PL" })
    );
    assert.equal(out[0].status, "would-fill");
    assert.equal(out[0].number, "BL132");
  });

  it("skips a prefixed number when the area configures no prefix for that catalog", () => {
    const out = proposeBackfill([ref("Sn", "PL 3382", V_SN, "Sn")], target({}, { [V_SN]: null }));
    assert.equal(out[0].status, "skipped-no-area-prefix");
    assert.equal(out[0].number, null);
  });

  it("reports a prefix mismatch rather than writing another area's number", () => {
    const out = proposeBackfill([ref("Sn", "DE 200", V_SN, "Sn")], target({}, { [V_SN]: "PL" }));
    assert.equal(out[0].status, "prefix-mismatch");
    assert.equal(out[0].number, null);
  });

  it("compares prefixes case- and punctuation-insensitively", () => {
    const out = proposeBackfill([ref("Sn", "pl. 3382", V_SN, "Sn")], target({}, { [V_SN]: "PL" }));
    assert.equal(out[0].status, "would-fill");
    assert.equal(out[0].number, "3382");
  });

  it("proposes nothing for a catalog whose number already agrees", () => {
    const out = proposeBackfill(
      [ref("Mi", "PL 3690", V_MI, "Mi")],
      target({ [V_MI]: "3690" }, { [V_MI]: "PL" })
    );
    assert.deepEqual(out, []);
  });

  it("reports a disagreeing existing number as a conflict, never a write", () => {
    const out = proposeBackfill(
      [ref("Mi", "PL 3691", V_MI, "Mi")],
      target({ [V_MI]: "3690" }, { [V_MI]: "PL" })
    );
    assert.equal(out[0].status, "conflict");
    assert.equal(out[0].number, null);
    assert.equal(out[0].existingNumber, "3690");
    assert.equal(out[0].label, "Mi·PL 3690");
    // …but it says what taking Colnect's word would store, which is what #433 offers.
    assert.equal(out[0].overwriteNumber, "3691");
    assert.equal(out[0].overwriteLabel, "Mi·PL 3691");
  });

  it("offers no overwrite for a conflict whose printed number we could not store (#433)", () => {
    // The same two refusals a fill reports: no prefix configured, and a prefix from another area.
    const noPrefix = proposeBackfill(
      [ref("Mi", "PL 3691", V_MI, "Mi")],
      target({ [V_MI]: "3690" }, { [V_MI]: null })
    );
    assert.equal(noPrefix[0].status, "conflict");
    assert.equal(noPrefix[0].overwriteNumber, null);
    assert.equal(noPrefix[0].overwriteLabel, undefined);

    const otherArea = proposeBackfill(
      [ref("Mi", "DE 200", V_MI, "Mi")],
      target({ [V_MI]: "3690" }, { [V_MI]: "PL" })
    );
    assert.equal(otherArea[0].status, "conflict");
    assert.equal(otherArea[0].overwriteNumber, null);
  });

  it("lets only the first reference per vendor fill; a second conflicts with it", () => {
    const out = proposeBackfill(
      [ref("Sn", "PL 3382", V_SN, "Sn"), ref("Sc", "PL 3383", V_SN, "Sn")],
      target({}, { [V_SN]: "PL" })
    );
    assert.deepEqual(
      out.map((p) => p.status),
      ["would-fill", "conflict"]
    );
    assert.equal(out[1].existingNumber, "3382");
    // Nothing to correct: the number it disagrees with is the fill this batch is about to make,
    // not something the stamp holds (#433).
    assert.equal(out[1].overwriteNumber, null);
  });
});
