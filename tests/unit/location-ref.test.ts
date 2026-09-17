import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareLocationRef,
  highestLocationRef,
  incrementLocationRef,
  locationRefStrip,
  nextLocationRef,
  parseLocationRef,
  parseRefCardCount,
  resolveLocationRefChoice,
  DEFAULT_REF_CARDS,
  MAX_REF_CARDS,
  type LocationRefUsage,
} from "../../src/lib/location-ref";

function sorted(refs: (string | null)[]): (string | null)[] {
  return [...refs].sort(compareLocationRef);
}

describe("parseLocationRef", () => {
  it("splits prefix + trailing number, dropping the separator", () => {
    assert.deepEqual(parseLocationRef("A100"), { prefix: "A", digits: "100" });
    assert.deepEqual(parseLocationRef("B-3000"), { prefix: "B", digits: "3000" });
    assert.deepEqual(parseLocationRef("K 12"), { prefix: "K", digits: "12" });
  });

  it("strips leading zeros and upper-cases the prefix", () => {
    assert.deepEqual(parseLocationRef("a007"), { prefix: "A", digits: "7" });
  });

  it("treats a ref with no trailing number as prefix only", () => {
    assert.deepEqual(parseLocationRef("A10b"), { prefix: "A10B", digits: null });
  });

  it("handles a bare number", () => {
    assert.deepEqual(parseLocationRef("42"), { prefix: "", digits: "42" });
  });
});

describe("compareLocationRef", () => {
  it("orders by prefix first, then by number", () => {
    assert.deepEqual(sorted(["B-3000", "A1200", "A100", "B-40"]), ["A100", "A1200", "B-40", "B-3000"]);
  });

  it("ignores the separator when comparing", () => {
    assert.deepEqual(sorted(["A-1200", "A100"]), ["A100", "A-1200"]);
  });

  it("sorts numbers numerically, not lexicographically", () => {
    assert.deepEqual(sorted(["A10", "A9", "A100"]), ["A9", "A10", "A100"]);
  });

  it("keeps blank refs last", () => {
    assert.deepEqual(sorted(["B1", null, "A1", ""]), ["A1", "B1", null, ""]);
  });

  it("puts an unnumbered ref after the numbered ones sharing its prefix", () => {
    assert.deepEqual(sorted(["A", "A2", "A1"]), ["A1", "A2", "A"]);
  });

  it("compares very long numbers exactly", () => {
    const big = "A" + "9".repeat(25);
    const bigger = "A1" + "0".repeat(25);
    assert.equal(compareLocationRef(big, bigger) < 0, true);
  });
});

// The next-ref allocator (#565). The suggestion is what a strip of blank ref cards is up to, so its
// job is to count on in the shape the collector already writes, and to say nothing at all about a
// location that has never used a ref — the normal case for an album.

describe("incrementLocationRef", () => {
  it("counts on from the trailing number", () => {
    assert.equal(incrementLocationRef("A147"), "A148");
    assert.equal(incrementLocationRef("42"), "43");
  });

  it("keeps the separator and the zero padding", () => {
    assert.equal(incrementLocationRef("B-3000"), "B-3001");
    assert.equal(incrementLocationRef("A007"), "A008");
    assert.equal(incrementLocationRef("K 12"), "K 13");
  });

  it("widens the number only when it has to", () => {
    assert.equal(incrementLocationRef("A099"), "A100");
    assert.equal(incrementLocationRef("A9"), "A10");
  });

  it("counts on past 2^53 exactly", () => {
    assert.equal(incrementLocationRef("A9007199254740993"), "A9007199254740994");
  });

  it("refuses a ref with no trailing number", () => {
    assert.equal(incrementLocationRef("Album"), null);
    assert.equal(incrementLocationRef(""), null);
  });
});

describe("highestLocationRef", () => {
  it("reports the card a location is currently up to", () => {
    assert.equal(highestLocationRef(["A1", "A147", "A12"]), "A147");
  });

  it("reports nothing for a location that has never been ref'd in", () => {
    assert.equal(highestLocationRef([]), null);
    assert.equal(highestLocationRef([null, "", "  "]), null);
  });

  it("follows the strip currently being filled when a location holds two", () => {
    assert.equal(highestLocationRef(["A1", "A200", "B1", "B5"]), "B5");
  });

  it("ignores labels that carry no number", () => {
    assert.equal(highestLocationRef(["Loose", "A3"]), "A3");
    assert.equal(highestLocationRef(["Loose"]), null);
  });

  it("returns the ref as written, so the field opens on what is on the card", () => {
    assert.equal(highestLocationRef([" A007 "]), "A007");
  });
});

describe("nextLocationRef", () => {
  it("suggests one past the highest ref in use", () => {
    assert.equal(nextLocationRef(["A1", "A147", "A12"]), "A148");
  });

  it("suggests nothing for a location that has never been ref'd in", () => {
    assert.equal(nextLocationRef([]), null);
    assert.equal(nextLocationRef([null, "", "  "]), null);
  });

  it("follows the strip currently being filled when a location holds two", () => {
    // `compareLocationRef` orders by prefix first, so `B` is the newer strip even though `A`
    // reaches a higher number.
    assert.equal(nextLocationRef(["A1", "A200", "B1", "B5"]), "B6");
  });

  it("ignores labels that carry no number", () => {
    assert.equal(nextLocationRef(["Loose", "A3"]), "A4");
    assert.equal(nextLocationRef(["Loose"]), null);
  });
});

describe("locationRefStrip", () => {
  it("returns a consecutive run from the start ref", () => {
    assert.deepEqual(locationRefStrip("A147", 3), ["A147", "A148", "A149"]);
  });

  it("keeps the start ref's shape across the whole run", () => {
    assert.deepEqual(locationRefStrip("B-08", 3), ["B-08", "B-09", "B-10"]);
  });

  it("is empty when the start ref cannot be counted from", () => {
    assert.deepEqual(locationRefStrip("Album", 5), []);
    assert.deepEqual(locationRefStrip("", 5), []);
  });

  // The count reaches the strip from a URL, so a count that is not a number has to be caught before
  // it gets here: the loop runs `i < count`, and `NaN` silently produces a strip of one — which is
  // how a sheet asked for twenty cards printed a single one (#565, found on #569).
  it("prints a strip of one for a count that is not a number", () => {
    assert.deepEqual(locationRefStrip("A147", Number.NaN), ["A147"]);
  });
});

describe("parseRefCardCount", () => {
  it("reads the number the address asks for", () => {
    assert.equal(parseRefCardCount("20"), 20);
    assert.equal(parseRefCardCount("1"), 1);
  });

  it("falls back to the default when the address names no count", () => {
    assert.equal(parseRefCardCount(undefined), DEFAULT_REF_CARDS);
    assert.equal(parseRefCardCount(""), DEFAULT_REF_CARDS);
  });

  it("falls back to the default rather than to nothing on nonsense", () => {
    assert.equal(parseRefCardCount("plenty"), DEFAULT_REF_CARDS);
  });

  it("clamps to a printable strip in both directions", () => {
    assert.equal(parseRefCardCount("0"), 1);
    assert.equal(parseRefCardCount("-5"), 1);
    assert.equal(parseRefCardCount("100000"), MAX_REF_CARDS);
  });

  it("never returns a count a strip cannot count with", () => {
    for (const raw of [undefined, "", "  ", "plenty", "20", "0", "1e9"]) {
      const count = parseRefCardCount(raw);
      assert.ok(Number.isFinite(count) && count >= 1, `count for ${JSON.stringify(raw)}`);
    }
  });
});

describe("resolveLocationRefChoice", () => {
  // A box part-way through its `A` strip: `A147` is the card being packed, `A148` the first blank.
  const usage: LocationRefUsage = {
    refs: [
      { ref: "A146", count: 20 },
      { ref: "A147", count: 12 },
    ],
    highest: "A147",
    suggestion: "A148",
  };

  it("offers the card being packed until the collector types (#629)", () => {
    const choice = resolveLocationRefChoice(null, usage);
    assert.equal(choice.ref, "A147");
    assert.equal(choice.continuingCurrentCard, true);
    assert.equal(choice.collision, 12);
  });

  it("takes a typed ref over the suggestion, even an empty one", () => {
    assert.equal(resolveLocationRefChoice("A200", usage).ref, "A200");
    // Clearing the box is an answer: it means "no ref", not "go back to the suggestion".
    assert.equal(resolveLocationRefChoice("", usage).ref, "");
    assert.equal(resolveLocationRefChoice("", usage).collision, 0);
  });

  it("names how many copies an in-use ref already holds", () => {
    const choice = resolveLocationRefChoice("A146", usage);
    assert.equal(choice.collision, 20);
    // Not the card being packed, so this is the one that might be a typo.
    assert.equal(choice.continuingCurrentCard, false);
  });

  it("matches an in-use ref regardless of case, and trims what was typed", () => {
    const choice = resolveLocationRefChoice("  a147  ", usage);
    assert.equal(choice.trimmed, "a147");
    assert.equal(choice.collision, 12);
    assert.equal(choice.continuingCurrentCard, true);
  });

  it("finds no collision on a free ref", () => {
    assert.equal(resolveLocationRefChoice("A148", usage).collision, 0);
  });

  // Blank cards are printed for the cards *not yet* packed, so continuing `A147` prints from
  // `A148` — otherwise the default would print a fresh card carrying a ref that already has
  // stamps on it. A ref the collector typed is taken at face value.
  it("starts a printed strip one past the card being packed", () => {
    assert.equal(resolveLocationRefChoice(null, usage).printFrom, "A148");
    assert.equal(resolveLocationRefChoice("B-20", usage).printFrom, "B-20");
  });

  it("offers nothing for a location that has never been ref'd in", () => {
    const empty: LocationRefUsage = { refs: [], highest: null, suggestion: null };
    const choice = resolveLocationRefChoice(null, empty);
    assert.equal(choice.ref, "");
    assert.equal(choice.collision, 0);
    assert.equal(choice.continuingCurrentCard, false);
    assert.equal(choice.printFrom, "");
  });

  // The usage arrives over the wire, so every reading has to survive the request being in flight.
  it("reads as an empty location while the usage is still loading", () => {
    const choice = resolveLocationRefChoice(null, undefined);
    assert.equal(choice.ref, "");
    assert.equal(choice.collision, 0);
    assert.equal(choice.continuingCurrentCard, false);
  });
});
