// The album page plan (#767): how an album's checklists fall onto sheets of paper.
//
// **Pure millimetre geometry.** No Prisma, no PDF library, no React — exactly as `collage-layout.ts`
// is pure of `sharp`, and for a sharper reason than that module had. Two surfaces render this plan:
// the PDF (#768) and the editor canvas (#769). Any arithmetic that ends up in either of them is
// arithmetic the other one can get wrong, and the failure mode is a screen that disagrees with the
// paper about where a block broke. So the split is not "so it can be unit-tested" — it is that there
// is exactly one place the geometry happens, and neither renderer is it.
//
// ## What a plan is made of
//
// - A **box** is one checklist slot: a piece of hawid sized by `hawid.ts` (#765) over a stamp size
//   resolved by `stamp-size.ts` (#763), plus the label the album's template renders for it. Every
//   slot gets one whether or not a copy is owned, which is what makes a page a want list too (#755).
// - A **block** is one checklist: its heading, then its boxes laid left to right and wrapped, rows
//   as tall as their tallest box. It is the unit that moves — a block that does not fit moves
//   **whole**, and only a block taller than a whole page is ever split.
// - A **band** is a horizontal slice of the page holding one block, or two or three side by side
//   when they are narrow enough and the template allows it. See {@link measureBand}: this is not a
//   page divided into columns, and the difference matters — see the note there.
// - A **chapter** is one year (#755). Its heading is printed once, at the head of the chapter, and a
//   chapter **starts a page**.
//
// The last two are not invented. Both are read off the collector's own ~140 hand-written AlbumEasy
// pages: every `PL-19xx.txt` carries exactly one `HEADER 24 "<year>"` however many `PAGE_START(` it
// holds, and each year opens a fresh page. The running head and the footer come from the same place
// — `PAGE_START_GROUP` prints the album's name at the top of every sheet and
// `PAGE_TEXT_CENTER(FOOTER 8 "PL $$1")` at the foot of it.
//
// ## Why the plan depends on the album's language
//
// Because headings wrap, and where a heading stops fitting decides where a block stops fitting.
// AlbumEasy never had to answer this — it does not wrap at all, and the collector types a literal
// `\n` into a long heading (`"1950, 16 XII. Odbudowa Warszawy\n(do uiszczenia…)."`). We render
// headings from templates in the album's own language (#755), so the wrapping is ours, and the same
// album in two languages does not break onto pages the same way. That is exactly why the language
// sits on the album and not on the render.
//
// ## A block's height does not change when it moves
//
// Every block carries its own lead — the space above its heading, or the row gap when it has no
// heading — so its height is the same wherever it lands. Collapsing that lead at the top of a page
// would look tidier and would make "does not fit, so move it whole" ill-defined: a block that did not
// fit would shrink on the way to the next page and might then have fitted where it was. A plan that
// can oscillate is a plan two renderers can disagree about.
//
// ## Measuring text
//
// See {@link AlbumTextMetrics}. The engine takes a measurer rather than owning one, because the glyph
// advances belong to the faces the PDF embeds (#768).
//
// The obligation that comes with the port is stronger than "there should be one implementation": the
// **client is not allowed to measure at all, because the client is not a planner.** #769's canvas
// draws a plan computed here, on the server, and its corrections are deltas — *this box 2 mm wider*,
// *5 mm more before this block*, *break here*. Dragging shows a geometric offset applied to an
// already-computed plan; the re-plan happens server-side when the drag is released. So the browser's
// own `measureText` never enters the picture, and there is nothing for it to disagree with.
//
// ## The collector's corrections are inputs to this module, not a second pass over its output
//
// #769 lets the collector overrule the packing: extra space before or after a block, a forced break
// and a forced *no* break, a text block of their own, a box a couple of millimetres bigger. Every one
// of them arrives on the specs this function is given and is packed **with** the automatic layout
// rather than applied to the plan afterwards. That is what makes a correction survive a content
// change: adding a stamp re-flows the page and the deltas are still the deltas.
//
// The space corrections were counted before they were built. His own six areas hold **480**
// `PAGE_VSPACE` over **198** `PAGE_START(` pages — by a long way the most-made hand correction in the
// corpus, and the reason it is first in the list. **Every negative one of them (18) is in a `_*.txt`
// running-head include**, building the head `printTitle` already models; there is not one in page
// content. So {@link AlbumBlockSpec.spaceBeforeMm} may be negative but floors the block's lead at
// zero: closing a gap is something he does, overlapping two blocks is not.
//
// The forced break has no analogue in the sources to count — AlbumEasy paginates by hand, so his 198
// `PAGE_START(` *are* the breaks and there is no `PAGE_BREAK` anywhere. It is ours.

import type { AlbumRenderPreset } from "./album-template-rules";
import { roundSizeMm } from "./stamp-size";

/**
 * How text is measured. The engine never measures anything itself — it asks.
 *
 * **One implementation, shared by both renderers.** The PDF (#768) draws with embedded faces whose
 * advances are the truth; the editor canvas (#769) must ask the same object rather than the browser,
 * or the screen and the paper will break blocks in different places.
 *
 * Millimetres out, points in: `sizePt` is the unit a template states type in and a PDF is drawn in
 * (#766), millimetres are what the page is measured in, and the conversion happens once, in here.
 */
export interface AlbumTextMetrics {
  /** The advance width of `text` set in `faceId` at `sizePt`, in millimetres. */
  measureMm(text: string, faceId: string, sizePt: number): number;
  /** Baseline to baseline for that face at that size, in millimetres — what a wrapped line costs. */
  lineHeightMm(faceId: string, sizePt: number): number;
}

/** The five roles a template sets type for (#766), as this module names them. */
export type AlbumTextRole =
  "title" | "chapter" | "heading" | "label" | "footer";

/** The face and size a role is set in. One lookup, so the packing code never reaches for a
 *  differently-named pair of columns per role. */
export function albumRoleFace(
  preset: AlbumRenderPreset,
  role: AlbumTextRole,
): { face: string; sizePt: number } {
  switch (role) {
    case "title":
      return { face: preset.titleFace, sizePt: preset.titleSizePt };
    case "chapter":
      return { face: preset.chapterFace, sizePt: preset.chapterSizePt };
    case "heading":
      return { face: preset.headingFace, sizePt: preset.headingSizePt };
    case "label":
      return { face: preset.labelFace, sizePt: preset.labelSizePt };
    case "footer":
      return { face: preset.footerFace, sizePt: preset.footerSizePt };
  }
}

/**
 * Greedy word wrap at `widthMm`, breaking on whitespace only.
 *
 * A word wider than the line gets a line of its own and overhangs rather than being broken:
 * hyphenation is language-specific, an album is printed in one language of its own choosing (#755),
 * and a wrong hyphen goes onto a card that is then glued into a binder. An overhang is visible and
 * fixable; a wrong break is neither.
 *
 * Returns an empty list for text that is blank once collapsed — a blank template is a real value
 * (#766), and a role with nothing to say reserves nothing.
 */
export function wrapAlbumText(
  text: string,
  widthMm: number,
  face: string,
  sizePt: number,
  metrics: AlbumTextMetrics,
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || metrics.measureMm(candidate, face, sizePt) <= widthMm) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  lines.push(line);
  return lines;
}

/**
 * The heading a continuation sheet prints: the block's own heading with its part number after it.
 *
 * The collector's convention, one step on. `PL-1948.txt` repeats the whole checklist heading on the
 * continuation page with `(cd.)` appended, six times over; the album numbers it instead — `[2]`,
 * `[3]` — because `(cd.)` cannot say *which* continuation, and that starts to matter as soon as a
 * checklist runs to three or four cards on a desk. The first sheet of a block carries no mark.
 * Decided with the collector.
 *
 * **It lives here, in the plan, rather than in a renderer.** The module that decides a block
 * continues is the module that must measure what that page will actually print: a marker appended
 * at drawing time would put ink outside the width the layout reserved, and precisely where headings
 * are longest, since a heading that fills its block is the one most likely to be continued. So page
 * one charges the unmarked heading and pages two onward charge the marked one, each measured when
 * its page is made. Nothing is circular — the decision to split at all is taken before any marker
 * exists.
 *
 * Bracketed digits also settle a question a word would have opened: an album is printed in its own
 * language (#755), so `(cd.)` would have needed either a table of canned strings — the first in this
 * codebase — or a fifth template field. A number needs neither.
 */
export function albumContinuationHeading(
  heading: string,
  part: number,
): string {
  if (part < 2 || !heading.trim()) return heading;
  return `${heading} [${part}]`;
}

/** A rectangle in page millimetres, origin at the **top-left of the sheet**, `y` growing downward —
 *  the direction a page is read and laid out in. A PDF's own origin is bottom-left, and flipping it
 *  is the renderer's one line of conversion rather than a second convention in here. */
export interface AlbumRect {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

/** A run of text placed on the page: the band it occupies and the lines it wrapped to, which the
 *  renderer centres within `widthMm`. The lines are given rather than the raw string precisely so
 *  that the renderer does not re-wrap and reach a different answer. */
export interface AlbumPlacedText extends AlbumRect {
  role: AlbumTextRole;
  lines: string[];
}

/** The minimum a box states to be placed: its cut size and the label under it. Callers pass their
 *  own richer row — the strip it came from, the stamp it is for, whether the size was inherited —
 *  and get that same row back on the placement, `planHawidBox`'s idiom. */
export interface AlbumBoxSpec {
  widthMm: number;
  heightMm: number;
  /** The rendered box label. Blank prints nothing and reserves nothing. */
  label: string;
}

/**
 * Where a page may break relative to a block (#769).
 *
 * `auto` is the packer's own answer and is what every block starts at. The other two are the
 * collector overruling it, and they are not symmetric: `always` is a statement this module can
 * always honour, while `avoid` is a *preference* — a run of them longer than a sheet cannot be kept
 * together on any page, and the packer then gives up on the run rather than looping.
 *
 * There is nothing in the AlbumEasy sources to measure this against: that program paginates by hand,
 * so the collector's 198 `PAGE_START(` are themselves the breaks and there is no `PAGE_BREAK`
 * directive in the corpus at all. This pair is an invention, and #755 is where it was asked for.
 */
export type AlbumBlockBreak = "auto" | "always" | "avoid";

/**
 * What kind of block this is (#769).
 *
 * `entry` is a checklist and is everything the plan produced before the editor existed; `text` is a
 * block of the collector's own words, set in one of the template's roles and carrying no boxes.
 *
 * Optional, and read as `entry` when absent, so a snapshot stored before text blocks existed reads
 * back as what it is rather than being refused by version (`album-snapshot.ts`).
 */
export type AlbumBlockKind = "entry" | "text";

/** One block to place: a checklist's heading and its boxes, in the order the album prints them. */
export interface AlbumBlockSpec<T extends AlbumBoxSpec = AlbumBoxSpec> {
  /** The album entry this block is, carried through so a placement joins back to its rows. For a
   *  `text` block it is that block's own id — the caller's handle on the row, either way. */
  entryId: string;
  /** The rendered checklist heading, already in the album's language. Blank reserves nothing. */
  heading: string;
  boxes: readonly T[];
  /** A checklist, or a block of the collector's own text (#769). Absent means `entry`. */
  kind?: AlbumBlockKind;
  /** Which of the template's roles this block's text is set in. Absent means `heading`, which is
   *  what a checklist is. A **text block** names another of them, which is the whole of what "from
   *  the template's text roles" (#769) buys: the collector picks the voice the note is printed in
   *  rather than the album growing a sixth type setting nothing else uses. */
  role?: AlbumTextRole;
  /** Extra space the collector has asked for **before** this block, in millimetres (#769).
   *
   *  Part of the block's own lead, so — like the lead — it does not change when the block moves, and
   *  "does not fit, so move it whole" stays well-defined. May be negative to close a gap the
   *  automatic lead opened, but the lead itself floors at zero: his 480 content `PAGE_VSPACE` are
   *  every one of them positive, and two blocks printed over one another is not a correction anyone
   *  asked for. */
  spaceBeforeMm?: number;
  /** Extra space **after** this block. Charged on the block's last sheet only, so splitting one
   *  across three cards does not spend it three times. */
  spaceAfterMm?: number;
  /** Whether the collector has forced, or forbidden, a page break above this block (#769). */
  breakBefore?: AlbumBlockBreak;
  /** The printed sheets this block is already on (#778), in printing order, or null while it is
   *  live. A block naming any is **not planned**: the sheets exist and the plan steps over them.
   *
   *  A **list**, because a checklist too tall for a page is split across two or three sheets and
   *  every one of them is in the binder — index `n` is the sheet carrying `part` `n + 1`. Ordinarily
   *  it holds one id. It is never partly filled: a block is printed across all of its sheets or
   *  across none, since half a checklist on paper and half in the live plan is not a state anything
   *  could draw. */
  printedPageIds?: readonly string[] | null;
}

/** One chapter — a year group (#755). Its heading prints once, and it starts a page. */
export interface AlbumChapterSpec<T extends AlbumBoxSpec = AlbumBoxSpec> {
  /** Stable identity of the year group, carried through to every page it produces. */
  key: string;
  /** The rendered chapter heading. Blank reserves nothing but still starts a page. */
  heading: string;
  blocks: readonly AlbumBlockSpec<T>[];
}

/** A box as the plan places it. `box` is the caller's own row, handed straight back. */
export interface AlbumPlacedBox<
  T extends AlbumBoxSpec = AlbumBoxSpec,
> extends AlbumRect {
  box: T;
  /** The album entry the box belongs to, so a placement is attributable without a second lookup. */
  entryId: string;
  /** The label band, above or below per the template, or null when there is no label to print. */
  label: AlbumPlacedText | null;
}

/** What a page says about a block that landed on it. */
export interface AlbumPlacedBlock {
  entryId: string;
  /** A checklist, or a block of the collector's own text (#769). Absent on a placement stored before
   *  text blocks existed, which is exactly the `entry` it was. */
  kind?: AlbumBlockKind;
  /** Which sheet of this block this page is: **1** for an ordinary block, which moves whole, and
   *  2, 3, … for the tails of one too tall for a column and therefore split.
   *
   *  A number rather than a `continued` flag because the collector's own convention needs the
   *  ordinal: a continuation heading is repeated with `[2]`, `[3]` appended (#768), so the second
   *  and third sheets of one checklist can be told apart on a desk. *How* it is marked is the
   *  renderer's question; *which part this is* is the plan's answer, and both renderers have to
   *  agree on it. */
  part: number;
  /** The heading **this sheet printed for this block** — the block's own on its first sheet, the one
   *  marked `[2]`, `[3]` on the sheets after that, and blank for a block with no heading.
   *
   *  The string the plan measured, not the block's raw heading: those differ on a continuation, and a
   *  surface that reads the raw one would say a card carries a heading it does not. `headings` on the
   *  page is the *placed* text and holds nothing for a blank heading, so it cannot be indexed by
   *  block — this is the per-block answer. */
  heading: string;
  /** Index of the block's first box on this page, into the block's own box list. */
  firstBoxIndex: number;
  boxCount: number;
  /** True when this block asked **not** to be separated from what is above it (#769) and the packer
   *  could not grant it — it opens a sheet, so what it wanted to stay with is on the one before.
   *
   *  Reported rather than resolved, and that is the whole reason the flag exists: `avoid` is a
   *  preference, a run of them taller than a sheet has no arrangement that satisfies it, and a
   *  constraint dropped **silently** here is one the collector discovers with the card in his hand.
   *  A chapter's first block is included on purpose: a chapter starts a sheet, so an `avoid` there is
   *  a request nothing could ever grant, and saying so is better than a setting that quietly does
   *  nothing. A continuation sheet of a split block is not — nothing was separated that anybody asked
   *  to keep together. */
  separated?: boolean;
}

/** A page of the plan.
 *
 *  Two kinds, and the difference is the whole of #778's rule: a **live** page is a derivation and is
 *  re-planned whenever anything it reads changes; a **printed** page is a sheet in a binder, and the
 *  plan does not touch it — it steps over it and resumes on fresh paper. */
export type AlbumPlannedPage<T extends AlbumBoxSpec = AlbumBoxSpec> =
  | {
      kind: "printed";
      printedPageId: string;
      /** The chapter the sheet sits in, so the sequence still reads as chapters. */
      chapterKey: string;
      /** The entries the sheet holds, for the caller's own bookkeeping. */
      entryIds: string[];
    }
  | {
      kind: "live";
      chapterKey: string;
      /** The running head — the album's own name, on every page, as the collector's own pages carry
       *  it. Null when the album's name is blank, which nothing else allows. */
      title: AlbumPlacedText | null;
      /** The chapter heading, on the chapter's first page only. */
      chapter: AlbumPlacedText | null;
      /** Checklist headings placed on this page, in reading order. */
      headings: AlbumPlacedText[];
      boxes: AlbumPlacedBox<T>[];
      blocks: AlbumPlacedBlock[];
      /** The band reserved for the footer, **without its text**. A footer names the page's own
       *  catalog range (`{pageRange}`, #766), and the range is a function of the boxes above — which
       *  are not known until the page is closed. The caller renders the text into this rectangle.
       *  Null when the template prints no footer. */
      footer: AlbumRect | null;
      /** The area the blocks were packed into, so a renderer can draw a rule or a debug frame without
       *  re-deriving it. On a chapter's first page it starts below the chapter heading. */
      content: AlbumRect;
    };

/** A whole album's plan. Pages in printing order, and there is deliberately **no page number**
 *  anywhere in this type: a page's identity is its catalog range (#755), a number is a position, and
 *  the only ordering the plan states is the order of this array. */
export interface AlbumPlan<T extends AlbumBoxSpec = AlbumBoxSpec> {
  pages: AlbumPlannedPage<T>[];
}

/** Millimetres are rounded to a tenth before every comparison (`hawid.ts`'s rule), so a fit test
 *  wants a tolerance below that tenth rather than an exact `<=` on binary floats. */
const FIT_EPSILON = 1e-6;

/** The parts of a sheet that are the same on every page: the running head, the footer band, and the
 *  content rectangle left between them. */
interface PageFrame {
  title: AlbumPlacedText | null;
  footer: AlbumRect | null;
  contentX: number;
  contentW: number;
  contentTop: number;
  contentBottom: number;
}

/**
 * The printable area of one sheet, after the running head and the footer have taken theirs.
 *
 * Both bands come off **every** page, not only the ones that use them, because a page's content
 * height has to be the same on every page or whether a block fits would depend on which page it was
 * being tried on.
 *
 * The footer is deliberately **one line and never wrapped**. Its text names the page's own catalog
 * range, so a footer allowed to wrap would make the height of the content depend on the content: the
 * plan would be solving for its own output. The title may wrap — it is the album's name and knows
 * nothing about the page.
 */
function pageFrame(
  preset: AlbumRenderPreset,
  albumTitle: string,
  metrics: AlbumTextMetrics,
): PageFrame {
  const contentX = preset.marginLeftMm;
  const contentW =
    preset.pageWidthMm - preset.marginLeftMm - preset.marginRightMm;

  const titleFace = albumRoleFace(preset, "title");
  // A template that prints no running head gets those millimetres back for content — DA's pages
  // start at 30 mm where PL's start at 20, and the difference is exactly this band.
  const titleLines = preset.printTitle
    ? wrapAlbumText(
        albumTitle,
        contentW,
        titleFace.face,
        titleFace.sizePt,
        metrics,
      )
    : [];
  const titleHeight = roundSizeMm(
    titleLines.length * metrics.lineHeightMm(titleFace.face, titleFace.sizePt),
  );

  const footerFace = albumRoleFace(preset, "footer");
  const footerHeight = preset.footerTemplate.trim()
    ? roundSizeMm(metrics.lineHeightMm(footerFace.face, footerFace.sizePt))
    : 0;

  const contentTop = roundSizeMm(preset.marginTopMm + titleHeight);
  const contentBottom = roundSizeMm(
    preset.pageHeightMm - preset.marginBottomMm - footerHeight,
  );

  return {
    contentX,
    contentW,
    contentTop,
    contentBottom,
    title: titleLines.length
      ? {
          role: "title",
          lines: titleLines,
          xMm: contentX,
          yMm: preset.marginTopMm,
          widthMm: contentW,
          heightMm: titleHeight,
        }
      : null,
    footer: footerHeight
      ? {
          xMm: contentX,
          yMm: contentBottom,
          widthMm: contentW,
          heightMm: footerHeight,
        }
      : null,
  };
}

/** The area blocks are packed into on one page, starting `offsetMm` below the content top — which is
 *  how a chapter's first page keeps its blocks clear of the year heading. */
function pageContent(frame: PageFrame, offsetMm: number): AlbumRect {
  const yMm = roundSizeMm(frame.contentTop + offsetMm);
  return {
    xMm: frame.contentX,
    yMm,
    widthMm: frame.contentW,
    heightMm: roundSizeMm(frame.contentBottom - yMm),
  };
}

/** One row of boxes inside a block, already measured. */
interface MeasuredRow<T extends AlbumBoxSpec> {
  boxes: { box: T; labelLines: string[] }[];
  /** The tallest mount in the row — the band the mounts are centred in (`ROW_ALIGN_MIDDLE`). */
  boxHeightMm: number;
  /** The tallest label in the row, so every label in a row shares one baseline. */
  labelHeightMm: number;
  widthMm: number;
  heightMm: number;
}

/** A heading measured against a width: the lines it wrapped to and what they cost with the space
 *  below them. Its own type because a **continued** block measures a second one — the same heading
 *  with its part number appended — for every sheet after the first. */
interface MeasuredHeading {
  lines: string[];
  /** What the heading costs including the space below it — 0 when there is no heading. */
  costMm: number;
}

/** A block measured against a width. */
interface MeasuredBlock<T extends AlbumBoxSpec> {
  spec: AlbumBlockSpec<T>;
  /** The heading as the block's **first** sheet prints it, unmarked. */
  heading: MeasuredHeading;
  /** The space separating this block from whatever is above it, whether or not it has a heading,
   *  plus the collector's own correction (#769). Part of the block, so its height never changes when
   *  it moves. */
  leadMm: number;
  /** The collector's extra space **after** the block, charged on its last sheet only. */
  trailingMm: number;
  rows: MeasuredRow<T>[];
  /** The total this block occupies: its lead, its heading, all of its rows and its trailing space. */
  heightMm: number;
}

/**
 * The width a block would take if nothing constrained it — its boxes on one line.
 *
 * This is what decides whether two blocks may share a band, and it reads only the boxes: a heading
 * always wraps and so constrains nothing, while a one-stamp checklist is genuinely narrow and is
 * exactly the case the collector pairs.
 */
function naturalBlockWidthMm(block: AlbumBlockSpec, gapXMm: number): number {
  if (block.boxes.length === 0) return 0;
  const boxes = block.boxes.reduce((sum, box) => sum + box.widthMm, 0);
  return roundSizeMm(boxes + gapXMm * (block.boxes.length - 1));
}

/**
 * Lay a block's boxes into rows at `widthMm` and measure its heading against the same width.
 *
 * Row packing is `collage-layout.ts`'s, in millimetres instead of pixels and for the same reason: a
 * row is as tall as its tallest mount and the shorter mounts are centred in it, so a definitive next
 * to a souvenir sheet is not stretched to match it.
 *
 * A label wraps to **its own box's width**, and a row's label band is as tall as the tallest label in
 * the row, so one row's labels sit on one baseline however wide their boxes are.
 */
function measureHeading(
  text: string,
  widthMm: number,
  preset: AlbumRenderPreset,
  metrics: AlbumTextMetrics,
  role: AlbumTextRole = "heading",
): MeasuredHeading {
  const face = albumRoleFace(preset, role);
  const lines = wrapAlbumText(text, widthMm, face.face, face.sizePt, metrics);
  return {
    lines,
    costMm: lines.length
      ? roundSizeMm(
          lines.length * metrics.lineHeightMm(face.face, face.sizePt) +
            preset.headingSpaceBelowMm,
        )
      : 0,
  };
}

/** The role a block's text is set in — a checklist heading unless the collector said otherwise. */
function blockRole(block: AlbumBlockSpec): AlbumTextRole {
  return block.role ?? "heading";
}

function measureBlock<T extends AlbumBoxSpec>(
  block: AlbumBlockSpec<T>,
  widthMm: number,
  preset: AlbumRenderPreset,
  metrics: AlbumTextMetrics,
): MeasuredBlock<T> {
  const role = blockRole(block);
  const heading = measureHeading(block.heading, widthMm, preset, metrics, role);
  // With a heading, the collector's own "space above a heading"; without one, the ordinary row gap,
  // so two unheaded blocks do not run together. The correction rides on that lead rather than beside
  // it, and floors at zero: `PAGE_VSPACE` closes gaps in his sources and never overlaps blocks.
  const leadMm = Math.max(
    0,
    roundSizeMm(
      (heading.lines.length ? preset.headingSpaceAboveMm : preset.boxGapYMm) +
        (block.spaceBeforeMm ?? 0),
    ),
  );
  const trailingMm = Math.max(0, roundSizeMm(block.spaceAfterMm ?? 0));

  const labelFace = albumRoleFace(preset, "label");
  const labelLineMm = metrics.lineHeightMm(labelFace.face, labelFace.sizePt);
  const labelled = preset.labelPosition !== "none";

  const rows: MeasuredRow<T>[] = [];
  for (const box of block.boxes) {
    const labelLines = labelled
      ? wrapAlbumText(
          box.label,
          box.widthMm,
          labelFace.face,
          labelFace.sizePt,
          metrics,
        )
      : [];
    let row = rows[rows.length - 1];
    const wouldBe = row
      ? roundSizeMm(row.widthMm + preset.boxGapXMm + box.widthMm)
      : 0;
    // A row always accepts its first box however wide: a mount wider than the page is an oversize
    // piece (#765), and it belongs on the page overhanging rather than dropped.
    if (!row || wouldBe > widthMm + FIT_EPSILON) {
      row = {
        boxes: [],
        boxHeightMm: 0,
        labelHeightMm: 0,
        widthMm: box.widthMm,
        heightMm: 0,
      };
      rows.push(row);
    } else {
      row.widthMm = wouldBe;
    }
    row.boxes.push({ box, labelLines });
    row.boxHeightMm = Math.max(row.boxHeightMm, box.heightMm);
    row.labelHeightMm = Math.max(
      row.labelHeightMm,
      roundSizeMm(labelLines.length * labelLineMm),
    );
  }
  for (const row of rows)
    row.heightMm = roundSizeMm(row.boxHeightMm + row.labelHeightMm);

  return {
    spec: block,
    heading,
    leadMm,
    trailingMm,
    rows,
    heightMm: roundSizeMm(
      leadMm +
        heading.costMm +
        rowsHeightMm(rows, preset.boxGapYMm) +
        trailingMm,
    ),
  };
}

/** What a run of rows costs, separated by the vertical box gap. */
function rowsHeightMm(
  rows: readonly { heightMm: number }[],
  gapYMm: number,
): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((total, row) => total + row.heightMm, 0);
  return roundSizeMm(sum + gapYMm * (rows.length - 1));
}

/** How many of `rows` fit in `spaceMm` once the lead and the heading have taken theirs. */
function rowsThatFit(
  rows: readonly { heightMm: number }[],
  fixedMm: number,
  spaceMm: number,
  gapYMm: number,
): number {
  let used = fixedMm;
  let count = 0;
  for (const row of rows) {
    const next = roundSizeMm(used + (count ? gapYMm : 0) + row.heightMm);
    if (next > spaceMm + FIT_EPSILON) break;
    used = next;
    count += 1;
  }
  return count;
}

/** One horizontal band: the blocks that share it, each measured at the sub-width it was given. */
interface MeasuredBand<T extends AlbumBoxSpec> {
  blocks: MeasuredBlock<T>[];
  /** What each block in the band was measured at, and is placed at. */
  blockWidthMm: number;
  heightMm: number;
}

/**
 * How many of the blocks starting at `from` may share one band, and the band that results.
 *
 * ## This is not a page divided into columns
 *
 * The distinction is the whole reason this function exists, and it is easy to get wrong because
 * AlbumEasy's `PAGE_COLUMN_START` looks exactly like a column mode. It is not one. The collector's
 * sources hold **35** active column regions; every one is closed by exactly one `PAGE_COLUMN_NEXT`
 * and one `PAGE_COLUMN_STOP` — always a pair, never three — and `PL-1933.txt` opens **six of them on
 * a single page**. What he is doing is putting two short checklists side by side, several times down
 * a page, and running full width everywhere else.
 *
 * So a band is local. Blocks pair when they are narrow enough to; a block that is not simply takes
 * the next band on its own. **Nothing ever overflows sideways** and no block continues into a
 * neighbour — which is also why the vertical rule stays as simple as it is.
 *
 * The widest pairing is tried first and the band splits its width evenly, which is what
 * `PAGE_COLUMN_START(50 …)` does. A block only joins if its **natural width** — its boxes on one
 * line — fits the share it would get: a block that would have to wrap to be paired is a block the
 * pairing has made worse.
 */
function measureBand<T extends AlbumBoxSpec>(
  blocks: readonly AlbumBlockSpec<T>[],
  from: number,
  preset: AlbumRenderPreset,
  contentWidthMm: number,
  metrics: AlbumTextMetrics,
): MeasuredBand<T> {
  const cap = Math.max(1, Math.round(preset.blocksPerBand));
  // Only an unbroken run of live blocks can share a band: a printed sheet is a page boundary. So is
  // a **forced break** (#769) — a band is one horizontal slice of one page, so pairing a block that
  // has been told to start a sheet of its own with the block above it would quietly overrule the
  // collector rather than the packer.
  let available = 0;
  while (
    available < cap &&
    from + available < blocks.length &&
    !blocks[from + available].printedPageIds?.length &&
    (available === 0 || blocks[from + available].breakBefore !== "always")
  ) {
    available += 1;
  }

  for (let n = available; n > 1; n -= 1) {
    const widthMm = roundSizeMm(
      (contentWidthMm - preset.blockGapMm * (n - 1)) / n,
    );
    const slice = blocks.slice(from, from + n);
    const fits = slice.every(
      (block) =>
        naturalBlockWidthMm(block, preset.boxGapXMm) <= widthMm + FIT_EPSILON,
    );
    if (!fits) continue;
    const measured = slice.map((block) =>
      measureBlock(block, widthMm, preset, metrics),
    );
    return {
      blocks: measured,
      blockWidthMm: widthMm,
      heightMm: measured.reduce(
        (tallest, block) => Math.max(tallest, block.heightMm),
        0,
      ),
    };
  }

  const only = measureBlock(blocks[from], contentWidthMm, preset, metrics);
  return {
    blocks: [only],
    blockWidthMm: contentWidthMm,
    heightMm: only.heightMm,
  };
}

/**
 * The bands that must land on one page together: one band, plus every band after it whose first
 * block asks not to be separated from what is above it (#769).
 *
 * This is what makes *a forced no break* expressible in a single-pass packer at all. The packer
 * decides page by page and never moves what it has already placed, so `avoid` cannot be a rule that
 * pulls the previous block forward after the fact — it has to make the **unit that moves whole**
 * bigger before anything is placed. That is also why it composes with everything else for free: a
 * unit of one band is the ordinary page, and every rule below it — moves whole, unpairs rather than
 * making a page worse, splits only when taller than a sheet — is written against a band and still is.
 *
 * The run stops at a **printed sheet**, which is a page boundary nothing may be kept together across,
 * and at a **forced break**, which is the collector saying the opposite in the same breath.
 */
function keepTogether<T extends AlbumBoxSpec>(
  blocks: readonly AlbumBlockSpec<T>[],
  from: number,
  preset: AlbumRenderPreset,
  contentWidthMm: number,
  metrics: AlbumTextMetrics,
): MeasuredBand<T>[] {
  const unit: MeasuredBand<T>[] = [];
  let at = from;
  for (;;) {
    const band = measureBand(blocks, at, preset, contentWidthMm, metrics);
    unit.push(band);
    at += band.blocks.length;
    const next = blocks[at];
    if (
      !next ||
      next.breakBefore !== "avoid" ||
      (next.printedPageIds?.length ?? 0) > 0
    ) {
      return unit;
    }
  }
}

/** A page being filled. */
interface OpenPage<T extends AlbumBoxSpec> {
  chapterKey: string;
  content: AlbumRect;
  chapter: AlbumPlacedText | null;
  headings: AlbumPlacedText[];
  boxes: AlbumPlacedBox<T>[];
  blocks: AlbumPlacedBlock[];
  /** How far down the page the pen has reached. */
  penMm: number;
}

/**
 * Turn an album's chapters into pages.
 *
 * The whole rule, in order:
 *
 * - A **chapter starts a page** and prints its heading once, across the full content width, at the
 *   head of that page.
 * - Blocks stack down the page in **bands**. Consecutive blocks share a band when they are narrow
 *   enough and the template allows it (see {@link measureBand}); one block per band is the ordinary
 *   case.
 * - A band that does not fit in what is left of the page moves **whole** to the next page. A paired
 *   band that will not fit even an empty page is **unpaired** first and its blocks tried singly, so
 *   pairing never makes a page worse.
 * - Only a single block **taller than an entire empty page** is split, at a row boundary; every page
 *   of it after the first is marked a continuation.
 * - A block already on **printed sheets** (#778) is not planned at all. The plan closes whatever page
 *   it was filling, files those sheets in its place, and resumes on fresh paper — it steps over them
 *   rather than routing content around them, because they are in a binder and nothing the planner
 *   decides can change what is on them. Several blocks naming one sheet are one sheet, and a sheet
 *   is filed **once**, where its first block puts it, however the entries have since been reordered.
 *
 * Total and deterministic: an album with no chapters plans no pages.
 */
export function planAlbumPages<T extends AlbumBoxSpec>(
  chapters: readonly AlbumChapterSpec<T>[],
  preset: AlbumRenderPreset,
  albumTitle: string,
  metrics: AlbumTextMetrics,
): AlbumPlan<T> {
  const frame = pageFrame(preset, albumTitle, metrics);
  const pages: AlbumPlannedPage<T>[] = [];
  /** Printed sheets already filed, by id — see the note where they are emitted. */
  const filed = new Map<
    string,
    Extract<AlbumPlannedPage<T>, { kind: "printed" }>
  >();

  /**
   * What an **ordinary empty page** holds — the figure "taller than an entire page" is measured
   * against.
   *
   * Not `page.content.heightMm`, which is the page being filled. On a chapter's first page those
   * two differ by the year heading, and using the wrong one splits a block that would have fitted
   * the next sheet whole: a 252 mm checklist met a chapter page with 235 mm under its heading and
   * was broken across two cards, marked *Continued*, on a template whose ordinary page holds
   * 260 mm. The rule is "a block moves whole; only a block taller than an entire page is split"
   * (ADR-0045 §7), and an entire page is this.
   */
  const fullContentHeightMm = pageContent(frame, 0).heightMm;

  const emit = (page: OpenPage<T>): void => {
    // A page nothing landed on is not a page. It happens when a chapter's blocks are all on printed
    // sheets: the chapter opened a page, the sheets were emitted, and nothing was left for it.
    if (page.boxes.length === 0 && page.headings.length === 0 && !page.chapter)
      return;
    pages.push({
      kind: "live",
      chapterKey: page.chapterKey,
      title: frame.title,
      chapter: page.chapter,
      headings: page.headings,
      boxes: page.boxes,
      blocks: page.blocks,
      footer: frame.footer,
      content: page.content,
    });
  };

  const freshPage = (chapterKey: string, offsetMm = 0): OpenPage<T> => {
    const content = pageContent(frame, offsetMm);
    return {
      chapterKey,
      content,
      chapter: null,
      headings: [],
      boxes: [],
      blocks: [],
      penMm: content.yMm,
    };
  };

  for (const chapter of chapters) {
    // A chapter opens a page and prints its heading at the head of it — unless its **first block is
    // already on paper** (#778), in which case the card in the binder carries that heading and the
    // plan must not print a second one. Emitting the year on a live sheet of its own here would put
    // a blank card headed 1938 in front of the printed card headed 1938, which is what an album with
    // every chapter printed would otherwise be a whole run of.
    //
    // Not the same case as a year heading legitimately alone on a sheet (#768): there the content
    // under it moved to the next *live* page and the heading is still the plan's to print.
    //
    // The block that answers this is the first one that **could have carried the heading**, which is
    // not always `blocks[0]`: a live text block the collector has since filed at the head of the
    // album (#769) sits in front of it and was on no card. Reading it as the opener would print a
    // second 1938 on a live sheet in front of the card headed 1938 — this family of bug arriving
    // through the editor rather than through a reorder. A note that is itself on paper *is* an
    // opener, because it is on the card that carries the year.
    const opener = chapter.blocks.find(
      (b) => b.kind !== "text" || (b.printedPageIds?.length ?? 0) > 0,
    );
    const opensOnPaper = !!opener?.printedPageIds?.length;
    const chapterFace = albumRoleFace(preset, "chapter");
    const chapterLines = opensOnPaper
      ? []
      : wrapAlbumText(
          chapter.heading,
          frame.contentW,
          chapterFace.face,
          chapterFace.sizePt,
          metrics,
        );
    const chapterTextMm = roundSizeMm(
      chapterLines.length *
        metrics.lineHeightMm(chapterFace.face, chapterFace.sizePt),
    );
    const chapterBandMm = chapterLines.length
      ? roundSizeMm(
          preset.headingSpaceAboveMm +
            chapterTextMm +
            preset.headingSpaceBelowMm,
        )
      : 0;

    let page = freshPage(chapter.key, chapterBandMm);
    if (chapterLines.length) {
      page.chapter = {
        role: "chapter",
        lines: chapterLines,
        xMm: frame.contentX,
        yMm: roundSizeMm(frame.contentTop + preset.headingSpaceAboveMm),
        widthMm: frame.contentW,
        heightMm: chapterTextMm,
      };
    }

    let i = 0;

    while (i < chapter.blocks.length) {
      const block = chapter.blocks[i];

      const printedIds = block.printedPageIds;
      if (printedIds && printedIds.length > 0) {
        let opened = false;
        for (const id of printedIds) {
          // **A sheet is filed exactly once, where its first block puts it.** Two blocks of one card
          // are ordinarily adjacent, but entries can be reordered after printing and then they are
          // not — and a card that appeared twice in the sequence would be listed twice, drawn twice
          // and reprinted twice. There is no arrangement that makes a reordered printed sheet read
          // correctly; there is one that keeps it a single sheet.
          const held = filed.get(id);
          if (held) {
            if (!held.entryIds.includes(block.entryId))
              held.entryIds.push(block.entryId);
            continue;
          }
          if (!opened) {
            emit(page);
            opened = true;
          }
          const sheet: Extract<AlbumPlannedPage<T>, { kind: "printed" }> = {
            kind: "printed",
            printedPageId: id,
            chapterKey: chapter.key,
            entryIds: [block.entryId],
          };
          pages.push(sheet);
          filed.set(id, sheet);
        }
        if (opened) page = freshPage(chapter.key);
        i += 1;
        continue;
      }

      // **A forced break** (#769): this block starts a sheet of its own. Conditioned on the page
      // having a *block* on it rather than on the pen having moved, so a chapter's own year heading
      // does not count — forcing a break under it would leave the year alone on a card, which is
      // something the packer already does when it has to (#768) and never something to do on
      // purpose. It terminates for the same reason: after the break the fresh page holds no blocks,
      // so the condition is false and the loop cannot take this branch twice for one block.
      if (block.breakBefore === "always" && page.blocks.length > 0) {
        emit(page);
        page = freshPage(chapter.key);
        continue;
      }

      // **A forced *no* break** (#769) is the other half, and it is not a mirror image: it makes the
      // thing that moves whole bigger. A block asking not to be separated from what is above it joins
      // the unit the previous band is in, and the unit is placed, moved or given up on together.
      const unit = keepTogether(
        chapter.blocks,
        i,
        preset,
        page.content.widthMm,
        metrics,
      );
      const band = unit[0];
      const unitHeightMm = roundSizeMm(
        unit.reduce((total, b) => total + b.heightMm, 0),
      );
      const spaceMm = roundSizeMm(
        page.content.yMm + page.content.heightMm - page.penMm,
      );
      const atTop = page.penMm <= page.content.yMm + FIT_EPSILON;
      // Whether a fresh page would give this band more room than the one being filled. Two ways it
      // can: the page is partly used, or it is a chapter's first page and is therefore short by the
      // height of the year heading. The second is what makes this a condition rather than `!atTop`.
      //
      // It still terminates, and the reason is worth stating because moving to a fresh page is the
      // one branch that places nothing: a fresh page is full height with the pen at its top, so
      // `roomier` is false there, and every remaining branch places something.
      const roomier =
        !atTop || page.content.heightMm + FIT_EPSILON < fullContentHeightMm;

      // The whole unit fits where the pen is: place every band of it.
      if (unitHeightMm <= spaceMm + FIT_EPSILON) {
        for (const held of unit) {
          placeBand(held, page, preset, metrics);
          i += held.blocks.length;
        }
        continue;
      }
      // It fits an empty page, just not what is left of this one: move it whole. A unit of one band
      // is the ordinary case and this is the rule that has always been here; a longer unit is the
      // collector's *keep these together* being honoured.
      if (roomier && unitHeightMm <= fullContentHeightMm + FIT_EPSILON) {
        emit(page);
        page = freshPage(chapter.key);
        continue;
      }
      // A unit longer than one band that will not fit any page **cannot be kept together**, so the
      // preference is dropped and its first band is packed on its own — which is what the rest of
      // this loop then does. Giving up rather than looping is the point: `avoid` is a preference and
      // a run of them taller than a sheet has no arrangement that satisfies it.
      if (unit.length > 1) {
        if (band.heightMm <= spaceMm + FIT_EPSILON) {
          placeBand(band, page, preset, metrics);
          i += band.blocks.length;
          continue;
        }
        if (roomier) {
          emit(page);
          page = freshPage(chapter.key);
          continue;
        }
      }
      // Too tall even for an empty page. If it is a pairing, unpair it — pairing must never make a
      // page worse — and let the loop try the first block on its own.
      if (band.blocks.length > 1) {
        const single = measureBlock(
          block,
          page.content.widthMm,
          preset,
          metrics,
        );
        const solo: MeasuredBand<T> = {
          blocks: [single],
          blockWidthMm: page.content.widthMm,
          heightMm: single.heightMm,
        };
        if (solo.heightMm <= spaceMm + FIT_EPSILON) {
          placeBand(solo, page, preset, metrics);
          i += 1;
          continue;
        }
        if (roomier) {
          emit(page);
          page = freshPage(chapter.key);
          continue;
        }
        page = splitBlockAcrossPages(
          solo.blocks[0],
          page,
          preset,
          metrics,
          (finished) => {
            emit(finished);
            return freshPage(chapter.key);
          },
        );
        i += 1;
        continue;
      }
      if (roomier) {
        emit(page);
        page = freshPage(chapter.key);
        continue;
      }
      // One block, taller than a whole page, and the pen is at the top of one: it splits.
      page = splitBlockAcrossPages(
        band.blocks[0],
        page,
        preset,
        metrics,
        (finished) => {
          emit(finished);
          return freshPage(chapter.key);
        },
      );
      i += 1;
    }
    emit(page);
  }

  return { pages };
}

/**
 * Place a block too tall for one page, a row at a time, marking every page after the first a
 * continuation.
 *
 * `nextPage` emits the page being filled and opens a fresh one; the caller owns that, because only
 * it knows the chapter. Returns the page the block finished on.
 *
 * If not even one row fits an empty page — a heading taller than the sheet, or one enormous mount —
 * the row is placed anyway and overhangs. Refusing to place it would be a plan that never terminates,
 * and a mount drawn off the paper is at least a visible, fixable mistake.
 */
function splitBlockAcrossPages<T extends AlbumBoxSpec>(
  measured: MeasuredBlock<T>,
  page: OpenPage<T>,
  preset: AlbumRenderPreset,
  metrics: AlbumTextMetrics,
  // Takes the page it has just filled. It must, rather than closing over the caller's variable: the
  // caller's `page` is the one this started on, and emitting that one on every turn of the loop
  // would publish the first page N times and lose the rest.
  nextPage: (finished: OpenPage<T>) => OpenPage<T>,
): OpenPage<T> {
  let current = page;
  let rowIndex = 0;
  let part = 1;

  for (;;) {
    // The heading this sheet actually prints, and therefore the heading this sheet is charged for.
    // Page one is the block's own; every page after it carries the part number, which can wrap to a
    // line the unmarked heading did not need. Measured here, when the page is made, so nothing is
    // circular: whether the block splits at all was decided before any marker existed.
    const heading =
      part === 1
        ? measured.heading
        : measureHeading(
            albumContinuationHeading(measured.spec.heading, part),
            current.content.widthMm,
            preset,
            metrics,
            blockRole(measured.spec),
          );
    const rest = measured.rows.slice(rowIndex);
    const fixedMm = roundSizeMm(measured.leadMm + heading.costMm);
    const spaceMm = roundSizeMm(
      current.content.yMm + current.content.heightMm - current.penMm,
    );
    const take = Math.max(
      1,
      rowsThatFit(rest, fixedMm, spaceMm, preset.boxGapYMm),
    );

    placeBlock(
      measured,
      heading,
      rowIndex,
      Math.min(take, rest.length),
      part,
      current,
      preset,
      metrics,
      {
        xMm: current.content.xMm,
        widthMm: current.content.widthMm,
      },
    );
    rowIndex += Math.max(1, Math.min(take, rest.length));
    part += 1;
    if (rowIndex >= measured.rows.length) return current;
    current = nextPage(current);
  }
}

/** Place a whole band at the pen, side by side, and advance the pen past the tallest of them. */
function placeBand<T extends AlbumBoxSpec>(
  band: MeasuredBand<T>,
  page: OpenPage<T>,
  preset: AlbumRenderPreset,
  metrics: AlbumTextMetrics,
): void {
  const top = page.penMm;
  for (let i = 0; i < band.blocks.length; i += 1) {
    // Every block in a band starts at the band's top, so two paired checklists read as one row of
    // the page rather than as two things that happen to be near each other.
    page.penMm = top;
    placeBlock(
      band.blocks[i],
      band.blocks[i].heading,
      0,
      band.blocks[i].rows.length,
      1,
      page,
      preset,
      metrics,
      {
        xMm: roundSizeMm(
          page.content.xMm + i * (band.blockWidthMm + preset.blockGapMm),
        ),
        widthMm: band.blockWidthMm,
      },
    );
  }
  page.penMm = roundSizeMm(top + band.heightMm);
}

/** Place a block's lead, heading and `count` of its rows at the pen, in the given column of the
 *  page, advancing the pen. */
function placeBlock<T extends AlbumBoxSpec>(
  measured: MeasuredBlock<T>,
  /** The heading **this sheet** prints — the block's own on its first, the marked one after that. */
  heading: MeasuredHeading,
  fromRow: number,
  count: number,
  part: number,
  page: OpenPage<T>,
  preset: AlbumRenderPreset,
  metrics: AlbumTextMetrics,
  at: { xMm: number; widthMm: number },
): void {
  page.penMm = roundSizeMm(page.penMm + measured.leadMm);

  const role = blockRole(measured.spec);
  if (heading.lines.length) {
    const headingFace = albumRoleFace(preset, role);
    const textMm = roundSizeMm(
      heading.lines.length *
        metrics.lineHeightMm(headingFace.face, headingFace.sizePt),
    );
    page.headings.push({
      role,
      lines: heading.lines,
      xMm: at.xMm,
      yMm: page.penMm,
      widthMm: at.widthMm,
      heightMm: textMm,
    });
    page.penMm = roundSizeMm(page.penMm + heading.costMm);
  }

  const firstBoxIndex = measured.rows
    .slice(0, fromRow)
    .reduce((total, row) => total + row.boxes.length, 0);
  let placed = 0;

  const labelFace = albumRoleFace(preset, "label");
  const labelLineMm = metrics.lineHeightMm(labelFace.face, labelFace.sizePt);

  for (let i = fromRow; i < fromRow + count; i += 1) {
    const row = measured.rows[i];
    // Rows are centred in the width the block was given, as `collage-layout.ts` centres them against
    // the widest row and as the collector's own pages are set.
    let x = roundSizeMm(at.xMm + (at.widthMm - row.widthMm) / 2);
    const above = preset.labelPosition === "above";
    const boxTop = above
      ? roundSizeMm(page.penMm + row.labelHeightMm)
      : page.penMm;
    const labelTop = above
      ? page.penMm
      : roundSizeMm(page.penMm + row.boxHeightMm);

    for (const { box, labelLines } of row.boxes) {
      page.boxes.push({
        box,
        entryId: measured.spec.entryId,
        xMm: x,
        // Mounts are centred in the row's band, so a definitive beside a souvenir sheet is not
        // stretched and does not sit on the sheet's baseline.
        yMm: roundSizeMm(boxTop + (row.boxHeightMm - box.heightMm) / 2),
        widthMm: box.widthMm,
        heightMm: box.heightMm,
        label: labelLines.length
          ? {
              role: "label",
              lines: labelLines,
              xMm: x,
              yMm: labelTop,
              widthMm: box.widthMm,
              heightMm: roundSizeMm(labelLines.length * labelLineMm),
            }
          : null,
      });
      x = roundSizeMm(x + box.widthMm + preset.boxGapXMm);
      placed += 1;
    }
    page.penMm = roundSizeMm(
      page.penMm +
        row.heightMm +
        (i + 1 < fromRow + count ? preset.boxGapYMm : 0),
    );
  }

  // The collector's extra space **after** the block, on the sheet the block actually ends on. A
  // split block charges it once, at the foot of its last card, rather than three times over — the
  // correction is *after this checklist*, and the gaps inside a split one are page edges.
  if (fromRow + count >= measured.rows.length) {
    page.penMm = roundSizeMm(page.penMm + measured.trailingMm);
  }

  page.blocks.push({
    entryId: measured.spec.entryId,
    kind: measured.spec.kind ?? "entry",
    part,
    heading: heading.lines.join(" "),
    firstBoxIndex,
    boxCount: placed,
    // Read off the page rather than off the packer's own branches: a block that got what it asked
    // for has the block it wanted to stay with above it on this sheet, so the sheet is not empty
    // under it. Every way the preference can be dropped — an unsatisfiable run, a chapter boundary,
    // a band unpaired — arrives here the same way.
    ...(measured.spec.breakBefore === "avoid" &&
    part === 1 &&
    page.blocks.length === 0
      ? { separated: true }
      : {}),
  });
}
