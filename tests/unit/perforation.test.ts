import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePerforation,
  perforationMatches,
  PERFORATION_TOLERANCE,
} from "../../src/lib/perforation";

// Reading the printed forms of a perforation (#740), and comparing a measured gauge against one.
// The rule the whole module turns on is that a string it cannot read matches **nothing** — so the
// unreadable cases below matter more than the readable ones.

describe("parsePerforation", () => {
  it("reads the vulgar fractions a catalogue prints", () => {
    assert.deepEqual(parsePerforation("11½"), { kind: "gauge", horizontal: 11.5, vertical: 11.5 });
    assert.deepEqual(parsePerforation("11¼"), { kind: "gauge", horizontal: 11.25, vertical: 11.25 });
    assert.deepEqual(parsePerforation("11¾"), { kind: "gauge", horizontal: 11.75, vertical: 11.75 });
    assert.deepEqual(parsePerforation("12"), { kind: "gauge", horizontal: 12, vertical: 12 });
  });

  it("reads a fraction written out, with or without a space", () => {
    assert.deepEqual(parsePerforation("11 1/2"), {
      kind: "gauge",
      horizontal: 11.5,
      vertical: 11.5,
    });
    assert.deepEqual(parsePerforation("11 ½"), { kind: "gauge", horizontal: 11.5, vertical: 11.5 });
    assert.deepEqual(parsePerforation("23/2"), { kind: "gauge", horizontal: 11.5, vertical: 11.5 });
  });

  it("reads a decimal", () => {
    assert.deepEqual(parsePerforation("11.5"), { kind: "gauge", horizontal: 11.5, vertical: 11.5 });
    assert.deepEqual(parsePerforation(" 11.75 "), {
      kind: "gauge",
      horizontal: 11.75,
      vertical: 11.75,
    });
  });

  it("reads two axes, however they are separated", () => {
    for (const printed of ["11½:12", "11½ : 12", "11½x12", "11½ x 12", "11½×12"]) {
      assert.deepEqual(
        parsePerforation(printed),
        { kind: "gauge", horizontal: 11.5, vertical: 12 },
        printed
      );
    }
  });

  it("reads an imperforate stamp as the absence it is", () => {
    assert.deepEqual(parsePerforation("imperf"), { kind: "imperf" });
    assert.deepEqual(parsePerforation("Imperforate"), { kind: "imperf" });
    assert.deepEqual(parsePerforation("imperforated"), { kind: "imperf" });
  });

  it("reads nothing at all as nothing", () => {
    assert.equal(parsePerforation(null), null);
    assert.equal(parsePerforation(undefined), null);
    assert.equal(parsePerforation("   "), null);
  });

  // Everything the grammar deliberately does not cover. Each of these is a real thing a catalogue
  // or a collector writes; reading them is a later issue's job, and guessing at them is nobody's.
  it("refuses what it cannot read rather than guessing", () => {
    for (const printed of [
      "11½-12", // a range
      "11½ x 12 x 11½ x 12", // a four-sided compound
      "11½ (some 12)", // a note
      "perf 11½", // a label
      "roulette",
      "12,5", // a comma is a list separator as often as a decimal point
      "abc",
      "-",
    ]) {
      assert.equal(parsePerforation(printed), null, printed);
    }
  });

  // The bound that stops a year, a catalogue number or a size in millimetres from being read as a
  // gauge — the same range the measuring side calls plausible.
  it("refuses a figure outside what perforations occupy", () => {
    assert.equal(parsePerforation("1945"), null);
    assert.equal(parsePerforation("2"), null);
    assert.equal(parsePerforation("46"), null);
  });
});

describe("perforationMatches", () => {
  it("fits a reading on the stated gauge", () => {
    assert.equal(perforationMatches(11.5, "11½"), "fits");
    assert.equal(perforationMatches(11.5 + PERFORATION_TOLERANCE, "11½"), "fits");
    assert.equal(perforationMatches(11.5 - PERFORATION_TOLERANCE, "11½"), "fits");
  });

  it("does not fit a reading past the tolerance", () => {
    assert.equal(perforationMatches(12.5, "11½"), "differs");
    assert.equal(perforationMatches(11.5 + PERFORATION_TOLERANCE + 0.01, "11½"), "differs");
  });

  // The collector marked a run along *some* border and nothing records which, so either axis will
  // do — a piece gauging 12 was measured down the side of an 11½:12.
  it("accepts either axis of a two-figure perforation", () => {
    assert.equal(perforationMatches(11.5, "11½:12"), "fits");
    assert.equal(perforationMatches(12, "11½:12"), "fits");
    assert.equal(perforationMatches(13, "11½:12"), "differs");
  });

  it("rules out an imperforate stamp, which is the one thing a reading contradicts", () => {
    assert.equal(perforationMatches(11.5, "imperf"), "differs");
  });

  // The whole point: nothing to compare leaves the list exactly as it was.
  it("says nothing without a reading or without a readable stated value", () => {
    assert.equal(perforationMatches(null, "11½"), "unknown");
    assert.equal(perforationMatches(undefined, "11½"), "unknown");
    assert.equal(perforationMatches(11.5, null), "unknown");
    assert.equal(perforationMatches(11.5, ""), "unknown");
    assert.equal(perforationMatches(11.5, "11½-12"), "unknown");
    assert.equal(perforationMatches(Number.NaN, "11½"), "unknown");
  });
});
