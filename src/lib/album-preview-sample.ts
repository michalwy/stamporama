// The sample page an album template previews against (#795) — pure, so the whole of it can be
// reasoned about and unit-tested without a database or a collection.
//
// ## Why there is a sample at all
//
// A template is set up **before** the album it will be used on exists — that is the whole shape of
// #766, and it is why `ALBUM_PREVIEW_CONTEXT` already stands in for an album's name in the four
// text builders. A preview that needed a real album would be unavailable at exactly the moment the
// collector first opens this dialog. Pointing at a real album is offered beside this and is the
// half that makes the preview trustworthy once there is material; both were decided by the
// collector on 2026-09-06 and neither replaces the other.
//
// What is fabricated is the **album** — no `Album` row, no `Checklist`, nothing in his collection.
// The stamps on it are not fabricated at all; see below.
//
// ## Every figure in it was counted, not invented
//
// `albums.md` opens by saying to count something in the sources before writing the code, and this is
// a file that would otherwise have been entirely made up. So it is not: every stamp below is one of
// the collector's own, at the size **he measured**, under the heading **he wrote**, taken from
// `~/Documents/AlbumEasy/PL/PL-1950.txt` and `PL-1951.txt` and cited line by line. The sample even
// reproduces one of his printed pages — `1951, 15 XI` puts the two Festiwal Muzyki Polskiej stamps
// and the Zjazd PZF souvenir sheet on one card, which is where they are in his binder.
//
// That matters more than tidiness. "Eight definitives fill a row and start a second" is a claim
// about Liberation's real advances on real A4 at a real mount size, and the whole point of the
// preview is that what it shows is what the printer does. A sample of invented squares would make
// that claim about nothing.
//
// ## What the set has to contain, and why each part is here
//
// The measure of a sample page is not that it looks like an album — it is that **every number the
// collector is about to change does something visible on it**. So the seven checklists were chosen
// out of those two files for these six properties:
//
// - **Four mount heights** — 23, 26, 32 and 45 mm. Box height is the height of the shortest strip in
//   the drawer the piece fits into (#765), so a page of one size selects one strip and says nothing
//   about the vertical clearance. Four spread across the range a collector actually stocks means
//   raising it moves *some* of them onto the next packet and leaves the rest, which is the behaviour
//   the field has and the thing a single size hides. Against an ordinary drawer they come out on
//   four different strips.
// - **A souvenir sheet no strip is tall enough for** — his 91 × 120 mm Zjazd PZF block, which needs
//   124 mm of hawid and gets a pocket instead (#765). The oversize case, reached the way it is
//   reached on real material rather than by choosing a figure that produces it.
// - **A run of eight definitives** — Bolesław Bierut at 22 × 26 — which fills a row across a 190 mm
//   content width and starts a second. The gap between rows is invisible on a block that fits one
//   line, and so is half of what the box gap does.
// - **Two pairs of short checklists**, one in each chapter, so `blocksPerBand` and the gap between
//   two sharing a band have something to do. Their natural widths are 61 and 30 mm, and 36 and
//   73 mm, against a 90 mm share — so both pair at the default ceiling of two and both stack the
//   moment it is lowered to one.
// - **A heading long enough to wrap** — *III Światowy Festiwal Młodych Bojowników o Pokój w
//   Berlinie*, which breaks to two lines inside a shared band. Type size and face change where a
//   heading breaks, and a sample of short headings would never show it.
// - **Two chapters**, because a chapter starts a page (#767): the sample is two sheets without any
//   pagination being built for it, and the running head, the chapter heading, the footer and the
//   space above a heading only show themselves across a page boundary.
//
// ## It states its own sizes, and never inherits one
//
// Every sample stamp carries a measured size, so `sizeSource` is `stated` throughout and no box is
// drawn from a neighbour's figure (#763). That is deliberate: the inherited and unmeasured flags are
// facts about a collection's data, and a template preview that showed them would be reporting a
// problem the collector cannot fix from this dialog. Pointing the preview at a real album is where
// those flags belong, and there they are real.

import { planHawidBox } from "./hawid";
import { catalogSortKeyOf } from "./catalog-sort-key";
import {
  ALBUM_PREVIEW_CONTEXT,
  renderTitleTemplate,
  type TitleTemplateCopy,
} from "./offer-title-template";
import {
  albumHawidMargins,
  renderAlbumText,
  type AlbumRenderPreset,
} from "./album-template-rules";
import type { AlbumChapterSpec } from "./album-layout";
import type { AlbumBoxData } from "./album-plan";
import type { AlbumEntryData } from "./albums";
import type { HawidStripData } from "./hawid-stock";

/** The album the sample sheet is a page of. The same stand-in the four text builders preview
 *  `{albumName}` against, so the name in the running head and the name in the token legend are one
 *  string rather than two that can drift. */
export const ALBUM_PREVIEW_ALBUM_NAME = ALBUM_PREVIEW_CONTEXT.albumName ?? "Polska Ludowa";

/** The catalogue prefix the sample's page ranges are written under — the footer's `{pageRange}`
 *  reads `PL 512-524`. An album is scoped to one area and its footer names the binder (#767). */
export const ALBUM_PREVIEW_AREA_PREFIX = "PL";

/** The vendor the sample numbers are stated under. A fixed id rather than a lookup: nothing here
 *  reaches a database, and `{catalog::}` prints the bare number anyway. */
const SAMPLE_VENDOR_ID = "sample-vendor";
const SAMPLE_VENDOR_ABBR = "Mi";

/** One stamp of the sample: its catalogue number, what it is called, and the size it was measured
 *  at. Millimetres, as a stamp's size always is (#763). */
interface SampleStamp {
  number: string;
  name: string;
  widthMm: number;
  heightMm: number;
}

/** One checklist of the sample, with the issue facts its heading tokens resolve from. */
interface SampleChecklist {
  id: string;
  name: string;
  issueName: string;
  year: number;
  month: number;
  day: number;
  stamps: readonly SampleStamp[];
}

/** One chapter of the sample — a year group, which is what a chapter is (#755/#767).
 *
 *  Stated rather than grouped at runtime. `planAlbumFrom` groups a real album's entries into runs of
 *  consecutive years because a real album's entries are dragged about; the sample is fixed data and
 *  grouping it again would be a second answer to a question that has none. */
interface SampleChapter {
  key: string;
  year: number;
  checklists: readonly SampleChecklist[];
}

/** One stamp, stated. */
function stamp(
  number: string,
  name: string,
  widthMm: number,
  heightMm: number,
): SampleStamp {
  return { number, name, widthMm, heightMm };
}

/** A run of `count` numbers from `from`, all the same size — a definitive or commemorative set, the
 *  ordinary shape of a checklist. */
function run(
  from: number,
  count: number,
  widthMm: number,
  heightMm: number,
  name: string,
): SampleStamp[] {
  return Array.from({ length: count }, (_, i) => ({
    number: String(from + i),
    name: count === 1 ? name : `${name} ${i + 1}`,
    widthMm,
    heightMm,
  }));
}

/**
 * The sample album, in the order it prints.
 *
 * Two chapters, seven checklists, eighteen stamps, every one of them the collector's own. See the
 * module header for what each block is doing; the short version is that no two of them exercise the
 * same setting, and that nothing here was made up.
 */
export const ALBUM_PREVIEW_CHAPTERS: readonly SampleChapter[] = [
  {
    key: "1950",
    year: 1950,
    checklists: [
      {
        id: "sample-1950-odbudowa",
        name: "Odbudowa Warszawy",
        issueName: "Odbudowa Warszawy",
        year: 1950,
        month: 4,
        day: 19,
        // `PL-1950.txt`: `1950, 19 IV. Odbudowa Warszawy`, three at 28 × 23. The shortest mount in
        // the sample, and the only one wider than it is tall.
        stamps: [
          stamp("513a", "Odbudowa Warszawy 5 zł", 28, 23),
          stamp("513b", "Odbudowa Warszawy 10 zł", 28, 23),
          stamp("513c", "Odbudowa Warszawy 15 zł", 28, 23),
        ],
      },
      {
        id: "sample-1950-bierut",
        name: "Bolesław Bierut",
        issueName: "Bolesław Bierut",
        year: 1950,
        month: 6,
        day: 25,
        // `PL-1950.txt`: `1950, 25 VI – 20 X. Bolesław Bierut`, **eight** at 22 × 26 — the definitive
        // run that fills a row of A4 and starts a second. His heading names a range of dates and
        // `{issueDate}` resolves the earliest of them, which is the 25 VI here.
        stamps: run(519, 8, 22, 26, "Bolesław Bierut"),
      },
      {
        id: "sample-1950-plan",
        name: "Plan 6-letni",
        issueName: "Plan sześcioletni",
        year: 1950,
        month: 7,
        day: 20,
        // `PL-1950.txt`: `1950, 20 VII. Plan 6-letni`, two at 26 × 32 — and his own numbering for
        // them is `527 I` and `527 II`, which is worth keeping: a sample of tidy integers would
        // never show what a Roman-suffixed number does to a box label.
        stamps: [
          stamp("527 I", "Plan 6-letni I", 26, 32),
          stamp("527 II", "Plan 6-letni II", 26, 32),
        ],
      },
      {
        id: "sample-1950-pokoj",
        name: "I Kongres Pokoju",
        issueName: "I Kongres Pokoju",
        year: 1950,
        month: 8,
        day: 31,
        // `PL-1950.txt`: `1950, 31 VIII. I Kongres Pokoju`, one at 26 × 32. Narrow, and next to the
        // block above it — which is what makes them a **band** at the default ceiling of two.
        stamps: [stamp("529", "I Kongres Pokoju", 26, 32)],
      },
    ],
  },
  {
    key: "1951",
    year: 1951,
    checklists: [
      {
        id: "sample-1951-festiwal",
        name: "III Światowy Festiwal Młodych Bojowników o Pokój w Berlinie",
        issueName: "III Światowy Festiwal Młodych Bojowników o Pokój",
        year: 1951,
        month: 8,
        day: 5,
        // `PL-1951.txt`: `1951, 5 VIII. III Światowy Festiwal…`, one at 32 × 45 — the tallest
        // ordinary mount in the sample, and a heading long enough to wrap at anything above about
        // 14 pt, which is the other thing this dialog is for.
        stamps: [stamp("566", "III Światowy Festiwal", 32, 45)],
      },
      {
        id: "sample-1951-muzyka",
        name: "Festiwal Muzyki Polskiej",
        issueName: "Festiwal Muzyki Polskiej",
        year: 1951,
        month: 11,
        day: 15,
        // `PL-1951.txt`: `1951, 15 XI. Festiwal Muzyki Polskiej`, two at 32 × 26.
        stamps: [
          stamp("571", "Festiwal Muzyki Polskiej I", 32, 26),
          stamp("572", "Festiwal Muzyki Polskiej II", 32, 26),
        ],
      },
      {
        id: "sample-1951-blok",
        name: "Ogólnokrajowy Zjazd PZF",
        issueName: "Ogólnokrajowy Zjazd PZF",
        year: 1951,
        month: 11,
        day: 15,
        // `PL-1951.txt`: `1951, 15 XI. Ogólnokrajowy Zjazd PZF`, one souvenir sheet at 91 × 120 —
        // **the oversize case** (#765), and it is his, on the same printed page as the two above it.
        // No hawid packet is 124 mm tall, so the box rule returns a pocket here for the reason it
        // would on real material rather than because a figure was chosen to produce one.
        //
        // **It closes the second chapter rather than the first, and that is arithmetic rather than
        // taste**: a block this tall is about 145 mm of page, and putting it in 1950 spilled the
        // sample onto a third sheet and left the whole of 1951 unseen behind a preview that draws
        // two.
        stamps: [stamp("Blok 12", "Ogólnokrajowy Zjazd PZF", 91, 120)],
      },
    ],
  },
];

/** Every sample checklist, in printing order. */
export const ALBUM_PREVIEW_CHECKLISTS: readonly SampleChecklist[] =
  ALBUM_PREVIEW_CHAPTERS.flatMap((c) => c.checklists);

/** The stamp id a sample number is known by. Prefixed so it can never collide with a cuid from the
 *  real collection, which matters the moment the preview is switched to a real album and back. */
export function albumPreviewStampId(number: string): string {
  return `sample-stamp-${number}`;
}

/** Every sample stamp, by the id above. */
export function albumPreviewStamps(): Map<string, SampleStamp> {
  const out = new Map<string, SampleStamp>();
  for (const checklist of ALBUM_PREVIEW_CHECKLISTS) {
    for (const stamp of checklist.stamps) out.set(albumPreviewStampId(stamp.number), stamp);
  }
  return out;
}

/**
 * One sample stamp as the token engine sees it.
 *
 * Everything a **box label** or a **checklist heading** can name is filled and everything a box
 * deliberately cannot is null: an album box is a catalogue slot, not an owned copy, so no copy
 * number, no condition, no location, no format (#766, and `ALBUM_BOX_LABEL_TOKENS` leaves those
 * tokens out for the same reason). A sample that stated a condition would preview a token the role
 * does not offer.
 */
function sampleCopy(checklist: SampleChecklist, stamp: SampleStamp): TitleTemplateCopy {
  return {
    name: stamp.name,
    catalogNumbers: [
      {
        vendorId: SAMPLE_VENDOR_ID,
        vendorAbbr: SAMPLE_VENDOR_ABBR,
        areaPrefix: ALBUM_PREVIEW_AREA_PREFIX,
        number: stamp.number,
        isPrimary: true,
      },
    ],
    year: checklist.year,
    condition: null,
    conditionAbbr: null,
    certificate: null,
    certificateAbbr: null,
    area: "Polska",
    location: null,
    ref: null,
    itemNo: null,
    itemNoPad: 4,
    subtype: null,
    format: null,
    formatAbbr: null,
    denomination: null,
    perforation: null,
    color: null,
    watermark: null,
    paper: null,
    printing: null,
    issuedDate: { year: checklist.year, month: checklist.month, day: checklist.day },
    issueName: checklist.issueName,
    issueYear: checklist.year,
    unknownVariant: false,
    variants: null,
    listedAs: null,
    // Nothing fell back: a sample is not resolved in any language, so there is no translation gap to
    // report and the preview draws no dotted rules that name a row nobody can open from here (#298).
    fallbacks: [],
  };
}

/** Every sample copy, by stamp id. */
export function albumPreviewCopies(): Map<string, TitleTemplateCopy> {
  const out = new Map<string, TitleTemplateCopy>();
  for (const checklist of ALBUM_PREVIEW_CHECKLISTS) {
    for (const stamp of checklist.stamps) {
      out.set(albumPreviewStampId(stamp.number), sampleCopy(checklist, stamp));
    }
  }
  return out;
}

/**
 * The sample checklists as album entries.
 *
 * No corrections on any of them — no extra space, no forced break, no box adjustment — because a
 * correction is a fact about one collector's page (#769) and the preview is judging a preset. A
 * sample that carried one would show a gap the template does not produce.
 */
export function albumPreviewEntries(): AlbumEntryData[] {
  return ALBUM_PREVIEW_CHECKLISTS.map((checklist, i) => ({
    id: checklist.id,
    checklistId: checklist.id,
    checklistName: checklist.name,
    issueId: checklist.id,
    issueName: checklist.issueName,
    year: checklist.year,
    sortOrder: i,
    spaceBeforeMm: 0,
    spaceAfterMm: 0,
    breakBefore: "auto",
    boxAdjustments: {},
    stampIds: checklist.stamps.map((s) => albumPreviewStampId(s.number)),
    ordersItsOwn: false,
    continuesPrintedPageId: null,
  }));
}

/**
 * The boxes of the given sample stamps, through **the box rule** (#765) and the collection's own
 * stock.
 *
 * The stock is the real drawer, passed in: a preview drawn against an imaginary one would show box
 * heights the printer will not produce, which is the confident-wrong-answer failure this whole
 * track is arranged against. An empty drawer makes every box a pocket, deliberately, and the
 * dialog says so rather than quietly showing a page that cannot be mounted.
 */
export function albumPreviewBoxes(
  preset: AlbumRenderPreset,
  stock: readonly HawidStripData[],
  stampIds: readonly string[],
): AlbumBoxData[] {
  const stamps = albumPreviewStamps();
  const copies = albumPreviewCopies();
  const margins = albumHawidMargins(preset);
  return stampIds.flatMap((stampId) => {
    const stamp = stamps.get(stampId);
    const copy = copies.get(stampId);
    if (!stamp || !copy) return [];
    const hawid = planHawidBox(
      { widthMm: stamp.widthMm, heightMm: stamp.heightMm },
      margins,
      stock,
    );
    const label = preset.boxLabelTemplate.trim()
      ? renderTitleTemplate(preset.boxLabelTemplate, [copy], {
          albumName: ALBUM_PREVIEW_ALBUM_NAME,
        })
      : "";
    return [
      {
        widthMm: hawid.widthMm,
        heightMm: hawid.heightMm,
        label,
        stampId,
        strip: hawid.strip,
        sizeSource: "stated" as const,
        sizeFromStampId: stampId,
        catalogNumber: stamp.number,
        catalogSortKey: catalogSortKeyOf(stamp.number),
        sizeAdjusted: false,
      },
    ];
  });
}

/**
 * The sample album as chapters the layout engine can pack.
 *
 * This is the whole of the sample's contribution to a preview: the boxes come from `planHawidBox`
 * and the headings from `renderAlbumText`, and everything after this point — bands, page breaks,
 * where a heading's ink falls — is `album-layout.ts`'s and nothing else's.
 *
 * No corrections and no printed sheets are expressible here, which is why the sample does not go
 * through `planAlbumFrom` on its way to `planAlbumPages`: that function's extra work is notes,
 * corrections and stepping over cards in a binder, and a template preset has none of the three. The
 * geometry — the part a second implementation would get wrong — is the same call either way.
 */
export function albumPreviewChapters(
  preset: AlbumRenderPreset,
  stock: readonly HawidStripData[],
): AlbumChapterSpec<AlbumBoxData>[] {
  const copies = albumPreviewCopies();
  const copiesOf = (checklists: readonly { stamps: readonly SampleStamp[] }[]) =>
    checklists
      .flatMap((c) => c.stamps)
      .map((s) => copies.get(albumPreviewStampId(s.number)))
      .filter((c): c is NonNullable<typeof c> => !!c);

  return ALBUM_PREVIEW_CHAPTERS.map((chapter) => ({
    key: chapter.key,
    heading: renderAlbumText(preset.chapterTemplate, copiesOf(chapter.checklists), {
      albumName: ALBUM_PREVIEW_ALBUM_NAME,
    }),
    blocks: chapter.checklists.map((checklist) => ({
      entryId: checklist.id,
      kind: "entry" as const,
      heading: renderAlbumText(preset.checklistTemplate, copiesOf([checklist]), {
        albumName: ALBUM_PREVIEW_ALBUM_NAME,
        checklistName: checklist.name,
      }),
      boxes: albumPreviewBoxes(
        preset,
        stock,
        checklist.stamps.map((s) => albumPreviewStampId(s.number)),
      ),
      printedPageIds: null,
      spaceBeforeMm: 0,
      spaceAfterMm: 0,
      breakBefore: "auto" as const,
    })),
  }));
}
