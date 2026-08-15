"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useEscapeLayer } from "@/app/escape-stack";
import type { TileSideView } from "@/lib/scan-tile-view";
import {
  formatGaugeAt,
  formatMillimetres,
  isPlausibleGauge,
  measureDistance,
  parseScanDpi,
  parseToothCount,
  perforationGauge,
  type ScanPoint,
} from "@/lib/scan-measure";
import {
  ZOOM_STEP,
  actualSizeViewport,
  clampOffsets,
  clampScale,
  fitViewport,
  panBy,
  toSheetPoint,
  zoomBy,
  type Viewport,
  type ViewportSize,
} from "@/lib/scan-viewport";
import { ScanToolButton } from "./scan-tool-button";
import { useSheetRegion } from "./use-sheet-region";

/**
 * The tile, large and zoomable — the identification dialog's whole left-hand side (#585).
 *
 * ## Why this is the payoff of scanning at all
 *
 * Which variant a stamp is comes down to detail: perforation teeth, a watermark, a plate flaw, a
 * shade. That work is done with a loupe over the physical piece — *after* it has been scanned at
 * 1200 dpi, where all of that detail is already sitting unlooked-at. A single stamp's tile is
 * around 1400 px, comfortably under `FULL_MAX_EDGE`, so **the tile photo already holds the whole
 * scan of it**; showing it at the size of a postage stamp was the only thing standing between the
 * collector and a pass done at the keyboard.
 *
 * ## Reuse, not a second implementation
 *
 * Every number here comes from `scan-viewport.ts` — zoom to the cursor, fit, clamping, and a `1:1`
 * that means one screen pixel per **scan** pixel. That module was written for the cut editor and is
 * about a picture and a viewport, so a tile is simply a second caller: the picture is a rectangle of
 * the very same card, and its size in scan pixels is the tile's own box. A control claiming `1:1`
 * over anything else would lie about the one question this dialog exists to answer — what is real
 * detail and what is enlargement.
 *
 * ## Two things that decide whether it replaces a loupe
 *
 * - **Switching front to back keeps the zoom and the pan.** Telling a variant apart is a comparison,
 *   and being thrown back to fit on every flip is what makes a comparison expensive. The viewport is
 *   therefore held across the switch and only re-clamped, which is exact rather than approximate
 *   because the scale is in *scan* pixels: the two sides are two crops of the same card at the same
 *   density, so the same scale is the same magnification on both.
 * - **Past the photo's own resolution the pixels come from the retained sheet** (`useSheetRegion`),
 *   the same escalation the cut editor makes and the same reason the original is kept. It reaches
 *   for that only when the photo is genuinely a downscale — a big se-tenant block or a strip past
 *   the cap — since for the ordinary single stamp the photo *is* the scan.
 *
 * When the sheet's bytes have been swept (#578) there is no deeper source, and the tile photo alone
 * is what is shown. Which sides exist and which of them still have a scan behind them is decided in
 * `scan-tile-view.ts`, away from the DOM, so the swept case is a unit test rather than a cron job.
 *
 * ## Measuring (#598)
 *
 * The same viewport is also the ruler and the perforation gauge, and it is the same reuse again:
 * everything a measurement needs is already here. A mark is placed in **scan pixels**
 * (`toSheetPoint`), never in screen pixels, so the reading is taken on the card's own grid whatever
 * the browser happens to be drawing — a downscaled photo, or the retained original where
 * `useSheetRegion` has escalated to it. The zoom then affects only how precisely a mark can be
 * *placed*, which is why the bar says so below `1:1` rather than quietly returning a worse number.
 *
 * The **scale is stated and never inferred** (`scan-measure.ts`), and its field sits in the bar
 * beside the result: prefilled from the collection, corrected here for this sitting, and never
 * written back — see `docs/agents/purchases-and-intake.md` for why that asymmetry is the point.
 * Nothing a measurement produces is stored anywhere.
 */

interface Props {
  collectionId: string;
  /** Front, back, or a lone back — from `tileSideViews`, never assembled here. */
  sides: TileSideView[];
  /** For the alt text, which is the only place a tile's position is named on this side of the
   * dialog. */
  position: number;
  /** What this collection scans at (#598) — the measuring bar's prefill, and the only scale in the
   * app. Passed down rather than fetched here: it is one integer the page already loaded, and a
   * viewer that read it for itself would be a second source for the one number that must not have
   * two. */
  scanDpi: number;
}

/**
 * The piece an identification chain is **about** (#592), carried through every dialog the chain
 * opens: the stamp picker, an issue or a stamp created from inside it, and the condition step.
 *
 * A record rather than a tile id, and that is the decision rather than a convenience. Which sides
 * exist and which still have a retained card behind them is `tileSideViews`' answer, computed once
 * where the batch's sheets are in hand (`purchase-scans-card.tsx`); handing the chain an id instead
 * would mean every dialog in it re-deriving that — including the swept-sheet case (#578), which is
 * exactly the one a second derivation would get wrong.
 *
 * There is **no `stampId` fallback in it and there must not be one**: this is a picture of *the*
 * piece in the tweezers, and a stamp's catalogue photo is a picture of *a* specimen. Standing one
 * in beside a condition field invites reading a condition off the wrong stamp, so intake with no
 * scan behind it carries no piece and shows nothing at all.
 */
export interface IdentifiedPiece {
  tileId: string;
  sides: TileSideView[];
  position: number;
}

/**
 * The pieces as a dialog's `aside` (`DialogShell.aside`) — one call site's worth of wrapping, so
 * that every dialog in the chain shows the same thing rather than its own arrangement of it. Null
 * when there is no picture at all, which is what keeps the aside absent rather than empty.
 *
 * **One piece is the viewer; several are all of them, small** (#596). With a run of tiles ticked
 * there is no single piece the step is about, and answering "show the first one" would be the app
 * picking one photograph to stand for fifteen pieces of paper. Ticking them was the collector
 * *asserting* they are the same stamp in the same condition, and seeing them side by side is how a
 * mistake in that assertion is caught — before it becomes fifteen copies rather than after. The app
 * never checks the assertion itself and never offers to find duplicates: telling two shades or two
 * perforations apart is the work being done here.
 *
 * Any one of them can still be looked at properly — clicking a thumbnail opens #585's viewer on it,
 * with the way back to the grid — because the doubt a grid raises is answered by a loupe, and there
 * is already one.
 */
export function IdentifiedPieceAside({
  collectionId,
  pieces,
  scanDpi,
}: {
  collectionId: string;
  pieces: IdentifiedPiece[];
  /** The collection's stated scan resolution (#598), carried to whichever viewer this resolves to. */
  scanDpi: number;
}) {
  const shown = pieces.filter((p) => p.sides.length > 0);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = shown.find((p) => p.tileId === openId) ?? null;

  if (shown.length === 0) return null;
  if (shown.length === 1) {
    return (
      <TileZoomView
        collectionId={collectionId}
        sides={shown[0].sides}
        position={shown[0].position}
        scanDpi={scanDpi}
      />
    );
  }
  if (opened) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
        <button
          type="button"
          onClick={() => setOpenId(null)}
          style={{
            alignSelf: "flex-start",
            marginBottom: "0.5rem",
            padding: "0.25rem 0.5rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border-strong)",
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-secondary)",
            font: "inherit",
            fontSize: "0.8125rem",
            cursor: "pointer",
          }}
        >
          ← All {shown.length} pieces
        </button>
        <TileZoomView
          // Remounted per piece, so the viewer opens fitted to the tile that was clicked rather than
          // carrying the previous one's zoom onto a differently sized crop.
          key={opened.tileId}
          collectionId={collectionId}
          sides={opened.sides}
          position={opened.position}
          scanDpi={scanDpi}
        />
      </div>
    );
  }
  return <IdentifiedPieceGrid collectionId={collectionId} pieces={shown} onOpen={setOpenId} />;
}

/**
 * Every ticked piece at once (#596).
 *
 * The **front** of each, at the size that lets a run be compared rather than merely counted, in the
 * order the card is laid out in and labelled with the tile's own position — the strip is a map of
 * the card on the desk, and the panel beside the form has to be readable against it.
 */
function IdentifiedPieceGrid({
  collectionId,
  pieces,
  onOpen,
}: {
  collectionId: string;
  pieces: IdentifiedPiece[];
  onOpen: (tileId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      <p
        style={{
          margin: "0 0 0.625rem",
          fontSize: "0.8125rem",
          color: "var(--color-text-secondary)",
        }}
      >
        <strong>{pieces.length} pieces</strong>, being identified as one stamp. Check them against
        each other before you confirm — click one to look at it closely.
      </p>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(7.5rem, 1fr))",
          gap: "0.5rem",
          alignContent: "start",
        }}
      >
        {pieces.map((piece) => {
          const front = piece.sides.find((s) => s.side === "front") ?? piece.sides[0];
          return (
            <Tooltip
              key={piece.tileId}
              content={`Tile ${piece.position + 1} — click to look at it closely`}
              style={{ display: "block" }}
            >
            <button
              type="button"
              onClick={() => onOpen(piece.tileId)}
              style={{
                display: "block",
                padding: "0.25rem",
                border: "1px solid var(--color-border)",
                borderRadius: "0.375rem",
                background: "var(--color-bg-page)",
                font: "inherit",
                color: "var(--color-text-muted)",
                cursor: "pointer",
              }}
            >
              {/* The **thumb**, which is the strip's own derivative and so usually already in
                  cache: a grid of fifteen full crops of a 1200 dpi card would be tens of megabytes
                  fetched to be drawn two inches wide. At 320 px against a ~7.5 rem cell it is
                  oversampled either way, and the piece that raises a doubt is one click from the
                  full-resolution viewer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/collections/${collectionId}/photos/${front.photoId}/thumb`}
                alt={`Tile ${piece.position + 1}, ${front.label.toLowerCase()}`}
                draggable={false}
                style={{
                  display: "block",
                  width: "100%",
                  aspectRatio: "1",
                  objectFit: "contain",
                }}
              />
              <span style={{ fontSize: "0.6875rem" }}>{piece.position + 1}</span>
            </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/** Which measuring tool is down, if any (#598). Two, because they are two questions: a distance is
 * a distance, and a perforation is that distance divided into teeth. The gauge is arithmetic over
 * the ruler rather than a second measurement, which is also how a physical odontometer works — so
 * nothing new has to be learned to read one. */
type MeasureTool = "off" | "ruler" | "perforation";

/**
 * What the measuring bar says right now (#598) — the figure, or the reason there is not one.
 *
 * A plain function of its inputs so the wording is in one place and the rules it encodes are read
 * together. Two of them are the ones the issue turns on:
 *
 * - **No figure without a scale.** An unparseable resolution produces a sentence asking for one,
 *   never a reading against a fallback. A number taken at a scale nobody stated is exactly the
 *   thing that gets written down as a variant's defining feature and is wrong.
 * - **A figure never appears without the scale it was taken at.** Both `text` values below come
 *   from `formatMillimetresAt` / `formatGaugeAt`, which cannot render one without the other.
 *
 * A gauge outside what perforations actually occupy is reported as a mistake rather than quoted: at
 * that point the marks or the tooth count are wrong, and "47.32" said confidently is worse than
 * saying so.
 */
function describeReading(args: {
  tool: MeasureTool;
  marks: { a: ScanPoint; b: ScanPoint } | null;
  dpi: number | null;
  teeth: number | null;
}): { text: string; muted: boolean; detail?: string } {
  const { tool, marks, dpi, teeth } = args;
  if (tool === "off") return { text: "", muted: true };
  if (dpi === null) {
    return {
      text: "State the resolution you scan at — a measurement is only as good as it.",
      muted: true,
    };
  }
  if (!marks) {
    return {
      text:
        tool === "ruler"
          ? "Drag across the tile to measure it."
          : "Drag from the first hole of a run to the last.",
      muted: true,
    };
  }
  const { px, mm } = measureDistance(marks.a, marks.b, dpi);
  if (px <= 0) {
    return { text: "One mark placed — drag to the second.", muted: true };
  }
  if (tool === "ruler") {
    return {
      text: `${formatMillimetres(mm)} mm at ${dpi} dpi`,
      muted: false,
      detail: `${Math.round(px)} scan px`,
    };
  }
  if (teeth === null) {
    return { text: "How many teeth lie between the two marks?", muted: true };
  }
  const gauge = perforationGauge(mm, teeth);
  if (gauge === null || !isPlausibleGauge(gauge)) {
    return {
      text: "That is not a perforation — check the marks and the tooth count.",
      muted: true,
      detail: `${formatMillimetres(mm)} mm, ${teeth} teeth`,
    };
  }
  return {
    text: `Perf ${formatGaugeAt(gauge, dpi)}`,
    muted: false,
    detail: `${formatMillimetres(mm)} mm over ${teeth} teeth`,
  };
}

/** The natural size of a loaded photo, in its own pixels. Measured rather than stored: it is the
 * width of the derivative actually on screen, which is what decides whether the retained scan has
 * anything more to offer — and the browser knows it exactly. */
interface Natural {
  width: number;
  height: number;
}

export function TileZoomView({ collectionId, sides, position, scanDpi }: Props) {
  const [sideKey, setSideKey] = useState(() => sides[0]?.side ?? "front");
  const current = sides.find((s) => s.side === sideKey) ?? sides[0];
  const [natural, setNatural] = useState<Record<string, Natural>>({});

  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [view, setView] = useState<Viewport>({ scale: 1, offsetX: 0, offsetY: 0 });
  /** Whether the view is still the fitted one — what keeps **Fit** lit, and what tells a resize or a
   * flip whether to re-fit or to leave a chosen zoom alone. Held as a ref beside the state because
   * the resize observer fires outside React's render. */
  const [fitted, setFitted] = useState(true);
  const fittedRef = useRef(true);
  const [panning, setPanning] = useState(false);

  const measured = current ? natural[current.photoId] : undefined;
  /** The picture in **scan** pixels: the tile's box on the card, or — for a tile carrying no box —
   * the photo's own size, which is then all there is to know about it. */
  const pictureWidth = current?.box?.w ?? measured?.width ?? 0;
  const pictureHeight = current?.box?.h ?? measured?.height ?? 0;
  const ready = pictureWidth > 0 && pictureHeight > 0 && size.width > 0;

  /**
   * Whether this side can be measured at all (#598) — **only with a box**.
   *
   * With one, the picture's size is stated in the card's own scan pixels, so a mark converts to
   * millimetres against the stated resolution and the answer is right whatever derivative happens
   * to be drawn. Without one the fallback above is the *photo's* size, and a photo has been through
   * `FULL_MAX_EDGE`: it may be the scan, or it may be a downscale of it by an unknown factor, and
   * nothing on this side can tell which. Measuring there would silently take a reading at a
   * resolution the app merely assumed, which is the one thing this tool must never do — so the
   * controls are absent rather than approximate.
   */
  const canMeasure = Boolean(current?.box);

  const markFitted = useCallback((value: boolean) => {
    fittedRef.current = value;
    setFitted(value);
  }, []);

  // Measure the viewport, and fit inside it. One observer covers the dialog being resized with the
  // window and the first observation the browser delivers on mount, which is where the opening fit
  // comes from.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      if (next.width === 0 || next.height === 0) return;
      setSize(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fit is the default; a chosen zoom is only re-clamped. This runs on the picture changing as well
  // as on the viewport changing, which is what carries a zoom across the front/back flip: the two
  // crops differ by a few pixels of card, so re-clamping is the whole of the adjustment.
  useEffect(() => {
    if (!ready) return;
    const picture = { width: pictureWidth, height: pictureHeight };
    setView((v) =>
      fittedRef.current
        ? fitViewport(picture, size)
        : clampOffsets({ ...v, scale: clampScale(v.scale, picture, size) }, picture, size)
    );
  }, [pictureWidth, pictureHeight, ready, size]);

  const zoomStep = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      if (!ready) return;
      const picture = { width: pictureWidth, height: pictureHeight };
      setView((v) =>
        zoomBy(v, factor, anchor ?? { x: size.width / 2, y: size.height / 2 }, picture, size)
      );
      markFitted(false);
    },
    [markFitted, pictureHeight, pictureWidth, ready, size]
  );

  const fit = useCallback(() => {
    if (!ready) return;
    setView(fitViewport({ width: pictureWidth, height: pictureHeight }, size));
    markFitted(true);
  }, [markFitted, pictureHeight, pictureWidth, ready, size]);

  const actualSize = useCallback(() => {
    if (!ready) return;
    setView(actualSizeViewport({ width: pictureWidth, height: pictureHeight }, size));
    markFitted(false);
  }, [markFitted, pictureHeight, pictureWidth, ready, size]);

  // Bound by hand rather than through `onWheel`: React's is passive, and a passive listener cannot
  // call `preventDefault` — the dialog would scroll under the zoom.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !ready) return;
    const picture = { width: pictureWidth, height: pictureHeight };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setView((v) => zoomBy(v, Math.pow(ZOOM_STEP, -delta / 100), anchor, picture, size));
      markFitted(false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [markFitted, pictureHeight, pictureWidth, ready, size]);

  // The same keys as the editor, so the two surfaces are one habit. Not while a field has focus —
  // the settled tile's note is a textarea, and `-` is a character in it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomStep(ZOOM_STEP);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomStep(1 / ZOOM_STEP);
      } else if (e.key === "0") {
        e.preventDefault();
        fit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit, zoomStep]);

  // ── Measuring (#598) ────────────────────────────────────────────────────────────────────────

  /** Off, or one of the two tools. Off is the resting state and stays it: the viewer's plain drag
   * is the hand, and a surface that started out measuring would make every look-at-a-stamp begin
   * by putting a tool down. */
  const [chosenTool, setChosenTool] = useState<MeasureTool>("off");
  /** …and what is actually down. Derived rather than corrected after the fact: a side with no box
   * cannot be measured at all, and forcing the choice back to `off` from an effect would let one
   * render happen with a tool down over a side that has no scan geometry. */
  const tool: MeasureTool = canMeasure ? chosenTool : "off";
  const measuring = tool !== "off";

  /** The two marks, in the picture's own **scan** pixels — the coordinate space every number here
   * is taken in, and the reason a reading does not change when the zoom does. */
  const [marks, setMarks] = useState<{ a: ScanPoint; b: ScanPoint } | null>(null);

  /** The stated scale, as typed. Prefilled from the collection and **never written back**: a card
   * scanned at 600 measured once is a fact about that card, not a new assumption for every later
   * measurement. Changing what the collection assumes is a Settings act. */
  const [dpiText, setDpiText] = useState(String(scanDpi));
  const dpi = parseScanDpi(dpiText);

  /** How many teeth lie **between the marks**. Asked for rather than counted: a detector over a
   * periodic edge would fail into plausible numbers, which in a measuring tool is the worst kind of
   * failure, and counting a dozen teeth by eye was never the expensive part — leaving the screen
   * was (#598). */
  const [teethText, setTeethText] = useState("10");
  const teeth = parseToothCount(teethText);

  /** Space is the hand tool while a measuring tool is down, exactly as in the cut editor — one
   * habit across both scan surfaces rather than two. */
  const [spaceHeld, setSpaceHeld] = useState(false);

  /** Show a side. A mark belongs to the side it was placed on — the front and the back are
   * different pieces of card, so carrying a line across the flip would draw a measurement of
   * somewhere else over a picture of somewhere else. The zoom is kept, deliberately (#585); only
   * the marks are not. */
  const showSide = useCallback((side: TileSideView["side"]) => {
    setSideKey(side);
    setMarks(null);
  }, []);

  useEffect(() => {
    if (!measuring) return;
    const down = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [measuring]);

  // Escape clears the line, and then puts the tool down — before it reaches the dialog. The layer
  // is pushed when the tool comes out, which is after the dialog registered its own, so this is the
  // topmost layer exactly while there is something here to dismiss (`escape-stack.ts`). A collector
  // three marks into a perforation run who presses Escape means "not like that", not "close
  // everything", which is the same judgement #597 made for the note.
  useEscapeLayer(() => {
    if (marks) {
      setMarks(null);
      return;
    }
    setChosenTool("off");
  }, measuring);

  /** A viewport point as a mark, clamped to the picture: a drag that leaves the tile would
   * otherwise measure to a point of card that is not on it. */
  const markAt = useCallback(
    (clientX: number, clientY: number): ScanPoint | null => {
      const el = viewportRef.current;
      if (!el || !ready) return null;
      const rect = el.getBoundingClientRect();
      const p = toSheetPoint(view, clientX - rect.left, clientY - rect.top);
      return {
        x: Math.min(Math.max(p.x, 0), pictureWidth),
        y: Math.min(Math.max(p.y, 0), pictureHeight),
      };
    },
    [pictureHeight, pictureWidth, ready, view]
  );

  const pan = useRef<{ x: number; y: number } | null>(null);
  const marking = useRef(false);
  /** Whether the plain drag is the hand. It is, unless a measuring tool is down and space is not
   * held — the cut editor's rule, for the same reason: panning has to keep working in every mode,
   * because the thing being marked is usually not the thing currently on screen. */
  const handDrag = !measuring || spaceHeld;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!ready) return;
    if (e.button === 0 && !handDrag) {
      const at = markAt(e.clientX, e.clientY);
      if (!at) return;
      // Both ends start together: a click that never becomes a drag leaves a zero-length line,
      // which reads as "one mark placed" rather than as a measurement of nothing.
      setMarks({ a: at, b: at });
      marking.current = true;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    // The whole surface pans while no tool is down: there is nothing else to do to a tile, so the
    // plain drag is free to be the hand rather than a modifier on one.
    pan.current = { x: e.clientX, y: e.clientY };
    setPanning(true);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (marking.current) {
      const at = markAt(e.clientX, e.clientY);
      if (at) setMarks((m) => (m ? { a: m.a, b: at } : m));
      return;
    }
    const last = pan.current;
    if (!last || !ready) return;
    const picture = { width: pictureWidth, height: pictureHeight };
    setView((v) => panBy(v, e.clientX - last.x, e.clientY - last.y, picture, size));
    pan.current = { x: e.clientX, y: e.clientY };
  };
  const endPan = () => {
    pan.current = null;
    marking.current = false;
    setPanning(false);
  };

  const detail = useSheetRegion({
    collectionId,
    sheetId: current?.sheetId ?? null,
    width: pictureWidth,
    height: pictureHeight,
    viewWidth: measured?.width ?? 0,
    originX: current?.box?.x ?? 0,
    originY: current?.box?.y ?? 0,
    view,
    size,
  });

  if (!current) return null;

  const atActualSize = ready && Math.abs(view.scale - 1) < 1e-6;

  /** The reading, or the reason there is not one yet. Recomputed on every render rather than held
   * in state: it is a function of the marks, the scale and the tooth count, and a cached copy of it
   * is a copy that can be stale — which for a number quoted as a measurement is not a bug worth
   * risking to save an arithmetic. */
  const reading = describeReading({ tool, marks, dpi, teeth });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0 0 0.625rem",
          flexWrap: "wrap",
        }}
      >
        {/* Only when there is a second side to go to. A lone front with a disabled *Back* beside it
            would be the dialog reporting a missing photograph, which the strip already says. */}
        {sides.length > 1 &&
          sides.map((s) => (
            <ScanToolButton
              key={s.side}
              label={s.label}
              hint={`Show the ${s.label.toLowerCase()} of this tile — the zoom and the position are kept`}
              active={s.side === current.side}
              onClick={() => showSide(s.side)}
            />
          ))}
        {/* The two measuring tools (#598), on the same toolbar as the zoom because they are the
            same act: looking closely at one thing. Absent — not disabled — on a side with no box,
            since there is then no scan geometry to measure against and a greyed control would be
            promising something this side cannot do. */}
        {canMeasure && (
          <>
            <ScanToolButton
              icon="measure"
              label="Ruler"
              hint="Measure between two points of the scan, in millimetres"
              active={tool === "ruler"}
              onClick={() => {
                setChosenTool((t) => (t === "ruler" ? "off" : "ruler"));
                setMarks(null);
              }}
            />
            <ScanToolButton
              label="Perforation"
              hint="Mark the first and last hole of a run and say how many teeth lie between them"
              active={tool === "perforation"}
              onClick={() => {
                setChosenTool((t) => (t === "perforation" ? "off" : "perforation"));
                setMarks(null);
              }}
            />
          </>
        )}
        <span style={{ flex: 1 }} />
        <ScanToolButton icon="zoomOut" label="−" hint="Zoom out (−)" onClick={() => zoomStep(1 / ZOOM_STEP)} />
        {/* The percentage is against the **scan**, exactly as in the cut editor. The dot marks the
            visible part being served from the retained card rather than magnified out of the
            tile's own photo. */}
        <Tooltip
          content={
            detail
              ? "Showing this part at full resolution from the retained card scan"
              : "Showing the tile's own image"
          }
        >
        <span
          style={{
            fontSize: "0.8125rem",
            color: detail ? "var(--color-text-secondary)" : "var(--color-text-muted)",
            minWidth: "3.25rem",
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {ready ? `${Math.round(view.scale * 100)}%` : "—"}
          {detail ? " ·" : ""}
        </span>
        </Tooltip>
        <ScanToolButton icon="zoomIn" label="+" hint="Zoom in (+)" onClick={() => zoomStep(ZOOM_STEP)} />
        <ScanToolButton
          icon="zoomFit"
          label="Fit"
          hint="The whole tile on screen (0)"
          active={fitted}
          onClick={fit}
        />
        <ScanToolButton
          label="1:1"
          hint="One screen pixel per pixel of the scan itself — past this the picture is enlarged, not sharper"
          active={!fitted && atActualSize}
          onClick={actualSize}
        />
      </div>

      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        // Middle-button down starts the browser's own autoscroll, which `onPointerDown` is too
        // late to stop — the same guard the cut editor needs for the same reason.
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        style={{
          flex: 1,
          minHeight: "20rem",
          position: "relative",
          overflow: "hidden",
          borderRadius: "0.375rem",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-subtle)",
          cursor: panning ? "grabbing" : handDrag ? "grab" : "crosshair",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: view.offsetX,
            top: view.offsetY,
            width: ready ? pictureWidth * view.scale : "100%",
            height: ready ? pictureHeight * view.scale : "100%",
          }}
        >
          {/* Served by an authenticated route at whatever size the crop was, which is exactly the
              case `next/image`'s loader cannot size or optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/collections/${collectionId}/photos/${current.photoId}/full`}
            alt={`Tile ${position + 1}, ${current.label.toLowerCase()}`}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNatural((n) =>
                n[current.photoId]
                  ? n
                  : { ...n, [current.photoId]: { width: img.naturalWidth, height: img.naturalHeight } }
              );
            }}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "fill" }}
          />

          {/* The visible part at the card's own resolution, drawn over the photo it magnifies and
              never instead of it: a crop still in flight is a soft edge rather than a blank panel,
              and one that never arrives leaves a picture of the stamp on screen. */}
          {detail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={detail.url}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                left: detail.box.x * view.scale,
                top: detail.box.y * view.scale,
                width: detail.box.w * view.scale,
                height: detail.box.h * view.scale,
                objectFit: "fill",
                pointerEvents: "none",
              }}
            />
          )}

          {/* The line, drawn in the same transformed layer as the picture, so it stays over the
              pixels it was placed on through every zoom and pan without a single coordinate being
              recomputed. Marks are held in scan pixels and scaled here — never the other way
              round, which would make the reading a function of the zoom. */}
          {measuring && marks && ready && (
            <svg
              width={pictureWidth * view.scale}
              height={pictureHeight * view.scale}
              style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
            >
              {/* Twice, dark under light: a scan is white paper in some places and printing ink in
                  others, and one stroke colour is invisible over one of them. */}
              <line
                x1={marks.a.x * view.scale}
                y1={marks.a.y * view.scale}
                x2={marks.b.x * view.scale}
                y2={marks.b.y * view.scale}
                stroke="rgba(0,0,0,0.65)"
                strokeWidth={3}
              />
              <line
                x1={marks.a.x * view.scale}
                y1={marks.a.y * view.scale}
                x2={marks.b.x * view.scale}
                y2={marks.b.y * view.scale}
                stroke="#fff"
                strokeWidth={1}
              />
              {[marks.a, marks.b].map((p, i) => (
                <circle
                  key={i}
                  cx={p.x * view.scale}
                  cy={p.y * view.scale}
                  r={4}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={1.5}
                  // A ring rather than a dot: the thing being aimed at is the centre of a
                  // perforation hole, and a filled marker covers exactly what is being aimed at.
                  paintOrder="stroke"
                />
              ))}
            </svg>
          )}

          {/* The reading at the end of the line, where the hand already is — so a run is adjusted
              while watching the figure move rather than by dragging, glancing down at the bar, and
              dragging again. It stays after the drag for the same reason it appeared: the figure
              belongs to the line, and the bar keeps it too along with the scale and the fields. Only
              a real figure gets one; the prompts ("drag from the first hole…") are the bar's job and
              would be a label following the pointer to say nothing. */}
          {measuring && marks && ready && !reading.muted && (
            <span
              style={{
                position: "absolute",
                left: marks.b.x * view.scale,
                top: marks.b.y * view.scale,
                // Above the second mark and clear of the pointer, which is on the thing being
                // aimed at — the one part of the picture a label must not cover.
                transform: "translate(-50%, calc(-100% - 0.75rem))",
                padding: "0.125rem 0.375rem",
                borderRadius: "0.25rem",
                // Its own colours rather than the surface tokens: this sits on a scan, which is
                // white paper in some places and printed ink in others, and it has to be legible
                // over both in either theme.
                background: "rgba(17, 17, 17, 0.85)",
                color: "#fff",
                fontSize: "0.75rem",
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {reading.text}
            </span>
          )}
        </div>
      </div>

      {/* The measuring bar (#598) — the reading, and beside it the scale it was taken at.
          Deliberately together and deliberately here rather than at upload: a value set weeks
          earlier is inherited by someone who cannot see it, while one beside the result is on view
          exactly when it acts (#573). */}
      {measuring && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
            margin: "0.5rem 0 0",
            padding: "0.5rem 0.75rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.375rem",
            background: "var(--color-bg-elevated)",
            fontSize: "0.8125rem",
          }}
        >
          <span
            style={{
              color: reading.muted ? "var(--color-text-muted)" : "var(--color-text-primary)",
              fontWeight: reading.muted ? 400 : 600,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {reading.text}
          </span>
          {reading.detail && (
            <span style={{ color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
              {reading.detail}
            </span>
          )}

          <span style={{ flex: 1 }} />

          {tool === "perforation" && (
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <input
                value={teethText}
                onChange={(e) => setTeethText(e.target.value)}
                inputMode="numeric"
                aria-label="Teeth between the marks"
                style={{ ...MEASURE_FIELD, width: "3rem" }}
              />
              <span style={{ color: "var(--color-text-muted)" }}>teeth between the marks</span>
            </label>
          )}

          <Tooltip content="What this card was scanned at. Correcting it here holds for this sitting only — the collection keeps its own setting, in Settings → General.">
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <input
                value={dpiText}
                onChange={(e) => setDpiText(e.target.value)}
                inputMode="numeric"
                aria-label="Scan resolution in dots per inch"
                style={{
                  ...MEASURE_FIELD,
                  width: "4rem",
                  borderColor:
                    dpi === null ? "var(--color-error-border)" : "var(--color-border-strong)",
                }}
              />
              <span style={{ color: "var(--color-text-muted)" }}>dpi</span>
            </label>
          </Tooltip>

          {marks && (
            <ScanToolButton label="Clear" hint="Take the marks off (Esc)" onClick={() => setMarks(null)} />
          )}
        </div>
      )}

      <p
        style={{
          margin: "0.5rem 0 0",
          fontSize: "0.75rem",
          color: "var(--color-text-muted)",
        }}
      >
        {measuring ? (
          <>
            Drag to mark · hold <kbd>space</kbd> or the middle button to move · <kbd>Esc</kbd> clears
            {/* Said only when it is true, and it is the accuracy warning rather than a tip: the
                reading is taken on the scan's own pixels either way, but below 1:1 a mark is placed
                to within more than one of them, and a gauge separates 11½ from 12 by under 4%. */}
            {ready && view.scale < 1 && (
              <> · zoom to <kbd>1:1</kbd> or closer to place the marks accurately</>
            )}
          </>
        ) : (
          <>
            Drag to move · wheel or <kbd>+</kbd>/<kbd>−</kbd> zooms · <kbd>0</kbd> fits
            {sides.length > 1 ? " · the zoom is kept when you switch sides" : ""}
          </>
        )}
      </p>
    </div>
  );
}

/** The two number fields in the measuring bar, which are one control wearing two labels. */
const MEASURE_FIELD: React.CSSProperties = {
  padding: "0.25rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontFamily: "inherit",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-page)",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
