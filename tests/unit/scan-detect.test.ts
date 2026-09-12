import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  detectSheetBoxesReported,
  recogniseSheetKind,
  type SheetKind,
} from "../../src/lib/scan-detect";

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
 *
 * ## Two kinds of card, and two questions per scan (#1195)
 *
 * A scan is a black **stockbook card** or a light **album page** with the stamps in mounts, and the
 * kind is a column on the sheet rather than something detection works out for itself. So each file
 * here is measured twice: the pass is run under the kind the manifest records, and
 * `recogniseSheetKind` — the guess the upload makes, and the one the collector corrects — is asked
 * to arrive at that same kind from the scan's own border. The second is the cheaper failure and
 * the likelier one: a wrong guess costs one press on the batch, while a pass run under the wrong
 * kind proposes the mounts, or the page, as stamps.
 *
 * On an album page the count alone cannot tell the two apart — thirteen mounts and thirteen stamps
 * are both thirteen — so each box is also **looked at**, by the one measurement that separates them
 * without a human: what lies **just outside** it. Around a correct box that is the black mount, and
 * each of the three ways this kind can go wrong puts something light there instead — the page, if
 * the box is the mount or carries page margin; the stamp's own white selvedge, if the box has been
 * cropped to the printed design. Measured 7–16 across the set against a page at ~225 and selvedge
 * at ~240, so the threshold sits in a gap rather than on a fitted value.
 *
 * What it does not catch is a box a little *larger* than the stamp but still inside the mount: a
 * thin black margin in the tile, with the mount on both sides of the edge. Nothing cheap separates
 * that from a correct box, and it stays an eye check — the overlays #574 established, rendered over
 * every page in this set.
 */

/** Brightest a band just outside an album-page box may read and still be the mount. Every box in
 * the set measures 7–16 there; the page reads ~225 and a stamp's selvedge ~240. A midpoint would
 * have been 120 — this sits low deliberately, because the thing being excluded is *light* and
 * leaving room above the measurement rather than below it is what keeps it a gap and not a fit. */
const MOUNT_MAX_LUM = 60;

/**
 * The luminance of a band just outside a box's own edge — the darkest question this set can ask
 * about placement, and the worst side of the box is what it answers with.
 *
 * Measured on a downscale, for the reason the pass itself works on one: which side of a boundary
 * the paper is on cannot be moved by resampling. The band is held two pixels clear of the edge so
 * that the downscale's own blur across it is not what is being read.
 */
async function justOutside(
  scan: Buffer,
  box: { x: number; y: number; w: number; h: number }
): Promise<number> {
  const { data, info } = await sharp(scan, { failOn: "error" })
    .rotate()
    .resize(EDGE_MAX_EDGE, EDGE_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const meta = await sharp(scan).rotate().metadata();
  const scale = info.width / meta.width!;
  const b = {
    x: box.x * scale,
    y: box.y * scale,
    w: box.w * scale,
    h: box.h * scale,
  };
  const band = Math.max(3, Math.round(0.02 * Math.min(b.w, b.h)));

  const medianIn = (x0: number, y0: number, x1: number, y1: number): number => {
    const values: number[] = [];
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(info.height, Math.round(y1)); y++) {
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(info.width, Math.round(x1)); x++) {
        values.push(data[y * info.width + x]);
      }
    }
    values.sort((p, q) => p - q);
    return values.length === 0 ? 0 : values[values.length >> 1];
  };

  // One band per side, and the **worst** of the four: a box is right only if every edge of it is,
  // and an average would let three good sides pay for one that has run off the mount.
  const gap = 2;
  return Math.max(
    medianIn(b.x, b.y - gap - band, b.x + b.w, b.y - gap),
    medianIn(b.x, b.y + b.h + gap, b.x + b.w, b.y + b.h + gap + band),
    medianIn(b.x - gap - band, b.y, b.x - gap, b.y + b.h),
    medianIn(b.x + b.w + gap, b.y, b.x + b.w + gap + band, b.y + b.h)
  );
}

/** Enough pixels for a band a few wide to mean something, and no more. */
const EDGE_MAX_EDGE = 2000;

const SCANS_DIR = path.join(process.cwd(), "tests", "fixtures", "scans");
const EXPECTATIONS = path.join(process.cwd(), "tests", "fixtures", "scan-expectations.json");

interface Expectation {
  pieces: number;
  note: string;
  /** What the scan is (#1195). Absent means `stockbook` — every scan taken before album pages
   * existed is one, so the omission is a fact rather than a default to be wary of. */
  kind?: SheetKind;
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
    const kind = expected.kind ?? "stockbook";
    it(`${file}: ${expected.pieces} pieces on ${kind === "album" ? "an album page" : "a stockbook card"} — ${expected.note}`, async () => {
      const scan = readFileSync(path.join(SCANS_DIR, file));

      // The guess, before the pass that is told the answer. It is what the upload records on the
      // sheet, so a set where it is never checked is a set that would go green while every scan
      // arrived labelled the wrong way round and had to be corrected by hand.
      assert.equal(
        await recogniseSheetKind(scan),
        kind,
        `${file}: recogniseSheetKind read the border as the other kind of card`
      );

      const report = await detectSheetBoxesReported(scan, kind);
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

      // Placement, on an album page: every box is the stamp, carrying neither the page nor the
      // mount, and reaching the stamp's own selvedge rather than its printed design (#1195). The
      // piece count would pass all three failures without noticing — thirteen mounts are also
      // thirteen — so this is the assertion that makes the album entries mean anything.
      if (kind === "album") {
        for (const [i, box] of report.boxes.entries()) {
          const outside = await justOutside(scan, box);
          assert.ok(
            outside <= MOUNT_MAX_LUM,
            `${file}: box ${i + 1} ${JSON.stringify(box)} has something light just outside it ` +
              `(${outside.toFixed(0)}), where the mount should be. Around ~225 is the page — the ` +
              `box is the mount, or carries page margin; around ~240 is the stamp's own selvedge — ` +
              `the box has been cropped to the printed design.`
          );
        }
      }

      // A card shows its own margin and a page shows its own border, so on both kinds a mask
      // covering nearly the whole frame means the background estimate went wrong rather than that
      // the card is full. The reference's answer to that — return the whole frame as one box — is
      // deliberately not ported: it would hand back the entire card as a single tile, which is the
      // worst outcome this step has.
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
              `    ${r.file}  ${expectations[r.file].kind ?? "stockbook"}  expected ${r.expected}, detected ${r.detected}` +
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
