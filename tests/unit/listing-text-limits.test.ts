import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LISTING_TEXT_LENGTH_LIMIT,
  evaluateListingTextLimits,
  listingTextLength,
  parsePlatformTextLimits,
  textLengthState,
} from "../../src/lib/listing-text-limits";

const NO_LIMITS = { maxTitleLength: "", maxDescriptionLength: "", maxPrivateNoteLength: "" };

describe("parsePlatformTextLimits", () => {
  it("reads blank fields as no limit stated", () => {
    const parsed = parsePlatformTextLimits(NO_LIMITS);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, {
      maxTitleLength: null,
      maxDescriptionLength: null,
      maxPrivateNoteLength: null,
    });
  });

  it("reads the three limits independently", () => {
    const parsed = parsePlatformTextLimits({
      maxTitleLength: "80",
      maxDescriptionLength: "100",
      maxPrivateNoteLength: " 250 ",
    });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, {
      maxTitleLength: 80,
      maxDescriptionLength: 100,
      maxPrivateNoteLength: 250,
    });
  });

  it("allows one limit without the others — Colnect caps two texts, Delcampe caps the title", () => {
    const parsed = parsePlatformTextLimits({ ...NO_LIMITS, maxTitleLength: "80" });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, {
      maxTitleLength: 80,
      maxDescriptionLength: null,
      maxPrivateNoteLength: null,
    });
  });

  it("rejects a non-integer", () => {
    const parsed = parsePlatformTextLimits({ ...NO_LIMITS, maxDescriptionLength: "12.5" });
    assert.ok(!parsed.ok);
    assert.match(parsed.message, /whole number/);
  });

  it("rejects zero and negative caps — a zero-length field is not a limit, it is a broken one", () => {
    for (const raw of ["0", "-1"]) {
      const parsed = parsePlatformTextLimits({ ...NO_LIMITS, maxPrivateNoteLength: raw });
      assert.ok(!parsed.ok);
      assert.match(parsed.message, /Max private note length/);
    }
  });

  it("rejects a value past the sanity rail", () => {
    const parsed = parsePlatformTextLimits({
      ...NO_LIMITS,
      maxDescriptionLength: String(MAX_LISTING_TEXT_LENGTH_LIMIT + 1),
    });
    assert.ok(!parsed.ok);
  });
});

describe("listingTextLength", () => {
  it("counts UTF-16 code units, the unit an HTML maxlength enforces", () => {
    assert.equal(listingTextLength("Mi 1-12"), 7);
    // An astral character costs two units in the platform's own field, so it costs two here.
    assert.equal(listingTextLength("🇵🇱"), 4);
  });

  it("treats a missing text as empty", () => {
    assert.equal(listingTextLength(null), 0);
    assert.equal(listingTextLength(undefined), 0);
  });
});

describe("textLengthState", () => {
  it("renders nothing when the platform states no limit", () => {
    assert.equal(textLengthState("anything", null), null);
    assert.equal(textLengthState("anything", undefined), null);
  });

  it("reports a text that fits", () => {
    assert.deepEqual(textLengthState("abc", 100), { length: 3, limit: 100, over: 0 });
  });

  it("reports exactly at the limit as fitting", () => {
    assert.deepEqual(textLengthState("a".repeat(100), 100), { length: 100, limit: 100, over: 0 });
  });

  it("reports how far a text runs over", () => {
    assert.deepEqual(textLengthState("a".repeat(103), 100), { length: 103, limit: 100, over: 3 });
  });

  it("counts an empty text against a limit rather than hiding the counter", () => {
    assert.deepEqual(textLengthState(null, 100), { length: 0, limit: 100, over: 0 });
  });
});

describe("evaluateListingTextLimits (#636)", () => {
  const texts = { name: "A title", description: "A description", privateNote: "A note" };
  const noCaps = { maxTitleLength: null, maxDescriptionLength: null, maxPrivateNoteLength: null };

  it("says nothing where the platform states no cap — which is the normal case", () => {
    assert.deepEqual(
      evaluateListingTextLimits({ ...texts, name: "x".repeat(400) }, noCaps),
      []
    );
  });

  it("says nothing about a text exactly at its cap", () => {
    assert.deepEqual(
      evaluateListingTextLimits({ ...texts, name: "x".repeat(80) }, { ...noCaps, maxTitleLength: 80 }),
      []
    );
  });

  it("blocks an over-long title, naming the text and both numbers", () => {
    // A count with no target is not actionable in a batch of forty, which is the whole reason this
    // is a blocker rather than the counter #403 already drew.
    const [blocker, ...rest] = evaluateListingTextLimits(
      { ...texts, name: "x".repeat(92) },
      { ...noCaps, maxTitleLength: 80 }
    );
    assert.deepEqual(rest, []);
    assert.equal(blocker.code, "title-too-long");
    assert.match(blocker.title, /listing title is 12 characters over this platform's 80/);
    assert.match(blocker.message, /92 characters, 12 over this platform's 80/);
    assert.match(blocker.message, /nothing is shortened for you/);
  });

  it("blocks the description and the private note on their own caps", () => {
    const blockers = evaluateListingTextLimits(
      { name: "ok", description: "x".repeat(120), privateNote: "y".repeat(101) },
      { maxTitleLength: null, maxDescriptionLength: 100, maxPrivateNoteLength: 100 }
    );
    assert.deepEqual(
      blockers.map((blocker) => blocker.code),
      ["description-too-long", "private-note-too-long"]
    );
    assert.match(blockers[1].title, /1 character over/);
  });

  it("reports every text that is over at once, so fixing them is one pass", () => {
    const blockers = evaluateListingTextLimits(
      { name: "x".repeat(90), description: "x".repeat(120), privateNote: "x".repeat(120) },
      { maxTitleLength: 80, maxDescriptionLength: 100, maxPrivateNoteLength: 100 }
    );
    assert.equal(blockers.length, 3);
  });

  it("counts a missing text as nothing rather than as a fault", () => {
    assert.deepEqual(
      evaluateListingTextLimits(
        { name: null, description: null, privateNote: null },
        { maxTitleLength: 1, maxDescriptionLength: 1, maxPrivateNoteLength: 1 }
      ),
      []
    );
  });
});
