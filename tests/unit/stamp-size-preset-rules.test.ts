import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeStampSizePresetApply,
  filterStampSizePresets,
  sizePairFromFields,
  stampSizePresetLabel,
  summarizeStampSizePresetApply,
  type StampSizePresetApplyCounts,
} from "../../src/lib/stamp-size-preset-rules";

// The pure half of the size preset screens (#805, #806; ADR-0048).

const germania = { id: "g", widthMm: 25, heightMm: 30, name: "Germania" };
const small = { id: "s", widthMm: 21.5, heightMm: 25, name: null };
const wide = { id: "w", widthMm: 30, heightMm: 25, name: "Wide 1900" };
const big = { id: "b", widthMm: 250, heightMm: 40, name: null };
const ALL = [germania, small, wide, big];

const ids = (list: { id: string }[]) => list.map((p) => p.id);

describe("stampSizePresetLabel", () => {
  it("reads the pair, then the name when there is one", () => {
    assert.equal(stampSizePresetLabel(germania), "25 × 30 mm · Germania");
    assert.equal(stampSizePresetLabel(small), "21.5 × 25 mm");
  });
});

describe("filterStampSizePresets", () => {
  it("returns everything, in the dragged order, for an empty query", () => {
    assert.deepEqual(ids(filterStampSizePresets(ALL, "")), ["g", "s", "w", "b"]);
    assert.deepEqual(ids(filterStampSizePresets(ALL, "   ")), ["g", "s", "w", "b"]);
  });

  it("matches on the name, ignoring case", () => {
    assert.deepEqual(ids(filterStampSizePresets(ALL, "germ")), ["g"]);
    assert.deepEqual(ids(filterStampSizePresets(ALL, "WIDE")), ["w"]);
  });

  it("matches on the figures, as a prefix of either dimension", () => {
    assert.deepEqual(ids(filterStampSizePresets(ALL, "21")), ["s"]);
    // `25` is Germania's width, the small one's height, the wide one's height, and a prefix of 250.
    assert.deepEqual(ids(filterStampSizePresets(ALL, "25")), ["g", "s", "w", "b"]);
    // Not a substring: `5` is inside 25 and 21.5 but starts neither.
    assert.deepEqual(ids(filterStampSizePresets(ALL, "5")), []);
  });

  it("reads a pair however it is written", () => {
    for (const q of ["25x30", "25 x 30", "25 × 30", "25*30", "25 30", "25 × 30 mm", "25mm 30mm"]) {
      assert.deepEqual(ids(filterStampSizePresets(ALL, q)), ["g", "w"], q);
    }
    assert.deepEqual(ids(filterStampSizePresets(ALL, "21,5")), ["s"]);
  });

  it("requires every word, a figure and a name together", () => {
    assert.deepEqual(ids(filterStampSizePresets(ALL, "25 germania")), ["g"]);
    assert.deepEqual(ids(filterStampSizePresets(ALL, "21 germania")), []);
  });

  it("lets a figure find a year in a name", () => {
    assert.deepEqual(ids(filterStampSizePresets(ALL, "1900")), ["w"]);
  });
});

describe("sizePairFromFields", () => {
  it("takes a complete, readable pair, rounded as the form would store it", () => {
    assert.deepEqual(sizePairFromFields("25", "30"), { widthMm: 25, heightMm: 30 });
    assert.deepEqual(sizePairFromFields("21,46", " 25 "), { widthMm: 21.5, heightMm: 25 });
  });

  it("refuses half a size", () => {
    assert.equal(sizePairFromFields("25", ""), null);
    assert.equal(sizePairFromFields(null, "30"), null);
    assert.equal(sizePairFromFields("", ""), null);
  });

  it("refuses a figure the form would refuse", () => {
    assert.equal(sizePairFromFields("25mm", "30"), null);
    assert.equal(sizePairFromFields("25", "0"), null);
    assert.equal(sizePairFromFields("abc", "30"), null);
  });
});

const counts = (over: Partial<StampSizePresetApplyCounts>): StampSizePresetApplyCounts => ({
  widthMm: 25,
  heightMm: 30,
  total: 20,
  withoutSize: 17,
  withStatedSize: 3,
  withPartialSize: 0,
  ...over,
});

describe("describeStampSizePresetApply", () => {
  it("states ADR-0048 §6's sentence, skipping the stated by default", () => {
    assert.deepEqual(describeStampSizePresetApply(counts({}), false), {
      willWrite: 17,
      lines: [
        "17 stamps have no size and will get 25 × 30 mm.",
        "3 stamps already state a size and will be left as they are.",
      ],
    });
  });

  it("counts the stated in only when told to overwrite", () => {
    const d = describeStampSizePresetApply(counts({}), true);
    assert.equal(d.willWrite, 20);
    assert.equal(d.lines[1], "3 stamps already state a size and will be overwritten with 25 × 30 mm.");
  });

  it("says which of the stated state only half", () => {
    assert.equal(
      describeStampSizePresetApply(counts({ withPartialSize: 1 }), false).lines[1],
      "3 stamps already state a size (1 of them only a width or only a height) and will be left as they are."
    );
    assert.equal(
      describeStampSizePresetApply(counts({ withPartialSize: 3 }), false).lines[1],
      "3 stamps already state a size (each only a width or only a height) and will be left as they are."
    );
    assert.equal(
      describeStampSizePresetApply(
        counts({ total: 2, withoutSize: 1, withStatedSize: 1, withPartialSize: 1 }),
        false
      ).lines.join(" "),
      "1 stamp has no size and will get 25 × 30 mm. 1 stamp already states a size (only a width or only a height) and will be left as it is."
    );
  });

  it("has nothing to write when every stamp states a size and the box is clear", () => {
    const d = describeStampSizePresetApply(counts({ withoutSize: 0, withStatedSize: 20 }), false);
    assert.equal(d.willWrite, 0);
    assert.equal(d.lines[0], "Every stamp here already states a size.");
  });

  it("says so when the subject has no stamps", () => {
    assert.deepEqual(
      describeStampSizePresetApply(counts({ total: 0, withoutSize: 0, withStatedSize: 0 }), true),
      { willWrite: 0, lines: ["There are no stamps here to size."] }
    );
  });
});

describe("summarizeStampSizePresetApply", () => {
  it("reports what the write did, and what it left", () => {
    assert.deepEqual(summarizeStampSizePresetApply({ ...counts({}), written: 17 }, false), {
      message: "25 × 30 mm written to 17 stamps; 3 stamps that already stated one left as they were",
      tone: "success",
    });
    assert.deepEqual(summarizeStampSizePresetApply({ ...counts({}), written: 20 }, true), {
      message: "25 × 30 mm written to 20 stamps",
      tone: "success",
    });
  });

  it("is not a success when nothing was written", () => {
    assert.equal(
      summarizeStampSizePresetApply({ ...counts({ withoutSize: 0 }), written: 0 }, false).tone,
      "info"
    );
  });
});
