import "server-only";
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  PDFOperator,
  PDFOperatorNames,
  appendBezierCurve,
  closePath,
  concatTransformationMatrix,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setStrokingRgbColor,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import {
  albumLineStartMm,
  albumPlacedTextFace,
  albumRoleFace,
  type AlbumPlacedBox,
  type AlbumPlacedText,
  type AlbumPlannedPage,
  type AlbumRect,
} from "./album-layout";
import {
  readAlbumPictureBytes,
  resolveAlbumPictures,
  type AlbumPictureRef,
} from "./album-pictures";
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
import { albumBoxOutline } from "./album-box-outline";
import { albumFrame, type AlbumFrameMatrix } from "./album-frame";
import type { AlbumOrnamentDrawing, AlbumOrnamentPath } from "./album-ornament-svg";
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
  /** The corner ornament the frame prints: the album's for a live sheet, the card's own copy for a
   *  stored one (#1427). */
  frameOrnament: AlbumOrnamentDrawing | null;
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
  // A free page's text is set in its role's face at a size of its own, and aligned as the collector
  // chose (#1429); everything else on a sheet is its role's size, centred.
  const { face, sizePt } = albumPlacedTextFace(preset, text);
  const font = fontFor(face);
  const lineMm = albumTextMetrics.lineHeightMm(face, sizePt);
  const baselineMm = albumBaselineOffsetMm(face, sizePt);
  text.lines.forEach((line, i) => {
    if (!line) return;
    const widthMm = albumTextMetrics.measureMm(line, face, sizePt);
    page.drawText(line, {
      x: albumLineStartMm(text, widthMm) * MM_TO_PT,
      y: fromTop(preset, text.yMm + i * lineMm + baselineMm),
      size: sizePt,
      font,
      color: INK,
    });
  });
}

/** The page's frame (#766, #1427): its rules, and an ornament at each corner when it has one — all
 *  of it placed by `album-frame.ts`, which the canvas draws from too, the top rule broken around a
 *  title set into it (#1428) and the bottom one around a footer (#1457). Nothing here decides where
 *  anything goes. */
function drawFrame(
  page: PDFPage,
  preset: AlbumRenderPreset,
  ornament: AlbumOrnamentDrawing | null,
  title: AlbumRect | null,
  footer: AlbumRect | null
) {
  const frame = albumFrame(preset, ornament, title, footer);
  for (const rect of frame.rects) strokeRect(page, preset, rect, frame.lineMm);
  for (const points of frame.paths) {
    // One stroke with mitred joins, so its corners meet as a rectangle's do; butt ends at the gap.
    const ops: PDFOperator[] = [
      pushGraphicsState(),
      setStrokingColor(INK),
      setLineWidth(frame.lineMm * MM_TO_PT),
      setLineCap(LineCapStyle.Butt),
      setLineJoin(LineJoinStyle.Miter),
    ];
    points.forEach((pt, i) => {
      const x = pt.xMm * MM_TO_PT;
      const y = fromTop(preset, pt.yMm);
      ops.push(i === 0 ? moveTo(x, y) : lineTo(x, y));
    });
    ops.push(PDFOperator.of(PDFOperatorNames.StrokePath), popGraphicsState());
    page.pushOperators(...ops);
  }
  for (const line of frame.lines) {
    page.drawLine({
      start: { x: line.x1Mm * MM_TO_PT, y: fromTop(preset, line.y1Mm) },
      end: { x: line.x2Mm * MM_TO_PT, y: fromTop(preset, line.y2Mm) },
      thickness: frame.lineMm * MM_TO_PT,
      color: INK,
      // Butt ends: a rule stops exactly where the ornament's frame starts.
      lineCap: LineCapStyle.Butt,
    });
  }
  if (!ornament) return;
  for (const placed of frame.ornaments) drawOrnament(page, preset, ornament, placed.matrix);
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
}

const LINE_CAP = { butt: LineCapStyle.Butt, round: LineCapStyle.Round, square: LineCapStyle.Projecting };
const LINE_JOIN = { miter: LineJoinStyle.Miter, round: LineJoinStyle.Round, bevel: LineJoinStyle.Bevel };

/** How one outline is painted, as the PDF operator that ends it. */
function paintOperator(path: AlbumOrnamentPath): PDFOperator {
  const evenOdd = path.fillRule === "evenodd";
  if (path.fill && path.stroke) {
    return PDFOperator.of(evenOdd ? PDFOperatorNames.FillEvenOddAndStroke : PDFOperatorNames.FillNonZeroAndStroke);
  }
  if (path.fill) return PDFOperator.of(evenOdd ? PDFOperatorNames.FillEvenOdd : PDFOperatorNames.FillNonZero);
  return PDFOperator.of(PDFOperatorNames.StrokePath);
}

/**
 * One corner ornament, as vectors in true millimetres.
 *
 * The drawing is already four commands and nothing else (`album-ornament-svg.ts`), so it is written
 * out as the PDF's own path operators under one transformation: the corner's placement from
 * `album-frame.ts` — mirror included — composed with the millimetre-to-point, top-to-bottom map every
 * other thing on the sheet goes through. Line weights are in the drawing's units and scale with it,
 * as they do on the canvas.
 */
function drawOrnament(
  page: PDFPage,
  preset: AlbumRenderPreset,
  drawing: AlbumOrnamentDrawing,
  placement: AlbumFrameMatrix
) {
  const [a, b, c, d, e, f] = placement;
  const k = MM_TO_PT;
  const h = preset.pageHeightMm * k;
  // [k 0 0 -k 0 h] ∘ placement: millimetres from the top-left to points from the bottom-left.
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    concatTransformationMatrix(k * a, -k * b, k * c, -k * d, k * e, h - k * f),
  ];
  for (const path of drawing.paths) {
    if (path.fill) ops.push(setFillingRgbColor(...hexToRgb(path.fill)));
    if (path.stroke) {
      ops.push(
        setStrokingRgbColor(...hexToRgb(path.stroke)),
        setLineWidth(path.strokeWidth),
        setLineCap(LINE_CAP[path.lineCap]),
        setLineJoin(LINE_JOIN[path.lineJoin])
      );
    }
    for (const cmd of path.commands) {
      if (cmd[0] === "M") ops.push(moveTo(cmd[1], cmd[2]));
      else if (cmd[0] === "L") ops.push(lineTo(cmd[1], cmd[2]));
      else if (cmd[0] === "C") ops.push(appendBezierCurve(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]));
      else ops.push(closePath());
    }
    ops.push(paintOperator(path));
  }
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}

/** The outline around one mount, in the template's own style, **inside** the box — its outer edge
 *  is the box's size, so a hawid cut to size covers it (#1466, `album-box-outline.ts`). `none` is a
 *  real choice: a hawid is visible enough on paper, and a page whose boxes are only implied by the
 *  mounts is a legitimate album (#766). */
function drawBoxOutline(page: PDFPage, preset: AlbumRenderPreset, rect: AlbumRect) {
  const outline = albumBoxOutline(preset, rect);
  if (!outline) return;
  const w = outline.weightMm;
  const dash =
    preset.boxBorderStyle === "dashed"
      ? DASH_MM.map((mm) => mm * MM_TO_PT)
      : preset.boxBorderStyle === "dotted"
        ? [w * MM_TO_PT, w * DOT_GAP_FACTOR * MM_TO_PT]
        : undefined;
  strokeRect(page, preset, outline.rect, w, dash);
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

/**
 * A free page's picture (#1429) in the rectangle the plan gave it: as **vectors** — its outlines
 * written as path operators, through {@link drawOrnament}'s one transformation, scaled so its `viewBox`
 * fills the rectangle — or as a raster, fitted and never cropped. The rectangle already has the
 * picture's own proportions, so the two agree; the fit is only what keeps a rounding tenth from
 * stretching it.
 */
function drawPicture(
  page: PDFPage,
  preset: AlbumRenderPreset,
  rect: AlbumRect,
  picture: AlbumPictureRef,
  image: PDFImage | undefined
) {
  if (picture.drawing) {
    const vb = picture.drawing.viewBox;
    const scale = Math.min(rect.widthMm / vb.width, rect.heightMm / vb.height);
    const x = rect.xMm + (rect.widthMm - vb.width * scale) / 2 - vb.x * scale;
    const y = rect.yMm + (rect.heightMm - vb.height * scale) / 2 - vb.y * scale;
    drawOrnament(page, preset, picture.drawing, [scale, 0, 0, scale, x, y]);
    return;
  }
  if (!image) return;
  const scale = Math.min(rect.widthMm / image.width, rect.heightMm / image.height);
  const widthMm = image.width * scale;
  const heightMm = image.height * scale;
  page.drawImage(image, {
    x: (rect.xMm + (rect.widthMm - widthMm) / 2) * MM_TO_PT,
    y: fromTop(preset, rect.yMm + (rect.heightMm - heightMm) / 2 + heightMm),
    width: widthMm * MM_TO_PT,
    height: heightMm * MM_TO_PT,
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
      // A frame naming an upload the collection no longer has is refused by name, as a face this
      // build no longer ships is: a card printed without the corners the collector chose is wrong
      // in a way nobody sees until it is in the binder.
      if (album.frameOrnament !== "none" && !plan.frameOrnament) {
        throw new AlbumPdfError(
          "This album's frame names a corner ornament the collection no longer has. " +
            "Choose another in the album's own values before printing."
        );
      }
      return {
        preset: album,
        frameOrnament: plan.frameOrnament,
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
    return {
      preset: snapshot.preset,
      frameOrnament: snapshot.frameOrnament,
      page: snapshot.page,
      footer: snapshot.footer,
      stored: true,
    };
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
  const pictures = await loadPictures(album, pages, doc);

  for (const sheet of pages) {
    const { preset, page: layout } = sheet;
    const page = doc.addPage([preset.pageWidthMm * MM_TO_PT, preset.pageHeightMm * MM_TO_PT]);

    // The footer as rendered, not the band: set into the frame line, it is its text's width (#1457).
    drawFrame(page, preset, sheet.frameOrnament, layout.title, sheet.footer);
    if (layout.title) drawText(page, preset, layout.title, fontFor);
    if (layout.chapter) drawText(page, preset, layout.chapter, fontFor);

    // A page without stamps (#1429): the collector's own pictures and texts, in their drawing order,
    // where he put them.
    for (const el of layout.free?.elements ?? []) {
      if (el.kind === "text") {
        drawText(page, preset, el, fontFor);
        continue;
      }
      const held = pictures.get(el.pictureId);
      if (held) drawPicture(page, preset, el, held.picture, held.image);
    }

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
 * Every library picture the chosen sheets' free pages place (#1429), resolved once and — for a raster —
 * embedded once, whichever sheet it is on and however many.
 *
 * A live page and a card name a picture the same way, by its library id: a library picture is never
 * changed once written, and a card keeps the one it printed from being deleted, so both questions have
 * one answer. A picture that is nonetheless not there is **refused by name**, as a face or a frame's
 * ornament is: a title page printed without its coat of arms is wrong in a way nobody sees until it is
 * in the binder.
 */
async function loadPictures(
  album: AlbumData,
  sheets: readonly DrawableSheet[],
  doc: PDFDocument
): Promise<Map<string, { picture: AlbumPictureRef; image?: PDFImage }>> {
  const ids = sheets.flatMap((sheet) =>
    (sheet.page.free?.elements ?? []).flatMap((el) => (el.kind === "picture" ? [el.pictureId] : []))
  );
  const out = new Map<string, { picture: AlbumPictureRef; image?: PDFImage }>();
  if (ids.length === 0) return out;
  const found = await resolveAlbumPictures(album.collectionId, ids);
  for (const id of new Set(ids)) {
    const picture = found.get(id);
    if (!picture) {
      throw new AlbumPdfError(
        "A page without stamps places a picture the collection no longer has. Take it off the page before printing."
      );
    }
    if (picture.drawing) {
      out.set(id, { picture });
      continue;
    }
    const bytes = await readAlbumPictureBytes(picture);
    const { bytes: embeddable, png } = await toEmbeddable(bytes, picture.raster!.mime);
    const image = png ? await doc.embedPng(embeddable) : await doc.embedJpg(embeddable);
    out.set(id, { picture, image });
  }
  return out;
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
