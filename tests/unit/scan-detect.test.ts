import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { detectSheetBoxesReported } from "../../src/lib/scan-detect";

/**
 * The detection regression set (#574, ADR-0033).
 *
 * Real card scans live in `tests/fixtures/scans/`, which is **gitignored** — they are hundreds of
 * megabytes of JPEG and have no business in the repository. `scan-expectations.json` beside it is
 * committed and records, per file, how many **physical pieces** the card holds and what case it
 * covers. With the folder absent this whole file skips, so CI stays green without carrying the
 * binaries; with it present, every constant in `scan-detect.ts` is answerable to it.
 *
 * **Re-run it after every parameter change.** In the reference implementation a change to the
 * background estimator silently altered the result on 558 of 1,429 photos and only a fixed set of
 * real scans caught it — no synthetic image would have.
 *
 * ## What is measured, and what a count can and cannot say
 *
 * `pieces` counts pieces, not stamps: a pair, a block or a se-tenant strip is **one**, because
 * perforation joins them and detection must not try to separate them. The error figure below is
 * `|detected − expected|` summed over the set, against the total number of pieces — the number of
 * boxes that need a hand in the editor, which is the figure that says whether this is a tool or a
 * chore.
 *
 * A count is a lower bound and it is stated as one: two errors that cancel (one piece split while
 * two are merged) read as zero here. Placement was verified separately, by rendering the proposed
 * boxes over each card and looking at them. What that eye check cannot catch is a box clipping
 * perforation by a few pixels — which is exactly the failure #579's zoom exists to make visible in
 * the editor, and why detection proposes rather than decides.
 */

const SCANS_DIR = path.join(process.cwd(), "tests", "fixtures", "scans");
const EXPECTATIONS = path.join(process.cwd(), "tests", "fixtures", "scan-expectations.json");

interface Expectation {
  pieces: number;
  note: string;
  /** Boxes this card is measured to come out by, with {@link allowReason} naming which documented
   * limit it is. A named shortfall, never a silently widened tolerance: a card without one must
   * come out exactly. */
  allow?: number;
  allowReason?: string;
}

const manifest = JSON.parse(readFileSync(EXPECTATIONS, "utf8")) as Record<string, unknown>;

const expectations: Record<string, Expectation> = Object.fromEntries(
  Object.entries(manifest).filter(([key]) => !key.startsWith("_"))
) as Record<string, Expectation>;

/** The cases this set does not hold, read from the manifest rather than restated here so there is
 * one place to add to when a card is added. Printed by the run, because a gap recorded is a gap and
 * a gap unmentioned reads as coverage. */
const GAPS = (manifest._gaps as string[]) ?? [];

const present = existsSync(SCANS_DIR)
  ? readdirSync(SCANS_DIR).filter((f) => f in expectations)
  : [];

describe("scan detection against real card scans", { skip: present.length === 0 && "no scans in tests/fixtures/scans — see its README" }, () => {
  const found: { file: string; detected: number; expected: number }[] = [];

  for (const file of present.sort()) {
    const expected = expectations[file];
    it(`${file}: ${expected.pieces} pieces — ${expected.note}`, async () => {
      const report = await detectSheetBoxesReported(readFileSync(path.join(SCANS_DIR, file)));
      found.push({ file, detected: report.boxes.length, expected: expected.pieces });

      const off = Math.abs(report.boxes.length - expected.pieces);
      assert.ok(
        off <= (expected.allow ?? 0),
        `${file}: detected ${report.boxes.length}, expected ${expected.pieces}` +
          `${expected.allow ? ` ±${expected.allow}` : ""}. ` +
          `mask coverage ${(report.maskCoverage * 100).toFixed(1)}%, threshold ${report.threshold}, ` +
          `${report.backgrounds.length} background cluster(s), ` +
          `dropped ${report.droppedSmall} small and ${report.droppedContained} contained.`
      );

      // The card is mostly black in every scan this routine produces. A mask covering nearly the
      // whole frame means the background estimate went wrong, and the reference's answer to that
      // — return the whole frame as one box — is deliberately not ported: on a card it would hand
      // back the entire card as a single tile, which is the worst outcome this step has.
      assert.ok(
        report.maskCoverage < 0.9,
        `${file}: mask covered ${(report.maskCoverage * 100).toFixed(1)}% of the frame — the ` +
          `background estimate has failed, not the card that is full`
      );
    });
  }

  it("reports the error rate the constants were fitted to", () => {
    const pieces = found.reduce((n, r) => n + r.expected, 0);
    const hands = found.reduce((n, r) => n + Math.abs(r.detected - r.expected), 0);
    console.log(
      `\n  ${found.length} cards, ${pieces} pieces: ${hands} needed a hand ` +
        `(${((hands / pieces) * 100).toFixed(1)}%).\n` +
        found
          .map(
            (r) =>
              `    ${r.file}  expected ${r.expected}, detected ${r.detected}` +
              (r.detected === r.expected ? "" : `  — ${expectations[r.file].allowReason ?? "?"}`)
          )
          .join("\n") +
        "\n\n  Named gaps — cases this set does not cover, recorded rather than implied:\n" +
        GAPS.map((g) => `    · ${g}`).join("\n") +
        "\n"
    );
    // A budget, not a target. The constants were fitted at 1.7% (2 of 120) and this leaves room for
    // one card of the set to be replaced by a harder one without a red build — but a change that
    // pushes past it has made detection worse, whatever else it improved.
    assert.ok(hands / pieces <= 0.03, `error rate ${((hands / pieces) * 100).toFixed(1)}% > 3%`);
  });
});
