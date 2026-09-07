import "server-only";
import {
  albumPlanContext,
  planAlbumFrom,
  pageRange,
  type AlbumBoxData,
  type AlbumPlanPage,
} from "./album-plan";
import { planAlbumPages, type AlbumPlan } from "./album-layout";
import { albumTextMetrics } from "./album-metrics";
import { liveSheet, type AlbumEditorSheet, type AlbumSheetSource } from "./album-editor";
import { renderAlbumText, type AlbumRenderPreset } from "./album-template-rules";
import type { AlbumData } from "./albums";
import { getHawidStrips } from "./hawid-stock";
import { resolveAlbumPhotos } from "./album-photos";
import {
  ALBUM_PREVIEW_ALBUM_NAME,
  ALBUM_PREVIEW_AREA_PREFIX,
  albumPreviewChapters,
  albumPreviewCopies,
  albumPreviewEntries,
} from "./album-preview-sample";

// The album template's live preview (#795): the sheet the dialog draws while its thirty-odd numbers
// are being changed.
//
// ## It plans; it does not draw, and it computes no geometry of its own
//
// Every millimetre on the preview comes from `planAlbumPages`, and the sheet handed to the canvas is
// built by `liveSheet` — the same function the page editor (#769) draws a live album page with.
// What is left for this module is fetching the drawer, naming the pages and choosing which two to
// show.
//
// That is the rule `hawid.ts` states for itself, and it bites harder here than anywhere: **a preview
// that disagreed with the PDF would be worse than no preview at all — it would be a confident wrong
// answer.** The collector is about to change a number because of what he sees on this sheet, and a
// second implementation of the packing would let him tune the template against a page the printer
// never produces.
//
// ## The sample stops at `planAlbumPages`; a real album goes through `planAlbumFrom`
//
// The difference is not geometry — both reach the same packer — it is everything `planAlbumFrom`
// does *around* it: filing the collector's notes, carrying his corrections, and stepping over cards
// already in a binder. A preset has none of the three, and a sample built to have them would be
// inventing them. So the sample states its chapters (`album-preview-sample.ts`) and hands them
// straight to the packer, which is also what lets the whole sample be reasoned about in
// `test:unit` — the reference the tests plan against is the one the dialog draws, rather than a
// second one that agrees with it today.
//
// ## Two sources, and the second is not a fallback
//
// The sample page is synthetic by default, and pointing it at a real album is offered beside it.
// Both, decided by the collector on 2026-09-06: synthetic is what makes the preview work in a
// collection with no albums yet — which is exactly when a template is first set up — and a real
// album is what makes it worth trusting once there is material to judge.
//
// The real-album path substitutes **the preset being edited** for the album's own and re-plans. That
// is not a template being applied to the album: nothing is written, the album keeps its own copied
// values (#308's rule, #766), and the next read of that album is unaffected.
//
// ## The stock is real on both paths
//
// A box's height is the height of the shortest strip in the drawer the piece fits into (#765), so a
// preview drawn against an imaginary drawer would show heights the printer will not produce. Both
// paths read `getHawidStrips`, and an empty drawer makes every box a pocket — which the dialog says
// out loud rather than leaving a page of pocket mounts to be puzzled over.
//
// ## Printed sheets are skipped, not redrawn
//
// A card in a binder is set in the preset it was printed under (ADR-0047 §1) and drawing it beneath
// a template being edited would show the collector a sheet that exists nowhere. The real-album path
// therefore previews the album's **live** pages, and says how many printed ones it stepped over.

/** How many sheets the preview shows. Two, because a chapter heading, the space above a heading and
 *  a block that did not fit only show themselves across a page boundary — and the sample produces
 *  exactly two by having two chapters, so no pagination is built for it (#795). */
export const ALBUM_PREVIEW_SHEETS = 2;

/** What the dialog draws, and everything it has to be able to say about where the sheet came from. */
export interface AlbumTemplatePreview {
  sheets: AlbumEditorSheet[];
  /** How many sheets the whole plan has, so the dialog can say it is showing the first two of nine
   *  rather than implying the album is two pages long. */
  totalSheets: number;
  /** True when the collection has described no hawid stock, which makes **every** box a pocket. */
  emptyStock: boolean;
  /** Printed sheets the preview stepped over (#778). Zero on the sample, which has none. */
  printedSheets: number;
  /** The album the preview drew, for the dialog's own label. The sample's stand-in name on the
   *  synthetic path. */
  albumName: string;
}

/**
 * The sample album as a source of sheets.
 *
 * There is no `Album` row behind a template, and writing one to preview it would put a fabricated
 * album in the collector's list — so the four things a sheet is built from are assembled here
 * instead (`AlbumSheetSource`). The preset arrives whole: an `Album` *is* an `AlbumRenderPreset`
 * plus an id, a name and a language (#766), which is exactly what makes this possible without a
 * second definition of what an album looks like.
 */
function sampleSheetSource(preset: AlbumRenderPreset): AlbumSheetSource {
  const album: AlbumData = {
    ...preset,
    id: "album-template-preview",
    collectionId: "album-template-preview",
    collectionAreaId: "album-template-preview",
    name: ALBUM_PREVIEW_ALBUM_NAME,
    // The album's language is the album's, never the template's (#767). A sample has no album, so
    // it has no language either, and every sample copy is resolved in none — which is also why it
    // reports no translation gaps.
    language: "",
  };
  return {
    album,
    entries: albumPreviewEntries(),
    textBlocks: [],
    // A sample resolves in no language, so nothing can have fallen back to a default one (#298).
    textGaps: () => [],
  };
}

/**
 * Name each sample page and render its footer into the band the layout reserved — the same two acts
 * `albumPlanContext`'s own `finish` performs, through the same two functions, so a sample sheet and
 * a real one are named and footed by one rule.
 */
function finishSamplePages(
  preset: AlbumRenderPreset,
  plan: AlbumPlan<AlbumBoxData>,
): AlbumPlanPage[] {
  const copies = albumPreviewCopies();
  return plan.pages.map((page): AlbumPlanPage => {
    // A synthetic album has no printed sheets, so every page of this plan is live. The branch is
    // still written out because `AlbumPlannedPage` has two shapes and a cast would be a claim rather
    // than a check.
    if (page.kind === "printed") return { range: "", layout: page, footer: null };
    const range = pageRange(
      page.boxes.map((b) => b.box),
      ALBUM_PREVIEW_AREA_PREFIX,
    );
    if (!page.footer) return { range, layout: page, footer: null };
    const text = renderAlbumText(
      preset.footerTemplate,
      page.boxes
        .map((b) => copies.get(b.box.stampId))
        .filter((c): c is NonNullable<typeof c> => !!c),
      { albumName: ALBUM_PREVIEW_ALBUM_NAME, pageRange: range },
    );
    return {
      range,
      layout: page,
      footer: text ? { role: "footer", lines: [text], ...page.footer } : null,
    };
  });
}

/** The first {@link ALBUM_PREVIEW_SHEETS} **live** pages of a plan, drawn. */
function drawSheets(
  pages: readonly AlbumPlanPage[],
  context: AlbumSheetSource,
  photoIdFor: (stampId: string) => string | null,
): { sheets: AlbumEditorSheet[]; printedSheets: number } {
  const sheets: AlbumEditorSheet[] = [];
  let printedSheets = 0;
  for (let i = 0; i < pages.length; i += 1) {
    if (pages[i].layout.kind === "printed") {
      printedSheets += 1;
      continue;
    }
    if (sheets.length >= ALBUM_PREVIEW_SHEETS) continue;
    const sheet = liveSheet(pages[i], i + 1, context, photoIdFor);
    if (sheet) sheets.push(sheet);
  }
  return { sheets, printedSheets };
}

/**
 * The sample page, under the preset being edited.
 *
 * `ownerId` and `collectionId` are here for the stock alone, and `getHawidStrips` checks ownership
 * of the collection before it reads a row.
 */
export async function albumTemplateSamplePreview(
  ownerId: string,
  collectionId: string,
  preset: AlbumRenderPreset,
): Promise<AlbumTemplatePreview> {
  const stock = await getHawidStrips(ownerId, collectionId);
  const pages = finishSamplePages(
    preset,
    planAlbumPages(
      albumPreviewChapters(preset, stock),
      preset,
      ALBUM_PREVIEW_ALBUM_NAME,
      albumTextMetrics,
    ),
  );
  // No photos on the sample: a mount's picture is a fact about a stamp somebody owns, and the sample
  // stamps are not owned. The template's own photo settings are judged on a real album.
  const { sheets } = drawSheets(pages, sampleSheetSource(preset), () => null);
  return {
    sheets,
    totalSheets: pages.length,
    emptyStock: stock.length === 0,
    printedSheets: 0,
    albumName: ALBUM_PREVIEW_ALBUM_NAME,
  };
}

/**
 * A real album's pages, under the preset being edited.
 *
 * Nothing is written and the album keeps its own values: this re-plans in memory with the dialog's
 * preset substituted, which is what lets the collector see his own stamps under a template he has
 * not saved yet. Null when the album is not his or no longer exists.
 */
export async function albumTemplateAlbumPreview(
  ownerId: string,
  albumId: string,
  preset: AlbumRenderPreset,
): Promise<AlbumTemplatePreview | null> {
  const context = await albumPlanContext(ownerId, albumId, preset);
  if (!context) return null;
  const plan = planAlbumFrom(context);
  const shown = plan.pages
    .filter((p) => p.layout.kind === "live")
    .slice(0, ALBUM_PREVIEW_SHEETS);
  const photos = await resolveAlbumPhotos(
    context.album.collectionId,
    shown.flatMap((p) =>
      p.layout.kind === "live" ? p.layout.boxes.map((b: { box: AlbumBoxData }) => b.box.stampId) : [],
    ),
  );
  const { sheets, printedSheets } = drawSheets(
    plan.pages,
    context,
    (stampId) => photos.get(stampId)?.id ?? null,
  );
  return {
    sheets,
    totalSheets: plan.pages.length,
    emptyStock: plan.emptyStock,
    printedSheets,
    albumName: context.album.name,
  };
}
