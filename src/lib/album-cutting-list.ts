// The hawid cutting list (#770): what to cut for a card, and what the album needs bought.
//
// **Pure.** No Prisma, no React — `album-layout.ts`'s rule and `hawid.ts`'s, and here it is at its
// sharpest, because this is the surface that is read at the desk with scissors in hand. A wrong
// figure on a page plan is a redraw; a wrong figure here is material cut to the wrong size, and
// hawid does not go back together.
//
// So this module **does no box arithmetic at all.** Every width and every strip height arrives
// already decided — by `hawid.ts` for a live sheet, from the stored snapshot for a printed one — and
// what happens in here is counting, grouping and packing. A box on the card and a cut on this list
// have to be one number computed once, and the only way that holds is that this file never computes
// one. (That property was checked on paper during #768: a sheet was printed and a 134 × 106 mm box
// measured 134 × 106 mm. It holds while this list reads the same rule and not a moment longer.)
//
// ## Count slots, never stamps
//
// **The unit is a box, and a box is a slot.** A stamp can be on two checklists of one issue — basic
// and specialized, perforated and imperforate (ADR-0031) — and an album gathers both from the same
// area, so both can land on one card. That is two boxes, two hawids, two cuts. #778 found this the
// hard way: its printed-page index was first keyed `(page, stamp)` and refused to store such a sheet
// at all; it is keyed `(page, entry, stamp)` now, and ADR-0047 §2 generalises it past that table
// specifically for this list. Nothing below is ever keyed by, deduplicated by, or counted per stamp.
//
// ## Identical cuts collapse, because that is how cutting is done
//
// Six 38 mm pieces off the 29 mm strip is one instruction and six cuts, not six instructions. So a
// sheet's rows are grouped by (strip, width) and carry a count, placed at the group's **first**
// appearance so the list still reads down the page in the order the pieces get stuck.
//
// ## Two kinds of box take no hawid, and they are not the same kind of problem
//
// - **Oversize** — a piece no strip in stock is tall enough for (#765). A block or a souvenir sheet
//   goes in a pocket, and saying so is more useful than naming a strip height that does not exist.
//   This is an answer, not an error.
// - **Unmeasured** — a stamp nothing on its checklist has a size for. `album-plan.ts` gives it a
//   degenerate box (the clearances and nothing else) rather than a plausible default, and says in so
//   many words that this list "has nothing to cut". It is important that it lands here rather than
//   in the cuts: a degenerate box is *small*, so the rule finds it the shortest strip in the drawer
//   and it would otherwise read as a perfectly ordinary instruction to cut 2 mm off the 21 mm strip.
//
// ## Two demands, because the album records printing and not mounting
//
// The collector marks a sheet printed **as it leaves the printer** and cuts for it afterwards — his
// own workflow, asked and answered — so a card being on paper says nothing about whether its hawid
// has been cut. Neither a total over everything nor a total over the live sheets alone is the
// answer: the first counts material mounted a year ago, the second leaves out the run he is about to
// sit down with. So there are two figures, never summed, the printed one read first because it is
// the most recent off the printer, and each sheet carries the moment it was marked so the run is
// visible. A rule deciding *these are mounted and those are not* would be the app inventing a fact
// the model does not hold.
//
// ## The per-sheet lists and the album demand are allowed to disagree
//
// Stated because it looks like an inconsistency and is not, and somebody will eventually try to
// "fix" it: **summing every sheet's cuts does not give the shopping list.** The two halves answer
// different questions. A sheet's list is a *record for one card* — what it was cut to, printed or
// not — so a card in a binder has one and always will. The album demand is about *work left*, so
// the printed cards are held in a figure of their own. Reconciling them would mean either dropping
// printed cards from their own cutting lists, which is the one thing the snapshot keeps `sizeSource`
// and the copied strip for, or summing a card's hawid into a shopping list twice.
//
// ## The stock demand is packed, not divided
//
// The number of stock-length strips is **not** the total width over the stock length. A piece cannot
// span two strips, so four 120 mm pieces need four 210 mm strips and not the three that division
// gives — and a shopping list that under-counts sends the collector back to the shop with half an
// album mounted. {@link packStrips} does first-fit-decreasing, which is deterministic and never
// under-counts. The total width is reported beside it because the issue asks for it and because it
// is the figure that says how much of what you buy is offcut.

import type { AlbumPlannedPage } from "./album-layout";

/** A strip as this list reads one. The two measurements plus whatever the collector calls it —
 *  never an id, because a **printed** card's strip is copied into its snapshot rather than
 *  referenced (ADR-0047 §1) and the row it was copied from may since have been renamed or thrown
 *  away. Height and length are what get cut; the label is what gets looked for in the drawer. */
export interface AlbumCutStrip {
  heightMm: number;
  stockLengthMm: number;
  label: string | null;
}

/** One box of a sheet, as it was decided. Nothing here is re-derived. */
export interface AlbumCutBoxSpec {
  /** The cut — the stamp plus the template's horizontal margin (#765). */
  widthMm: number;
  /** The box's height: the strip's, or the piece's own when no strip is tall enough. */
  heightMm: number;
  /** The strip it comes off, or **null** for a piece that goes in a pocket. */
  strip: AlbumCutStrip | null;
  /** Where the size came from (#763). `inherited` is a checklist neighbour's figure and is said out
   *  loud on the cutting line — a collector cutting to a borrowed number as if it had been measured
   *  is the failure that whole rule is arranged against. **Null is a stamp nothing has measured**,
   *  and its box is uncuttable however small it looks. */
  sizeSource: "stated" | "inherited" | null;
  /** What the box is labelled on the card, so an exception can be found on the sheet. */
  label: string;
}

/** One sheet the list covers. Its boxes are in **page order** — the order they are stuck down. */
export interface AlbumCutSheetSpec {
  /** The sheet's identity: its catalog range (ADR-0045 §1). Blank for a page nothing can name. */
  range: string;
  chapterKey: string;
  /** The checklists on the sheet, for context above its cuts. */
  headings: string[];
  /** Set for a card already on paper (#778). Its boxes come from that card's stored snapshot, never
   *  from live data — the strip in the drawer may have changed and the paper has not. */
  printedPageId: string | null;
  /** When that card was marked printed, ISO. Shown per sheet rather than grouped on: the collector
   *  marks a sheet printed as it leaves the printer and cuts for it afterwards, so *which run a card
   *  came out of* is the thing that separates the cards still waiting for their hawid from the ones
   *  mounted months ago — and the album records printing, not mounting, so it cannot say that
   *  itself. A timestamp lets him see it; a grouping rule would be the app guessing. */
  printedAt: string | null;
  boxes: readonly AlbumCutBoxSpec[];
}

/** One instruction: cut this many pieces of this width off this strip. */
export interface AlbumCut {
  strip: AlbumCutStrip;
  widthMm: number;
  /** How many pieces — **boxes**, which is slots and not stamps. */
  count: number;
  /** How many of them were sized from a checklist neighbour rather than from the stamp itself. Kept
   *  as a count beside the cut rather than splitting the row, because the cut is one cut however the
   *  figure was arrived at, and the collector still has to be told it was borrowed. */
  inheritedCount: number;
}

export type AlbumUncutReason = "oversize" | "unmeasured";

/** A box that takes no hawid, kept one row per box rather than collapsed: these are the ones the
 *  collector has to think about individually, and the label is how they are found on the card. */
export interface AlbumUncutBox {
  reason: AlbumUncutReason;
  /** The piece's own size. Meaningless for `unmeasured`, which states nothing to cut. */
  widthMm: number;
  heightMm: number;
  label: string;
}

/** One sheet's cutting list. */
export interface AlbumCutSheet {
  range: string;
  chapterKey: string;
  headings: string[];
  printedPageId: string | null;
  printedAt: string | null;
  /** In page order, identical cuts collapsed to a count at their first appearance. */
  cuts: AlbumCut[];
  /** Boxes that take no hawid, apart, in page order. */
  uncut: AlbumUncutBox[];
  /** Every box on the sheet — cut and uncut. Slots, so it is the number of hawids the card needs
   *  plus the number of pockets, and never a number of stamps. */
  boxCount: number;
}

/** What one strip height owes, over however many sheets were counted. */
export interface AlbumStripDemand {
  strip: AlbumCutStrip;
  /** Whether the drawer still holds this strip — this height at this stock length.
   *
   *  Only ever false for a printed card, and that is the whole point of it. A printed box's strip is
   *  **copied** into its snapshot rather than referenced (ADR-0047 §1), so a card can name a 29 mm
   *  strip that has since been renamed, sold out or deleted. The row still states what was cut,
   *  because that is what the snapshot says and nothing may reach backwards into a card already made
   *  — it is **never silently remapped to the nearest strip in stock**, which would be a list
   *  inventing a cut nobody made. It is flagged instead, so a line the collector cannot act on says
   *  so rather than reading as an ordinary trip to the drawer.
   *
   *  A live sheet's strips come out of that same drawer, so its rows are in stock by construction. */
  inStock: boolean;
  /** Pieces to cut from this height. */
  pieces: number;
  /** Their total width, in millimetres — how much strip actually becomes box. */
  totalWidthMm: number;
  /** Stock-length strips those pieces need, packed rather than divided. Always at least
   *  `ceil(totalWidthMm / stockLengthMm)` and usually more, the difference being offcut. */
  strips: number;
}

/** The album's demand, and what it was counted over. */
export interface AlbumCutDemand {
  /** By strip height, shortest first. */
  byStrip: AlbumStripDemand[];
  /** Sheets counted. */
  sheetCount: number;
  /** Boxes counted, cut and uncut — slots. */
  boxCount: number;
  /** Boxes among them that take no hawid, so a demand of zero over a page of blocks reads as the
   *  pocket-mounted page it is rather than as nothing to do. */
  uncutCount: number;
}

/** The whole list: every sheet, and the demand split by what is still to cut and what the cards in
 *  the binder already account for. */
export interface AlbumCuttingList {
  sheets: AlbumCutSheet[];
  /**
   * Demand over the sheets **still on screen** — everything not yet printed.
   *
   * Not the whole shopping list, and this is the decision the whole split turns on. **Marking
   * printed and mounting are two moments, and the collector marks a sheet printed as it leaves the
   * printer** — asked and answered — so a card being on paper says nothing about whether its hawid
   * has been cut. A demand that quietly counted only these would leave the run he is about to sit
   * down and cut for out of the figure entirely, which is the same failure as counting a mounted
   * card twice, arriving from the other side.
   */
  toCut: AlbumCutDemand;
  /**
   * Demand over the cards already printed, kept **apart** from {@link toCut} rather than summed into
   * it — and read first, because that is the run most recently off the printer.
   *
   * Two figures rather than one because the album records **printing, not mounting**, and neither
   * total is the answer on its own: this one covers every card ever printed, of which the ones from
   * a year ago are mounted and the ones from this morning are not. Summing them would produce a
   * single number that is wrong for every album older than one printing session. Each sheet carries
   * `printedAt` so the run is visible, which is as far as the model can honestly go; a rule that
   * decided *these are mounted, those are not* would be the app inventing a fact it does not hold.
   *
   * Their boxes come from the stored snapshots, so this is what those cards were cut to, whatever
   * the drawer holds now (ADR-0047 §1).
   */
  onPaper: AlbumCutDemand;
}

/** Millimetres to a tenth, `hawid.ts`'s precision, applied to every sum so a total is not a run of
 *  binary-float residue. Local rather than imported from `stamp-size.ts` for the same reason this
 *  module holds no other arithmetic: it is the one rounding this file does. */
function roundMm(mm: number): number {
  return Math.round(mm * 10) / 10;
}

/** A strip's identity for grouping: its height **and** its stock length.
 *
 *  Height alone would be enough for live stock — `HawidStrip` is unique per collection on height —
 *  but a printed card carries a *copy* of the strip it was cut from, and a drawer restocked at a
 *  different length is two different things to buy however equal their heights. */
function stripKey(strip: AlbumCutStrip): string {
  return `${roundMm(strip.heightMm)}x${roundMm(strip.stockLengthMm)}`;
}

/**
 * One sheet's cutting list, in page order.
 *
 * Boxes are walked exactly as they were placed and never re-sorted: the pieces come off the strip in
 * the order they will be stuck down, which is the whole reason the order is stated at all.
 */
export function albumSheetCuts(sheet: AlbumCutSheetSpec): AlbumCutSheet {
  const cuts: AlbumCut[] = [];
  const index = new Map<string, AlbumCut>();
  const uncut: AlbumUncutBox[] = [];

  for (const box of sheet.boxes) {
    // An unmeasured box is uncuttable **before** it is asked what strip it is on. The rule found it
    // one — a degenerate box is tiny and the shortest strip in the drawer swallows it — and cutting
    // 2 mm off a 21 mm strip for a stamp nobody has measured is exactly the plausible-looking
    // instruction #763 exists to prevent.
    if (box.sizeSource === null) {
      uncut.push({
        reason: "unmeasured",
        widthMm: box.widthMm,
        heightMm: box.heightMm,
        label: box.label,
      });
      continue;
    }
    if (!box.strip) {
      uncut.push({
        reason: "oversize",
        widthMm: box.widthMm,
        heightMm: box.heightMm,
        label: box.label,
      });
      continue;
    }

    const widthMm = roundMm(box.widthMm);
    const key = `${stripKey(box.strip)}@${widthMm}`;
    let cut = index.get(key);
    if (!cut) {
      cut = { strip: box.strip, widthMm, count: 0, inheritedCount: 0 };
      index.set(key, cut);
      // Placed where the group first appears, so collapsing does not move a cut up or down the page.
      cuts.push(cut);
    }
    cut.count += 1;
    if (box.sizeSource === "inherited") cut.inheritedCount += 1;
  }

  return {
    range: sheet.range,
    chapterKey: sheet.chapterKey,
    headings: sheet.headings,
    printedPageId: sheet.printedPageId,
    printedAt: sheet.printedAt,
    cuts,
    uncut,
    boxCount: sheet.boxes.length,
  };
}

/**
 * How many stock-length strips a set of pieces needs — **packed**, not divided.
 *
 * First-fit-decreasing: widest piece first, into the first strip with room for it. Division by total
 * width is the wrong instrument and under-counts, which is the one direction a shopping list must
 * never be wrong in — four 120 mm pieces are four 210 mm strips, not the three that `ceil(480/210)`
 * gives. FFD is deterministic, never returns fewer strips than are actually needed, and is within a
 * strip or two of optimal on the sizes an album produces.
 *
 * A piece longer than the strip is sold at gets a strip of its own and is still counted. `hawid.ts`
 * refuses such a strip when it chooses one, so nothing live reaches this — but a snapshot carries a
 * strip copied from a drawer that has since been restocked shorter, and a packer that looped for
 * ever on it would be a worse answer than an honest over-count.
 */
export function packStrips(
  widthsMm: readonly number[],
  stockLengthMm: number
): number {
  if (widthsMm.length === 0) return 0;
  const remaining: number[] = [];
  for (const width of [...widthsMm].sort((a, b) => b - a)) {
    // A tenth of a millimetre of slack: everything here is rounded to a tenth already, so a strict
    // comparison on binary floats would open a fresh strip for a piece that fits exactly.
    const i = remaining.findIndex((left) => left + 1e-6 >= width);
    if (i === -1) {
      remaining.push(roundMm(Math.max(stockLengthMm - width, 0)));
      continue;
    }
    remaining[i] = roundMm(remaining[i] - width);
  }
  return remaining.length;
}

/**
 * The demand a run of sheets comes to, aggregated by strip.
 *
 * Shortest strip first, which is the drawer read in order and is stable whatever order the sheets
 * were counted in. The caller decides **which** sheets: see {@link AlbumCuttingList.toCut}, which
 * counts the ones not yet on paper, and `onPaper`, which counts the rest and is never added to it.
 */
export function albumCutDemand(
  sheets: readonly AlbumCutSheet[],
  /** The drawer as it stands, for {@link AlbumStripDemand.inStock}. Absent means unknown, and every
   *  row then reads as in stock rather than as a drawer full of holes. */
  stock: readonly AlbumCutStrip[] = []
): AlbumCutDemand {
  const widths = new Map<string, { strip: AlbumCutStrip; widthsMm: number[] }>();
  let boxCount = 0;
  let uncutCount = 0;

  for (const sheet of sheets) {
    boxCount += sheet.boxCount;
    uncutCount += sheet.uncut.length;
    for (const cut of sheet.cuts) {
      const key = stripKey(cut.strip);
      let held = widths.get(key);
      if (!held) {
        held = { strip: cut.strip, widthsMm: [] };
        widths.set(key, held);
      }
      // One entry per piece, not one per instruction: the packer needs the pieces.
      for (let n = 0; n < cut.count; n += 1) held.widthsMm.push(cut.widthMm);
    }
  }

  const held = new Set(stock.map(stripKey));
  const byStrip = [...widths.values()]
    .map(({ strip, widthsMm }) => ({
      strip,
      inStock: held.size === 0 || held.has(stripKey(strip)),
      pieces: widthsMm.length,
      totalWidthMm: roundMm(widthsMm.reduce((sum, w) => sum + w, 0)),
      strips: packStrips(widthsMm, strip.stockLengthMm),
    }))
    .sort(
      (a, b) =>
        a.strip.heightMm - b.strip.heightMm ||
        a.strip.stockLengthMm - b.strip.stockLengthMm
    );

  return { byStrip, sheetCount: sheets.length, boxCount, uncutCount };
}

/**
 * The whole list for an album.
 *
 * `sheets` arrive in printing order and stay in it — the list is read alongside the album's own page
 * list, and a second order would be a second thing to reconcile.
 */
export function buildAlbumCuttingList(
  sheets: readonly AlbumCutSheetSpec[],
  /** The drawer as it stands, so a printed card naming a strip nobody stocks any more says so. */
  stock: readonly AlbumCutStrip[] = []
): AlbumCuttingList {
  const built = sheets.map(albumSheetCuts);
  return {
    sheets: built,
    toCut: albumCutDemand(built.filter((s) => !s.printedPageId), stock),
    onPaper: albumCutDemand(built.filter((s) => s.printedPageId), stock),
  };
}

// ── Reading the plan ─────────────────────────────────────────────────────────
//
// The mapping from a plan page to a cutting sheet lives here, in the pure half, rather than in the
// module that reads rows. It is where the whole *stepping over printed sheets* question is answered
// — a live sheet's boxes come from the plan and a printed card's from its stored snapshot, and
// nothing may resolve a printed card's box from live data (ADR-0047 §1) — and that answer has to be
// reachable by a test that constructs an album with **every page printed** and one whose entries
// were **reordered after printing**, which are the two inputs that separate *stepped over* from
// *left out* (ADR-0047 §4). Neither is reachable through Prisma in a unit test.

/** A page of the plan as this list reads it: `AlbumPlanPage` narrowed to what it needs, over the box
 *  fields a live plan box (`AlbumBoxData`) and a stored snapshot box (`AlbumSnapshotBox`) have in
 *  common. Structural on purpose — both carry more than {@link AlbumCutBoxSpec}, and neither type may
 *  be imported here: one lives behind Prisma and the other would tie the arithmetic to a stored
 *  shape. */
export interface AlbumCutPlanPage {
  range: string;
  layout: AlbumPlannedPage<AlbumCutBoxSpec>;
}

/** A printed card's stored contents, narrowed the same way. `AlbumPageSnapshot` satisfies it. */
export interface AlbumCutSnapshot {
  range: string;
  chapterKey: string;
  page: Extract<AlbumPlannedPage<AlbumCutBoxSpec>, { kind: "live" }>;
}

/** The plan's sheets as cutting sheets, and the printed cards whose contents could not be read.
 *
 *  Pages are walked in the plan's own order and each appears exactly once, because the planner
 *  already files a printed card **once**, where its first block puts it, however the entries have
 *  since been reordered (#778). Rebuilding the sequence from the printed index instead would undo
 *  that and list one card in the binder twice.
 *
 *  A card whose snapshot is missing is **named, not dropped and not re-derived**: its cuts are
 *  genuinely unknown, and a sheet listed as needing nothing is worse than one listed as unreadable,
 *  because only one of them gets looked at. */
export function albumCutSheets(
  pages: readonly AlbumCutPlanPage[],
  snapshots: ReadonlyMap<string, AlbumCutSnapshot>,
  /** When each printed card was marked printed, ISO, by page id. */
  printedAt: ReadonlyMap<string, string> = new Map()
): { sheets: AlbumCutSheetSpec[]; unreadable: string[] } {
  const sheets: AlbumCutSheetSpec[] = [];
  const unreadable: string[] = [];

  for (const page of pages) {
    if (page.layout.kind === "live") {
      sheets.push({
        range: page.range,
        chapterKey: page.layout.chapterKey,
        headings: page.layout.headings.map((h) => h.lines.join(" ")),
        printedPageId: null,
        printedAt: null,
        // Page order, untouched: the pieces come off the strip in the order they get stuck down.
        boxes: page.layout.boxes.map((placed) => placed.box),
      });
      continue;
    }
    const printedPageId = page.layout.printedPageId;
    const snapshot = snapshots.get(printedPageId);
    if (!snapshot) {
      unreadable.push(page.range);
      sheets.push({
        range: page.range,
        chapterKey: page.layout.chapterKey,
        headings: [],
        printedPageId,
        printedAt: printedAt.get(printedPageId) ?? null,
        boxes: [],
      });
      continue;
    }
    sheets.push({
      // The card's **own** stored range and chapter, not the plan's account of where it sits: what
      // is on a card is what was stored when it was printed.
      range: snapshot.range,
      chapterKey: snapshot.chapterKey,
      headings: snapshot.page.headings.map((h) => h.lines.join(" ")),
      printedPageId,
      printedAt: printedAt.get(printedPageId) ?? null,
      boxes: snapshot.page.boxes.map((placed) => placed.box),
    });
  }

  return { sheets, unreadable };
}
