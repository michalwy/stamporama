import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isApiError } from "../../src/lib/agent-api/errors";
import {
  parseAgentSizeMm,
  presetVocabularyEntry,
  sizeApply,
  sizePreset,
  stampSizeReading,
  unresolvedStamps,
} from "../../src/lib/agent-api/size-reads";
import { resolveVocabularyValue } from "../../src/lib/agent-api/vocabulary";
import type { AgentCatalogResolution } from "../../src/lib/agent-api/catalog-resolve";

// The pure half of the size operations (#1415): the figure grammar, the source of a stamp's size,
// the apply's report, and the refusal for stamps a catalogue number does not name exactly.

function refusal(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    assert.ok(isApiError(err), `expected an ApiError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected a refusal");
}

describe("parseAgentSizeMm", () => {
  it("reads millimetres to a tenth, a comma as a decimal point", () => {
    assert.equal(parseAgentSizeMm("21.5", "width_mm"), 21.5);
    assert.equal(parseAgentSizeMm("25", "width_mm"), 25);
    assert.equal(parseAgentSizeMm(" 21,5 ", "width_mm"), 21.5);
  });

  it("refuses a second decimal rather than rounding it away", () => {
    const err = refusal(() => parseAgentSizeMm("21.55", "height_mm"));
    assert.equal(err.code, "invalid_request");
    assert.match(err.message, /"height_mm"/);
  });

  it("refuses what the form refuses: out of bounds, units, signs, blanks", () => {
    for (const value of ["0.5", "10000", "-3", "21 mm", "", "2.5cm", "abc"]) {
      refusal(() => parseAgentSizeMm(value, "width_mm"));
    }
    assert.equal(parseAgentSizeMm("1", "width_mm"), 1);
    assert.equal(parseAgentSizeMm("9999.9", "width_mm"), 9999.9);
  });
});

describe("presets", () => {
  const named = { id: "p1", widthMm: 25, heightMm: 30, name: "Germania" };
  const bare = { id: "p2", widthMm: 21.5, heightMm: 25, name: null };

  it("are labelled the way the picker labels them", () => {
    assert.deepEqual(sizePreset(named), {
      presetId: "p1",
      widthMm: 25,
      heightMm: 30,
      name: "Germania",
      label: "25 × 30 mm · Germania",
    });
    assert.deepEqual(sizePreset(bare), { presetId: "p2", widthMm: 21.5, heightMm: 25, label: "21.5 × 25 mm" });
  });

  it("answer to an id, a name, a label, and an unnamed one to its pair", () => {
    const entries = [named, bare].map(presetVocabularyEntry);
    const ctx = { vocabulary: "size preset" as const, parameter: "preset" };
    assert.equal(resolveVocabularyValue("p2", entries, ctx), "p2");
    assert.equal(resolveVocabularyValue("germania", entries, ctx), "p1");
    assert.equal(resolveVocabularyValue("25 × 30 mm · Germania", entries, ctx), "p1");
    assert.equal(resolveVocabularyValue("21.5 × 25 mm", entries, ctx), "p2");
    const err = refusal(() => resolveVocabularyValue("Hindenburg", entries, ctx));
    assert.deepEqual(err.accepted, ["Germania", "21.5 × 25 mm"]);
  });
});

describe("stampSizeReading", () => {
  const stamp = { stampId: "b", stampNo: 2, catalogNumbers: ["Mi 2"], name: null, path: "/c/x/stamps/b" };
  const none = { widthMm: null, heightMm: null };
  const list = (
    id: string,
    name: string,
    entries: [string, number | null, number | null][],
    kind = "standard"
  ) => ({
    checklistId: id,
    name,
    kind,
    entries: entries.map(([stampId, widthMm, heightMm]) => ({ stampId, widthMm, heightMm })),
  });

  it("is stated only when the stamp states both figures, and then borrows nothing", () => {
    const reading = stampSizeReading(stamp, { widthMm: 21, heightMm: 25 }, [list("c1", "Basic", [["a", 30, 30], ["b", 21, 25]])], () => undefined);
    assert.equal(reading.source, "stated");
    assert.equal(reading.widthMm, 21);
    assert.equal(reading.inherited, undefined);
  });

  it("names every checklist that lends a figure, and whose it is", () => {
    const reading = stampSizeReading(
      stamp,
      none,
      [
        list("c1", "Basic", [["a", 21, 25], ["b", null, null]]),
        list("c2", "Colour shades", [["b", null, null], ["z", 22, 26]], "specialised"),
        list("c3", "Unmeasured", [["b", null, null], ["y", null, null]]),
      ],
      (id) => ({ a: "Mi 1", z: "Mi 9" })[id]
    );
    assert.equal(reading.source, "inherited");
    assert.deepEqual(reading.inherited, [
      { checklistId: "c1", checklist: "Basic", checklistType: "standard", widthMm: 21, heightMm: 25, fromStampId: "a", fromCatalogNumber: "Mi 1" },
      { checklistId: "c2", checklist: "Colour shades", checklistType: "specialised", widthMm: 22, heightMm: 26, fromStampId: "z", fromCatalogNumber: "Mi 9" },
    ]);
  });

  it("reads half a size as no size, keeping the half figure beside the answer", () => {
    const reading = stampSizeReading(stamp, { widthMm: 21, heightMm: null }, [list("c1", "Basic", [["b", 21, null]])], () => undefined);
    assert.equal(reading.source, "none");
    assert.equal(reading.widthMm, 21);
    assert.equal(reading.heightMm, undefined);
  });
});

describe("sizeApply", () => {
  const counts = { widthMm: 25, heightMm: 30, total: 5, withoutSize: 3, withStatedSize: 2, withPartialSize: 1, written: 0 };

  it("states a preview's willWrite with the dialog's arithmetic and no written", () => {
    const preview = sizeApply(counts, { overwrite: false, preview: true, preset: "25 × 30 mm · Germania" });
    assert.equal(preview.willWrite, 3);
    assert.equal(preview.written, undefined);
    assert.equal(preview.preset, "25 × 30 mm · Germania");
    assert.match(preview.summary[0], /3 stamps have no size and will get 25 × 30 mm/);
    assert.equal(sizeApply(counts, { overwrite: true, preview: true }).willWrite, 5);
  });

  it("states an apply's written off the write, zero included", () => {
    const applied = sizeApply({ ...counts, written: 0 }, { overwrite: false, preview: false });
    assert.equal(applied.written, 0);
    assert.equal(applied.willWrite, undefined);
  });
});

describe("unresolvedStamps", () => {
  const row = (input: string, verdict: AgentCatalogResolution["verdict"], ids: string[] = []): AgentCatalogResolution => ({
    input,
    verdict,
    stamps: ids.map((stampId, i) => ({ stampId, stampNo: i + 1, matchedNumber: `Mi 12${"ab"[i]}`, catalogNumbers: [], path: "" })),
    ...(verdict === "unknown_vendor" ? { acceptedVendors: ["Michel (Mi)"] } : {}),
  });

  it("names every failure in one refusal and hands back the candidates' ids", () => {
    const err = unresolvedStamps(
      [row("Mi 12", "ambiguous", ["s1", "s2"]), row("Fi 3", "unknown_vendor"), row("999", "no_match")],
      "stamps"
    );
    assert.equal(err.code, "invalid_request");
    assert.deepEqual(err.accepted, ["s1", "s2"]);
    assert.match(err.message, /"Mi 12" matches 2 stamps: Mi 12a \(s1\), Mi 12b \(s2\)/);
    assert.match(err.message, /"Fi 3" names a catalogue this collection does not keep \(catalogues kept: Michel \(Mi\)\)/);
    assert.match(err.message, /"999" is no stamp id/);
    assert.match(err.message, /nothing was read or written/);
  });

  it("stops listing at the cap and says how many more", () => {
    const many = Array.from({ length: 13 }, (_, i) => row(`X${i}`, "no_match"));
    const err = unresolvedStamps(many, "stamps");
    assert.match(err.message, /and 3 more/);
    assert.equal(err.accepted, undefined);
  });
});
