// Reading a **printed** perforation (#71/#740) — the inverse of `scan-measure.ts`' `formatGaugeStep`,
// and the only thing in the app that turns `11½:12` back into numbers.
//
// Pure — no DOM, no React, no Prisma — for exactly the reason the measuring module is: this decides
// whether a measured stamp *could be* a catalogue entry, and a comparison written inside a component
// is a comparison nothing can test.
//
// ## Why a parser at all
//
// #598 gives a gauge, #614 counts the teeth for it, and until #72 there was nothing in the app to
// compare either against. Now a stamp states its perforation — **as printed**, because that is what
// a catalogue prints and what a collector types — so the comparison has to read the printed form.
// The forms are few and old: `11½`, `11 1/2`, `11.5`, `11½:12`, `imperf`.
//
// ## A value it cannot read matches nothing
//
// The grammar below is deliberately narrow, and everything outside it — a range (`11½-12`), a
// four-sided compound (`11½ x 12 x 11½ x 12`), a note (`11½ (some 12)`), a gauge outside what
// perforations occupy — parses to **null**, which the comparison reports as *cannot say* and which
// marks nothing. That is #598's own argument applied one step further on: a plausible wrong match in
// a measuring tool is the worst failure it can have, because it is acted on. Widening the grammar is
// cheap and safe; guessing at what a string might have meant is neither.

import { GAUGE_STEP, MAX_PLAUSIBLE_GAUGE, MIN_PLAUSIBLE_GAUGE } from "./scan-measure";

/**
 * A perforation as a catalogue states it, read into something comparable.
 *
 * Two axes always, because that is what a perforation *is* — the horizontal edges and the vertical
 * ones are gauged separately, and a single printed figure (`11½`) is the case where they agree. A
 * caller comparing one measured edge therefore has to accept either, which is what
 * {@link perforationMatches} does: the collector marked a run somewhere along the stamp's border,
 * and the tool is not told which border it was.
 */
export type Perforation =
  /** `imperf` — stated, and stated as an absence: no measured gauge can belong to it. */
  | { kind: "imperf" }
  | { kind: "gauge"; horizontal: number; vertical: number };

/**
 * How far a measured gauge may sit from a printed one and still be the same perforation:
 * **one catalogue step** ({@link GAUGE_STEP}).
 *
 * A stated constant rather than a setting, until a real scan says otherwise (#740). It is
 * deliberately wider than the half-step that would make every reading land on exactly one gauge: at
 * this width a reading of 11.6 fits `11½` *and* `11¾`, and both candidates are marked. That is the
 * honest answer — the tool proposes and never picks — and it is the failure worth having, since a
 * narrow tolerance quietly rules out the right variant on a piece measured a little short.
 */
export const PERFORATION_TOLERANCE = GAUGE_STEP;

/** The vulgar fractions a catalogue actually prints in a gauge. Quarters do nearly all the work;
 * the rest are here because reading one costs nothing and refusing it would look arbitrary. */
const FRACTIONS: Readonly<Record<string, number>> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

const FRACTION_CHARS = Object.keys(FRACTIONS).join("");

/** The words for *no perforation at all*, in the forms a catalogue and a collector write them. */
const IMPERF = /^imperf(orate(d)?)?$/;

/** What separates the two axes: Michel's colon, everyone else's `x`. A space alone does not — `11 1/2`
 * is one axis written with a space in it, and reading it as two would turn a mixed fraction into a
 * pair of gauges. */
const AXIS_SEPARATOR = /\s*[:x×*]\s*/i;

/**
 * One axis: a whole number, a mixed number (`11 1/2`, `11½`), a bare fraction, or a decimal.
 *
 * Null for anything else, **and** for a figure outside the range perforations actually occupy — the
 * same bounds the measuring side calls implausible. That second rule is what stops a year, a
 * catalogue number or a size in millimetres pasted into the field from being read as a gauge.
 */
function parseAxis(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  let gauge: number | null = null;

  const vulgar = value.match(new RegExp(`^(\\d+)?\\s*([${FRACTION_CHARS}])$`));
  if (vulgar) {
    gauge = (vulgar[1] ? Number(vulgar[1]) : 0) + FRACTIONS[vulgar[2]];
  }

  const mixed = value.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (!vulgar && mixed) {
    const denominator = Number(mixed[3]);
    if (denominator === 0) return null;
    gauge = (mixed[1] ? Number(mixed[1]) : 0) + Number(mixed[2]) / denominator;
  }

  const decimal = value.match(/^(\d+)(?:\.(\d+))?$/);
  if (!vulgar && !mixed && decimal) {
    gauge = Number(value);
  }

  if (gauge === null || !Number.isFinite(gauge)) return null;
  return gauge >= MIN_PLAUSIBLE_GAUGE && gauge <= MAX_PLAUSIBLE_GAUGE ? gauge : null;
}

/**
 * Read what a stamp states as its perforation.
 *
 * Null means *unreadable*, which the comparison treats as *cannot say* rather than as a mismatch:
 * the collector wrote something this app does not understand, which says nothing whatever about the
 * stamp under the lamp.
 */
export function parsePerforation(printed: string | null | undefined): Perforation | null {
  const value = (printed ?? "").trim();
  if (!value) return null;
  if (IMPERF.test(value.toLowerCase())) return { kind: "imperf" };

  const axes = value.split(AXIS_SEPARATOR);
  if (axes.length > 2) return null;
  const horizontal = parseAxis(axes[0]);
  if (horizontal === null) return null;
  if (axes.length === 1) return { kind: "gauge", horizontal, vertical: horizontal };
  const vertical = parseAxis(axes[1]);
  if (vertical === null) return null;
  return { kind: "gauge", horizontal, vertical };
}

/** What a measured gauge says about a stated perforation. `unknown` is the answer whenever there is
 * nothing to compare — no reading, no stated value, or one this module cannot read — and it is the
 * answer a caller must draw as *nothing at all*. */
export type PerforationMatch = "fits" | "differs" | "unknown";

/**
 * Whether a gauge measured off a piece fits what a stamp states.
 *
 * Either axis will do. The measurement is one run along one border and nothing records which border
 * it was, so a piece gauging 12 fits a stamp printed `11½:12` — it was measured down the side. A
 * catalogue's own two figures are compared the same way when one of them is all we hold.
 *
 * `imperf` **differs** from every measurement: a gauge was read off teeth, and a stamp stated to
 * have none is not this piece. That is the one case where a comparison rules a candidate out rather
 * than merely failing to endorse it, and it is the one case where the stated value genuinely
 * contradicts what was seen.
 */
export function perforationMatches(
  measured: number | null | undefined,
  printed: string | null | undefined
): PerforationMatch {
  if (measured === null || measured === undefined || !Number.isFinite(measured)) return "unknown";
  const parsed = parsePerforation(printed);
  if (!parsed) return "unknown";
  if (parsed.kind === "imperf") return "differs";
  const fits =
    Math.abs(measured - parsed.horizontal) <= PERFORATION_TOLERANCE ||
    Math.abs(measured - parsed.vertical) <= PERFORATION_TOLERANCE;
  return fits ? "fits" : "differs";
}
