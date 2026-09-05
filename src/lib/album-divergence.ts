// What a printed card no longer says (#778): the comparison between a sheet in a binder and what
// the collection would now produce for it.
//
// **Pure.** No Prisma, no rendering — the same rule as `album-layout.ts`, and unit-tested on plain
// values in `tests/unit/album-divergence.test.ts`.
//
// ## Reported, never resolved
//
// This module produces a list. It never decides anything: a card can be out of date for a good
// reason and stay that way for years, and the two answers to a divergence — a continuation page or a
// reprint — are the collector's, chosen per divergence rather than set once (#778).
//
// ## What is compared, and what deliberately is not
//
// **Facts, not coordinates.** Two sheets are compared on the stamps they carry and in what order, on
// each box's cut size and the strip it comes from, on the texts as they read, on the pictures the
// mounts print, and on the render preset the sheet is set under. Not on x and y: a position is a
// *consequence* of those, so a template margin moved by a tenth of a millimetre would otherwise
// report every box on every card as changed, and a report that exists to catch cards needing
// attention would be drowned by its own arithmetic.
//
// **Nothing that is a function of what the collector owns** — a completion count, a valuation, an
// owned/wanted marker. None of it may go onto a card in the first place (`album-snapshot.ts` says
// why), and if it did, every acquisition would register as a divergence on every page carrying it.
// That is the same failure the ranking below guards against, one layer up.
//
// ## Sheets pair by their contents, never by their names
//
// A sheet's name is its catalog range and a range is **derived from its contents**, so the moment a
// sheet changes at all its identity changes too. Pairing by identity would therefore report every
// real change as one page removed and another added — loudest exactly where it is least informative.
// So sheets pair by **greatest shared-stamp overlap**, and sheets carrying no stamps pair
// **positionally**, since nothing distinguishes them.
//
// And **a page that merely moved is not a change.** Position is not identity here either, which is
// the second dividend of the range-as-identity decision (ADR-0045 §1). Nothing below reads an index
// except to break a tie.

import type { AlbumRenderPreset } from "./album-template-rules";

/**
 * The kinds of divergence, **most serious first**. This order is the report's order.
 *
 * - `stamps` — the checklist gained or lost a slot, or the printed order changed. The card is
 *   missing something, or carries something that is gone: nothing else on this list makes a sheet
 *   wrong in that way.
 * - `size` — a box would now be a different size, or be cut from a different strip. Material: the
 *   mount on the card was cut to the old figure and a hawid cut wrong is gone.
 * - `text` — a renamed issue or area, a filled-in or corrected translation, a language change. Wrong
 *   words on a card that is otherwise right.
 * - `template` — the album's render preset has moved since the sheet was set.
 * - `photo` — a picture has arrived, changed or gone since the card was printed.
 *
 * **`photo` is last on purpose.** It is a real divergence — the card lacks an image it could now
 * have — and it will be far more common than a rename while being worth far less: one bulk scanning
 * session touches hundreds of stamps. Ranked with the others it would bury every genuine finding on
 * the first day the collector sits down with a scanner, which is precisely what this report exists
 * to avoid.
 */
export const ALBUM_DIVERGENCE_KINDS = ["stamps", "size", "text", "template", "photo"] as const;

export type AlbumDivergenceKind = (typeof ALBUM_DIVERGENCE_KINDS)[number];

/** One thing that differs between the card and what the data would now produce. */
export interface AlbumDivergence {
  kind: AlbumDivergenceKind;
  /** One sentence, in the collector's terms, naming what changed rather than which field did. */
  detail: string;
}

/** A box, reduced to what a card can be wrong about. */
export interface AlbumComparableBox {
  stampId: string;
  widthMm: number;
  heightMm: number;
  label: string;
  /** The strip it is cut from, or null for a pocket. */
  stripId: string | null;
  stripHeightMm: number | null;
  photoId: string | null;
}

/** One checklist as it reads on a sheet. */
export interface AlbumComparableBlock {
  entryId: string;
  /** Which sheet of a split checklist this is. */
  part: number;
  /** A checklist, or one of the collector's own notes (#769). Absent on a block compared from a
   *  snapshot stored before notes existed, which is the `entry` it was. It changes no comparison —
   *  only what a divergence is *called*, and "a checklist heading now reads" is the wrong sentence
   *  about a note somebody typed. */
  kind?: "entry" | "text";
  heading: string;
  boxes: AlbumComparableBox[];
}

/** A sheet reduced to what can be compared: no coordinates, and no page number. */
export interface AlbumComparablePage {
  /** The catalog range. Carried for the *message*, never for the pairing. */
  range: string;
  title: string;
  chapter: string;
  footer: string;
  /** The language the sheet is set in, as a label a collector reads. */
  language: string;
  preset: AlbumRenderPreset;
  blocks: AlbumComparableBlock[];
}

/** One printed sheet paired with what would now be produced for it, or the absence of one. */
export interface AlbumPagePair {
  /** Index into the printed sheets, or null for a sheet the current data would newly need. */
  printedIndex: number | null;
  /** Index into the reference sheets, or null for a printed card nothing would now produce. */
  referenceIndex: number | null;
  divergences: AlbumDivergence[];
}

// -- Pairing -----------------------------------------------------------------

function stampIds(page: AlbumComparablePage): string[] {
  return page.blocks.flatMap((b) => b.boxes.map((box) => box.stampId));
}

/**
 * Pair two sequences of sheets by their contents.
 *
 * Greedy on **greatest shared-stamp overlap**, ties broken by the smaller displacement and then by
 * position, so the pairing is total and deterministic. Sheets carrying no stamps at all are
 * indistinguishable by contents and pair **positionally** among what is left.
 *
 * Returns pairs in printed order, with anything the reference has and the printed side does not
 * appended after them.
 */
export function pairAlbumPages(
  printed: readonly AlbumComparablePage[],
  reference: readonly AlbumComparablePage[]
): { printedIndex: number | null; referenceIndex: number | null }[] {
  const printedStamps = printed.map((p) => new Set(stampIds(p)));
  const referenceStamps = reference.map((p) => new Set(stampIds(p)));

  const candidates: { p: number; r: number; overlap: number }[] = [];
  for (let p = 0; p < printed.length; p += 1) {
    for (let r = 0; r < reference.length; r += 1) {
      let overlap = 0;
      for (const id of printedStamps[p]) if (referenceStamps[r].has(id)) overlap += 1;
      if (overlap > 0) candidates.push({ p, r, overlap });
    }
  }
  candidates.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      Math.abs(a.p - a.r) - Math.abs(b.p - b.r) ||
      a.p - b.p ||
      a.r - b.r
  );

  const toReference = new Map<number, number>();
  const takenReference = new Set<number>();
  for (const c of candidates) {
    if (toReference.has(c.p) || takenReference.has(c.r)) continue;
    toReference.set(c.p, c.r);
    takenReference.add(c.r);
  }

  // Sheets with nothing on them cannot be told apart by contents, so what is left of them pairs in
  // the order it appears — the only fact either side still has about them.
  const looseReference = reference
    .map((_, r) => r)
    .filter((r) => !takenReference.has(r) && referenceStamps[r].size === 0);
  let loose = 0;
  for (let p = 0; p < printed.length; p += 1) {
    if (toReference.has(p) || printedStamps[p].size > 0) continue;
    if (loose >= looseReference.length) break;
    const r = looseReference[loose];
    loose += 1;
    toReference.set(p, r);
    takenReference.add(r);
  }

  const pairs: { printedIndex: number | null; referenceIndex: number | null }[] = [];
  for (let p = 0; p < printed.length; p += 1) {
    pairs.push({ printedIndex: p, referenceIndex: toReference.get(p) ?? null });
  }
  for (let r = 0; r < reference.length; r += 1) {
    if (!takenReference.has(r)) pairs.push({ printedIndex: null, referenceIndex: r });
  }
  return pairs;
}

// -- Comparing one pair ------------------------------------------------------

function countPhrase(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/**
 * A preset key as a collector reads it: `headingSpaceAboveMm` becomes "Heading space above (mm)".
 *
 * Derived rather than tabulated on purpose. A forty-entry table of labels beside a forty-column
 * preset is a second list to keep in step with the first, and `AlbumRenderPreset` exists precisely
 * so that there is only ever one.
 */
export function albumPresetFieldLabel(key: string): string {
  const unit = key.endsWith("Mm") ? " (mm)" : key.endsWith("Pt") ? " (pt)" : "";
  const stem = unit ? key.slice(0, -2) : key;
  const words = stem.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1) + unit;
}

function presetDifferences(a: AlbumRenderPreset, b: AlbumRenderPreset): string[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  return keys.filter((k) => left[k] !== right[k]);
}

function textDivergence(what: string, before: string, after: string): AlbumDivergence | null {
  if (before === after) return null;
  if (!before) return { kind: "text", detail: `${what} would now read "${after}"; the card carries none.` };
  if (!after) return { kind: "text", detail: `${what} would now be blank; the card reads "${before}".` };
  return { kind: "text", detail: `${what} would now read "${after}"; the card reads "${before}".` };
}

/** A block's heading, for a message. Falls back to the sheet's range so an untitled block is still
 *  nameable, and to a bare phrase for a sheet that has no numbers on it either. */
function blockName(block: AlbumComparableBlock | undefined, fallback: string): string {
  const heading = block?.heading.trim();
  if (heading) return `"${heading}"`;
  return fallback || "this card";
}

/**
 * Everything one printed sheet and its reference disagree about, ranked.
 *
 * Both halves appear in every message, because a collector reading this is standing in front of a
 * binder: "the heading would now read X" is only actionable beside what is actually printed.
 */
export function compareAlbumPages(
  printed: AlbumComparablePage,
  reference: AlbumComparablePage
): AlbumDivergence[] {
  const found: AlbumDivergence[] = [];

  const printedBlocks = new Map(printed.blocks.map((b) => [`${b.entryId}#${b.part}`, b]));
  const referenceBlocks = new Map(reference.blocks.map((b) => [`${b.entryId}#${b.part}`, b]));

  // -- Stamps --
  const printedOrder = stampIds(printed);
  const referenceOrder = stampIds(reference);
  const printedSet = new Set(printedOrder);
  const referenceSet = new Set(referenceOrder);
  const added = new Set(referenceOrder.filter((id) => !printedSet.has(id)));
  const removed = new Set(printedOrder.filter((id) => !referenceSet.has(id)));

  for (const block of referenceBlocks.values()) {
    const gained = block.boxes.filter((b) => added.has(b.stampId));
    if (gained.length === 0) continue;
    found.push({
      kind: "stamps",
      detail: `${blockName(block, reference.range)} has ${countPhrase(
        gained.length,
        "stamp",
        "stamps"
      )} the card does not carry.`,
    });
  }
  for (const block of printedBlocks.values()) {
    const lost = block.boxes.filter((b) => removed.has(b.stampId));
    if (lost.length === 0) continue;
    found.push({
      kind: "stamps",
      detail: `${countPhrase(lost.length, "stamp", "stamps")} on ${blockName(
        block,
        printed.range
      )} ${lost.length === 1 ? "is" : "are"} no longer in the album.`,
    });
  }
  // Order is structural too: a card whose boxes read in a different order is a different card, even
  // when it holds exactly the same stamps.
  if (
    added.size === 0 &&
    removed.size === 0 &&
    printedOrder.join(" ") !== referenceOrder.join(" ")
  ) {
    found.push({
      kind: "stamps",
      detail: "The same stamps would now be printed in a different order.",
    });
  }

  // -- Sizes, strips, labels and pictures, over the stamps both sides carry --
  const printedBoxes = new Map(
    printed.blocks.flatMap((b) => b.boxes.map((x) => [x.stampId, x] as const))
  );
  const referenceBoxes = new Map(
    reference.blocks.flatMap((b) => b.boxes.map((x) => [x.stampId, x] as const))
  );
  let resized = 0;
  let restripped = 0;
  let relabelled = 0;
  let photoAdded = 0;
  let photoChanged = 0;
  let photoLost = 0;
  for (const [stampId, was] of printedBoxes) {
    const now = referenceBoxes.get(stampId);
    if (!now) continue;
    if (was.widthMm !== now.widthMm || was.heightMm !== now.heightMm) resized += 1;
    else if (was.stripId !== now.stripId || was.stripHeightMm !== now.stripHeightMm) restripped += 1;
    if (was.label !== now.label) relabelled += 1;
    if (was.photoId !== now.photoId) {
      if (!was.photoId) photoAdded += 1;
      else if (!now.photoId) photoLost += 1;
      else photoChanged += 1;
    }
  }
  if (resized > 0) {
    found.push({
      kind: "size",
      detail: `${countPhrase(resized, "box", "boxes")} would now be cut to a different size.`,
    });
  }
  if (restripped > 0) {
    found.push({
      kind: "size",
      detail: `${countPhrase(restripped, "box", "boxes")} would now come from a different strip.`,
    });
  }

  // -- Texts --
  //
  // The footer is only reported when the stamps have **not** changed. It names the sheet's own
  // catalog range, so a checklist that gained a stamp changes it by arithmetic — and a report that
  // said "1 stamp the card does not carry" and then "the footer would now read PL 303-305" for every
  // single addition would be saying one thing twice, on the most common divergence there is. Same
  // principle as leaving coordinates out: a consequence of a fact already stated is not a second
  // fact.
  const structural = found.length > 0;
  for (const d of [
    textDivergence("The running head", printed.title, reference.title),
    textDivergence("The year heading", printed.chapter, reference.chapter),
    structural ? null : textDivergence("The footer", printed.footer, reference.footer),
  ]) {
    if (d) found.push(d);
  }
  for (const [key, block] of printedBlocks) {
    const now = referenceBlocks.get(key);
    if (!now) {
      // A **note** the card carries that the album no longer produces. Only for a note, and only for
      // one with no boxes: a checklist that has left the card is already said, loudly, by the stamps
      // above and by the orphan rule. Without this the one thing that can vanish without a trace is
      // the collector's own words — the card would go on carrying a sentence nothing in the album
      // accounts for, and no read would say so.
      if (block.kind === "text" && block.boxes.length === 0) {
        found.push({
          kind: "text",
          detail: `The card carries a note the album no longer has: "${block.heading}".`,
        });
      }
      continue;
    }
    const d = textDivergence(
      block.kind === "text" ? "A note" : "A checklist heading",
      block.heading,
      now.heading
    );
    if (d) found.push(d);
  }
  if (relabelled > 0) {
    found.push({
      kind: "text",
      detail: `${countPhrase(relabelled, "box label reads", "box labels read")} differently now.`,
    });
  }
  if (printed.language !== reference.language) {
    found.push({
      kind: "text",
      detail: `The card was printed in ${printed.language}; the album is now printed in ${reference.language}.`,
    });
  }

  // -- Template --
  const preset = presetDifferences(printed.preset, reference.preset);
  if (preset.length > 0) {
    const named = preset.slice(0, 3).map(albumPresetFieldLabel).join(", ");
    found.push({
      kind: "template",
      detail:
        preset.length <= 3
          ? `The album's ${named} ${preset.length === 1 ? "has" : "have"} changed since this card was set.`
          : `${named} and ${preset.length - 3} other template values have changed since this card was set.`,
    });
  }

  // -- Pictures, last --
  if (photoAdded > 0) {
    found.push({
      kind: "photo",
      detail: `${countPhrase(photoAdded, "stamp", "stamps")} now ${
        photoAdded === 1 ? "has a picture" : "have pictures"
      } the card prints an empty mount for.`,
    });
  }
  if (photoChanged > 0) {
    found.push({
      kind: "photo",
      detail: `${countPhrase(photoChanged, "mount", "mounts")} would now print a different picture.`,
    });
  }
  if (photoLost > 0) {
    found.push({
      kind: "photo",
      detail: `${countPhrase(photoLost, "picture", "pictures")} on the card no longer ${
        photoLost === 1 ? "exists" : "exist"
      }.`,
    });
  }

  return rankAlbumDivergences(found);
}

/** Most serious first, stable within a kind. */
export function rankAlbumDivergences(found: readonly AlbumDivergence[]): AlbumDivergence[] {
  return [...found].sort(
    (a, b) => ALBUM_DIVERGENCE_KINDS.indexOf(a.kind) - ALBUM_DIVERGENCE_KINDS.indexOf(b.kind)
  );
}

/**
 * Compare the sheets of one printed card against what the current data would produce for it.
 *
 * The pairing is by contents (see {@link pairAlbumPages}), so **a page that merely moved reports
 * nothing at all**. A reference sheet nothing printed pairs with is content that no longer fits onto
 * the cards that exist — the state a **continuation page** answers — and a printed sheet nothing
 * pairs with is a card whose stamps have all left the album.
 */
export function diffAlbumPlans(
  printed: readonly AlbumComparablePage[],
  reference: readonly AlbumComparablePage[]
): AlbumPagePair[] {
  return pairAlbumPages(printed, reference).map((pair) => {
    if (pair.printedIndex === null && pair.referenceIndex !== null) {
      const extra = reference[pair.referenceIndex];
      return {
        ...pair,
        divergences: [
          {
            kind: "stamps" as const,
            detail: `There is now more than these cards hold: ${countPhrase(
              stampIds(extra).length,
              "stamp has",
              "stamps have"
            )} nowhere to go.`,
          },
        ],
      };
    }
    if (pair.referenceIndex === null && pair.printedIndex !== null) {
      const gone = printed[pair.printedIndex];
      return {
        ...pair,
        divergences: [
          {
            kind: "stamps" as const,
            detail: `Nothing in the album corresponds to this card any more — its ${countPhrase(
              stampIds(gone).length,
              "stamp is",
              "stamps are"
            )} gone from it.`,
          },
        ],
      };
    }
    return {
      ...pair,
      divergences: compareAlbumPages(printed[pair.printedIndex!], reference[pair.referenceIndex!]),
    };
  });
}
