import "server-only";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import {
  albumRoleFace,
  type AlbumPlacedBox,
  type AlbumPlacedText,
  type AlbumPlannedPage,
  type AlbumRect,
} from "./album-layout";
import type { AlbumRenderPreset } from "./album-template-rules";
import { albumBaselineOffsetMm, albumTextMetrics, MM_TO_PT } from "./album-metrics";
import { loadAlbumFontBytes, AlbumFontError } from "./album-font-bytes";
import { isAlbumFaceId, albumFaceLabel } from "./album-fonts";
import {
  resolveAlbumPhotos,
  readAlbumPhotoBytes,
  getAlbumPhotosByIds,
  type AlbumPhotoRef,
} from "./album-photos";
import { getAlbumPageSnapshots } from "./album-printed-pages";
import type { AlbumSnapshotBox } from "./album-snapshot";
import {
  albumPdfFileName,
  parseAlbumPageSelection,
  AlbumPageSelectionError,
} from "./album-print-rules";
import type { AlbumPlanResult } from "./album-plan";
import type { AlbumData } from "./albums";

// The album as a PDF (#768): the plan (#767) drawn at true millimetres.
//
// ## This module draws. It does not decide.
//
// Every position, every size and every line of wrapped text arrives already computed by
// `album-layout.ts`. The only arithmetic here is the three conversions a sheet of paper needs and
// nothing else:
//
//   1. millimetres to points ({@link MM_TO_PT}, `72 / 25.4`) — the PDF's own unit;
//   2. the plan's top-left origin to the PDF's bottom-left one ({@link fromTop});
//   3. centring a line in the band the plan reserved for it, using the same measurer the plan used.
//
// That is the whole list on purpose. #769's canvas draws this same plan, and anything worked out
// here rather than in the layout is something the canvas can work out differently — which is a
// screen that shows a break the paper does not have. If you are about to add a fourth kind of
// arithmetic, it belongs in `album-layout.ts`.
//
// ## Why not the browser's print path
//
// The app prints lists through `@media print` (#643, #565) and nobody measures a list. Here the
// print dialog's *Fit to page* silently rescales the sheet by a few percent, the margins are the
// driver's, and the faces are whatever the machine has. Composing server-side removes all three and
// produces a file the collector can keep and re-print unchanged. What it cannot remove is the
// dialog: **the album must be printed at 100% / Actual size**, and `docs/user-guide/albums.md` says
// so where a collector will read it. A correctly composed PDF printed with scaling on is still a
// wrong card, and a ruler is the only way to tell.
//
// ## Faces are embedded, and a face we cannot embed is refused
//
// pdf-lib with `@pdf-lib/fontkit`, subsetting on (ADR-0046). The bytes come from
// `album-font-bytes.ts` — the same files `album-metrics.ts` measured, which is what makes the
// measured width and the printed width one number.
//
// A template naming a face this build no longer ships is **refused by name** rather than drawn in a
// substitute. The measurer falls back so a screen still renders (a plan is a derivation and costs
// nothing), but paper is not a derivation: printing a page in a face the collector did not choose,
// with advances the plan did not use, produces a card that is wrong in a way only a ruler finds.
//
// ## A photo fits and is never cropped
//
// `THUMB_OBJECT_FIT`'s rule, and stronger here: a box is size-true because a hawid is about to be
// cut to it, so a stamp cropped to fill one would be a printed lie about the object's proportions.
// The image is scaled by the smaller of the two ratios and centred in the mount.
//
// ## A printed sheet draws stored values
//
// A sheet already in a binder is not re-planned and not re-resolved. It arrives as an
// `AlbumPageSnapshot` (#778) — the placed boxes, the wrapped texts, the strip each box was cut from,
// the picture each mount printed, and **the render preset the sheet was set under** — and every one
// of those is drawn as it stands. Nothing about it falls back on the album's current values.
//
// That is why the preset is a parameter throughout this file rather than the album row: an album
// whose margins or faces have moved since a card was printed must still reprint *that card*, and a
// renderer reaching for `album.marginTopMm` while drawing a snapshot would produce a sheet that is
// neither the old card nor a new one. The album's own preset is simply the one a live page uses.

/** Millimetres of white between the two rules of a `double` page border.
 *
 *  A drawing convention rather than a template value, and the only one in this file. #766 modelled
 *  the border as three numbers — style, weight, inset — because what a printed album border is, on
 *  the pages this replaces, is one or two rules inset from the edge; the gap between the pair is
 *  what makes it read as a double rule at all, and a fourth column for it would be a setting nobody
 *  has asked for. It is safe to state here because **the border reserves no space in the plan**:
 *  the content area is bounded by the template's margins (10 mm by default) and the border is inset
 *  5 mm, so moving this number can never move a block. */
const DOUBLE_RULE_GAP_MM = 1.2;

/** Dash pattern for a `dashed` box outline, in millimetres: mark then gap. Read at 0.2 mm weight,
 *  which is the default, this is a visible dash rather than a broken line. */
const DASH_MM: [number, number] = [1.6, 1.0];

/** A `dotted` outline is the weight itself, twice as much gap — so the dot is square at whatever
 *  weight the template sets and the rhythm scales with it. */
const DOT_GAP_FACTOR = 2;

const INK = rgb(0, 0, 0);

/** Thrown when a page cannot be drawn as specified — a face that is no longer shipped, or a
 *  selection naming nothing printable. Never thrown for missing *content*: an unmeasured stamp, a
 *  box with no photo and a page with no catalog numbers are all ordinary pages. */
export class AlbumPdfError extends Error {}

/**
 * One sheet the document draws, whichever kind it is.
 *
 * A **live** sheet is a plan under the album's current preset. A **stored** one is a snapshot under
 * the preset it was printed with. From here down the two are the same shape and the renderer does
 * not branch on them again — except over pictures, where a live sheet resolves whichever image the
 * stamp has now and a stored one prints the `Photo.id` it printed.
 */
interface DrawableSheet {
  preset: AlbumRenderPreset;
  page: Extract<AlbumPlannedPage<{ widthMm: number; heightMm: number; label: string; stampId: string }>, { kind: "live" }>;
  footer: AlbumPlacedText | null;
  stored: boolean;
}

/** How a box finds its picture: a stored sheet by the `Photo.id` it printed, a live one by the stamp
 *  whose current picture it would print. Null for a mount with none. */
function imageKeyOf(
  sheet: DrawableSheet,
  box: AlbumPlacedBox<{ widthMm: number; heightMm: number; label: string; stampId: string }>
): string {
  if (!sheet.stored) return `stamp:${box.box.stampId}`;
  const photoId = (box.box as AlbumSnapshotBox).photoId;
  return photoId ? `photo:${photoId}` : "photo:";
}

export interface AlbumPdfResult {
  bytes: Uint8Array;
  fileName: string;
  /** Sheets actually drawn — never the plan's page count when a selection or a printed sheet took
   *  some out. */
  pageCount: number;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/** The plan measures y downward from the top of the sheet; a PDF measures it upward from the
 *  bottom. This is the whole of the conversion, and it is here rather than in the layout so the
 *  layout keeps the one direction a page is read and laid out in. */
function fromTop(preset: AlbumRenderPreset, yMm: number): number {
  return (preset.pageHeightMm - yMm) * MM_TO_PT;
}

function strokeRect(
  page: PDFPage,
  preset: AlbumRenderPreset,
  rect: AlbumRect,
  widthMm: number,
  dash?: number[]
) {
  page.drawRectangle({
    x: rect.xMm * MM_TO_PT,
    y: fromTop(preset, rect.yMm + rect.heightMm),
    width: rect.widthMm * MM_TO_PT,
    height: rect.heightMm * MM_TO_PT,
    borderColor: INK,
    borderWidth: widthMm * MM_TO_PT,
    borderDashArray: dash,
  });
}

/** A face's embedded font, embedded once per document. */
type FontResolver = (faceId: string) => PDFFont;

/**
 * Draw a run of already-wrapped text into the band the plan reserved for it.
 *
 * The lines are drawn as given and **never re-wrapped**: the plan decided where they break, and a
 * renderer that re-wrapped could reach a different answer at the same width. Each line is centred
 * with the same measurer the plan wrapped with, and sits on the baseline
 * {@link albumBaselineOffsetMm} puts it on — also the measurer's, so #769's canvas and this file
 * cannot place the ink differently.
 */
function drawText(
  page: PDFPage,
  preset: AlbumRenderPreset,
  text: AlbumPlacedText,
  fontFor: FontResolver
) {
  const { face, sizePt } = albumRoleFace(preset, text.role);
  const font = fontFor(face);
  const lineMm = albumTextMetrics.lineHeightMm(face, sizePt);
  const baselineMm = albumBaselineOffsetMm(face, sizePt);
  text.lines.forEach((line, i) => {
    if (!line) return;
    const widthMm = albumTextMetrics.measureMm(line, face, sizePt);
    page.drawText(line, {
      x: (text.xMm + (text.widthMm - widthMm) / 2) * MM_TO_PT,
      y: fromTop(preset, text.yMm + i * lineMm + baselineMm),
      size: sizePt,
      font,
      color: INK,
    });
  });
}

/** The page's decorative border: nothing, one rule, or two. Inset from the sheet's edge and clear
 *  of the content by construction (see {@link DOUBLE_RULE_GAP_MM}). */
function drawBorder(page: PDFPage, preset: AlbumRenderPreset) {
  if (preset.borderStyle === "none" || preset.borderWidthMm <= 0) return;
  const rule = (insetMm: number) =>
    strokeRect(
      page,
      preset,
      {
        xMm: insetMm,
        yMm: insetMm,
        widthMm: preset.pageWidthMm - 2 * insetMm,
        heightMm: preset.pageHeightMm - 2 * insetMm,
      },
      preset.borderWidthMm
    );
  rule(preset.borderInsetMm);
  if (preset.borderStyle === "double") {
    rule(preset.borderInsetMm + preset.borderWidthMm + DOUBLE_RULE_GAP_MM);
  }
}

/** The outline around one mount, in the template's own style. `none` is a real choice: a hawid is
 *  visible enough on paper, and a page whose boxes are only implied by the mounts is a legitimate
 *  album (#766). */
function drawBoxOutline(page: PDFPage, preset: AlbumRenderPreset, rect: AlbumRect) {
  if (preset.boxBorderStyle === "none" || preset.boxBorderWidthMm <= 0) return;
  const w = preset.boxBorderWidthMm;
  const dash =
    preset.boxBorderStyle === "dashed"
      ? DASH_MM.map((mm) => mm * MM_TO_PT)
      : preset.boxBorderStyle === "dotted"
        ? [w * MM_TO_PT, w * DOT_GAP_FACTOR * MM_TO_PT]
        : undefined;
  strokeRect(page, preset, rect, w, dash);
}

/**
 * Draw a picture inside a mount, **fitted and never cropped**.
 *
 * Scaled by the smaller of the two ratios and centred, so the printed picture has the object's own
 * proportions. The alternative — filling the mount — would put a stamp of the wrong shape inside a
 * box the collector is about to cut a hawid to.
 */
function drawPhoto(page: PDFPage, preset: AlbumRenderPreset, rect: AlbumRect, image: PDFImage) {
  const scale = Math.min(rect.widthMm / image.width, rect.heightMm / image.height);
  const widthMm = image.width * scale;
  const heightMm = image.height * scale;
  page.drawImage(image, {
    x: (rect.xMm + (rect.widthMm - widthMm) / 2) * MM_TO_PT,
    y: fromTop(preset, rect.yMm + (rect.heightMm - heightMm) / 2 + heightMm),
    width: widthMm * MM_TO_PT,
    height: heightMm * MM_TO_PT,
    opacity: preset.photoOpacityPercent / 100,
  });
}

// ── The document ─────────────────────────────────────────────────────────────

/**
 * Image bytes in the form pdf-lib can embed.
 *
 * It handles JPEG and PNG directly and nothing else. WebP is an accepted upload (`ACCEPTED_MIMES`),
 * so it is transcoded through `sharp` — already how every other pixel in this app is moved — and to
 * PNG rather than JPEG, so an image with an alpha channel keeps it.
 *
 * **The copy into a fresh `Uint8Array` is not defensive tidying.** pdf-lib's embedders read the
 * bytes through `new DataView(data.buffer)`, from offset zero — and a Node `Buffer` under about
 * 4 kB is a *view into a shared 8 kB pool*, so `.buffer` is the pool and offset zero is somebody
 * else's bytes. A perfectly valid JPEG then fails with "SOI not found in JPEG", and only for small
 * images, which is exactly the size a stamp scan of a definitive comes out at.
 */
async function toEmbeddable(bytes: Buffer, mime: string): Promise<{ bytes: Uint8Array; png: boolean }> {
  if (mime === "image/jpeg") return { bytes: new Uint8Array(bytes), png: false };
  if (mime === "image/png") return { bytes: new Uint8Array(bytes), png: true };
  return { bytes: new Uint8Array(await sharp(bytes).png().toBuffer()), png: true };
}

/**
 * Render an album's plan — all of it, or the sheets `selection` names — to a PDF.
 *
 * Takes a plan rather than an album id: `planAlbum` is one read that produces the entries, the
 * boxes and the sheets, and planning twice would be two answers to a question that has one. The
 * screen and the file therefore agree by construction.
 */
export async function renderAlbumPdf(
  plan: AlbumPlanResult,
  selection?: string | null
): Promise<AlbumPdfResult> {
  const album = plan.album;
  let indices: number[];
  try {
    indices = parseAlbumPageSelection(selection, plan.pages.length);
  } catch (err) {
    // One error type reaches the route, whichever half raised it: to the collector a selection
    // that names nothing and a face that cannot be embedded are both "this will not print".
    if (err instanceof AlbumPageSelectionError) throw new AlbumPdfError(err.message);
    throw err;
  }
  const selected = indices.map((i) => plan.pages[i]);
  if (selected.length === 0) throw new AlbumPdfError("This album has no sheets to print.");

  // A printed sheet is drawn from its stored snapshot, so reprinting one after a year produces the
  // same card. Read here rather than in `planAlbum`, which lists a few hundred sheets and would
  // otherwise load a page of geometry for every one of them to show a list.
  const snapshots = await getAlbumPageSnapshots(
    album.id,
    selected.flatMap((p) => (p.layout.kind === "printed" ? [p.layout.printedPageId] : []))
  );
  const pages: DrawableSheet[] = selected.map((planPage) => {
    if (planPage.layout.kind !== "printed") {
      return {
        preset: album,
        page: planPage.layout,
        footer: planPage.footer,
        stored: false,
      };
    }
    const snapshot = snapshots.get(planPage.layout.printedPageId);
    if (!snapshot) {
      throw new AlbumPdfError(
        `The printed sheet ${planPage.range || "in this album"} has no stored contents and cannot be redrawn.`
      );
    }
    return { preset: snapshot.preset, page: snapshot.page, footer: snapshot.footer, stored: true };
  });

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(album.name);
  doc.setCreator("Stamporama");
  doc.setProducer("Stamporama");

  // Every face the sheets can ask for, embedded up front — see {@link embedFaces} — so the drawing
  // below is synchronous and a page's contents cannot depend on the order anything resolved in.
  // Every sheet's **own** preset, not the album's: a printed card is set in the faces it was printed
  // in, which an album that has since changed template no longer names anywhere.
  const fonts = await embedFaces(doc, pages.map((p) => p.preset));
  const fontFor: FontResolver = (faceId) => {
    const held = fonts.get(faceId);
    // Unreachable: a role's face is a template column and `embedFaces` covered all five. Stated
    // rather than asserted away, because a sixth role added later would land exactly here.
    if (!held) throw new AlbumPdfError(`No embedded face for "${faceId}".`);
    return held;
  };

  const images = await loadImages(album, pages, doc);

  for (const sheet of pages) {
    const { preset, page: layout } = sheet;
    const page = doc.addPage([preset.pageWidthMm * MM_TO_PT, preset.pageHeightMm * MM_TO_PT]);

    drawBorder(page, preset);
    if (layout.title) drawText(page, preset, layout.title, fontFor);
    if (layout.chapter) drawText(page, preset, layout.chapter, fontFor);

    // Continuation headings already carry their `[2]`, `[3]` — the plan measured the marked string
    // and reserved room for it (`albumContinuationHeading`), so there is nothing to append here.
    for (const heading of layout.headings) drawText(page, preset, heading, fontFor);

    for (const box of layout.boxes) {
      const rect: AlbumRect = {
        xMm: box.xMm,
        yMm: box.yMm,
        widthMm: box.widthMm,
        heightMm: box.heightMm,
      };
      if (preset.printPhotos && preset.photoOpacityPercent > 0) {
        const image = images.get(imageKeyOf(sheet, box));
        if (image) drawPhoto(page, preset, rect, image);
      }
      drawBoxOutline(page, preset, rect);
      if (box.label) drawText(page, preset, box.label, fontFor);
    }

    if (sheet.footer) drawText(page, preset, sheet.footer, fontFor);
  }

  return {
    bytes: await doc.save(),
    fileName: albumPdfFileName(album.name, plan.pages.length, indices),
    pageCount: pages.length,
  };
}

/**
 * Embed every face the album's five roles name.
 *
 * Five template columns rather than a scan of the pages: the set is known before a box is read, so
 * the whole of pdf-lib's asynchrony is spent here and the drawing that follows is synchronous.
 *
 * Subsetting is on. The spike printed and measured a subset sheet with diacritics through fontkit,
 * so a page of Polish or Greek costs a few kilobytes of glyphs rather than a whole 400 kB face per
 * style used.
 */
async function embedFaces(
  doc: PDFDocument,
  presets: readonly AlbumRenderPreset[]
): Promise<Map<string, PDFFont>> {
  const fonts = new Map<string, PDFFont>();
  const roles = ["title", "chapter", "heading", "label", "footer"] as const;
  for (const preset of presets) {
    for (const role of roles) {
      const { face } = albumRoleFace(preset, role);
      if (fonts.has(face)) continue;
      if (!isAlbumFaceId(face)) {
        throw new AlbumPdfError(
          `This sheet is set in "${albumFaceLabel(face)}", which this version no longer ships. ` +
            `Choose a face it does in the album's template before printing.`
        );
      }
      try {
        fonts.set(face, await doc.embedFont(loadAlbumFontBytes(face), { subset: true }));
      } catch (err) {
        if (err instanceof AlbumFontError) throw new AlbumPdfError(err.message);
        throw err;
      }
    }
  }
  return fonts;
}

/**
 * Every picture the chosen sheets print, read once and embedded once — a stamp appearing on two
 * sheets of one file is one embedded image, not two.
 *
 * The two kinds of sheet ask two different questions, and the difference is the whole of what makes
 * a printed card reproducible. A **live** sheet asks *what picture does this stamp have* and gets
 * whatever has been scanned by now. A **stored** sheet asks for the `Photo.id` its mount printed, so
 * a card reprinted a year later carries the picture it carried — and a picture that arrived since is
 * a divergence to be reported (#778) rather than a silent substitution.
 */
async function loadImages(
  album: AlbumData,
  sheets: readonly DrawableSheet[],
  doc: PDFDocument
): Promise<Map<string, PDFImage>> {
  const out = new Map<string, PDFImage>();

  const stampIds: string[] = [];
  const photoIds: string[] = [];
  for (const sheet of sheets) {
    // A template that prints no pictures reads none, per sheet — a printed card set under one keeps
    // its empty mounts however the album is set now.
    if (!sheet.preset.printPhotos || sheet.preset.photoOpacityPercent <= 0) continue;
    for (const box of sheet.page.boxes) {
      if (!sheet.stored) stampIds.push(box.box.stampId);
      else {
        const photoId = (box.box as AlbumSnapshotBox).photoId;
        if (photoId) photoIds.push(photoId);
      }
    }
  }
  if (stampIds.length === 0 && photoIds.length === 0) return out;

  const wanted = new Map<string, AlbumPhotoRef>();
  if (stampIds.length > 0) {
    for (const [stampId, ref] of await resolveAlbumPhotos(album.collectionId, stampIds)) {
      wanted.set(`stamp:${stampId}`, ref);
    }
  }
  if (photoIds.length > 0) {
    for (const [photoId, ref] of await getAlbumPhotosByIds(photoIds)) {
      wanted.set(`photo:${photoId}`, ref);
    }
  }

  // One embed per distinct stored image, so a stamp on two sheets costs one copy of the bytes.
  const byKey = new Map<string, PDFImage>();
  for (const [key, ref] of wanted) {
    const held = byKey.get(ref.storageKey);
    if (held) {
      out.set(key, held);
      continue;
    }
    try {
      const read = await readAlbumPhotoBytes(ref);
      const { bytes, png } = await toEmbeddable(read.bytes, read.mime);
      const image = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      byKey.set(ref.storageKey, image);
      out.set(key, image);
    } catch (err) {
      // A picture that cannot be read leaves an empty mount, which is what an unowned slot looks
      // like anyway: refusing the whole sheet over one unreadable file would cost the collector the
      // other forty boxes on it. Logged rather than swallowed, though — a page quietly losing its
      // pictures is exactly the kind of failure nobody reports and nobody can reproduce.
      console.warn(`[album-pdf] no picture for ${key}: ${String(err)}`);
    }
  }
  return out;
}
