"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlbumPageCanvas } from "@/app/c/[collectionSlug]/albums/[albumId]/pages/page-canvas";
import type { AlbumTemplatePreview } from "@/lib/album-preview";
import type { AlbumSummary } from "@/lib/albums";
import type { AlbumPreviewSource } from "@/app/actions/album-templates";

// The album template's live preview (#795): the page the thirty-odd numbers in the dialog beside
// this actually produce.
//
// ## Why the dialog needed one at all
//
// The collector's own words on #795: *there is no way to see how this translates visually onto the
// print until I generate an album* — so every smallest correction cost a round trip through album
// generation and a PDF, and nobody tunes a template that way. **This adds no capability.** Every
// number here already did what it does; what was missing was any way to judge it.
//
// ## Nothing here computes a millimetre
//
// The sheet is planned on the server by `album-preview.ts`, through `album-layout.ts` and
// `planHawidBox`, and drawn by `AlbumPageCanvas` — the same component the page editor (#769) draws a
// real album page with. The client does not measure, because the client is not a planner (ADR-0045
// §7): a preview that laid out its own text would break a heading in one place and the printer in
// another, and **a preview that disagreed with the PDF would be worse than no preview — it would be
// a confident wrong answer.**
//
// The one thing this file works out for itself is the **zoom**, which is a scale factor rather than
// a measurement: it asks how wide the drawing is on screen and never how wide a word is. The canvas
// already reads its own frame the same way, and says so.
//
// ## Why it redraws as you type rather than behind a button
//
// Measured before it was promised, as #795 asked. Planning the sample sheet — eighteen boxes
// through the hawid rule, four `{token}` texts rendered, the whole page packed against the embedded
// faces' real advances — is **1.2 ms** warm on this machine, and about 30 ms on the very first call
// while fontkit parses a face (cached on `globalThis` afterwards, `album-font-bytes.ts`). So the
// cost of a keystroke is not the planning; it is the round trip, which is why the request is
// debounced rather than the redraw made explicit. A janky live preview would be worse than a button,
// and this one is not one.

/** How long a keystroke waits before the sheet is re-planned. The template builder's own search
 *  debounce is 200 ms; a little longer here because a page is a heavier thing to have flicker, and
 *  because a collector adjusting a margin holds the arrow key down. */
const DEBOUNCE_MS = 260;

/** CSS millimetres to CSS pixels. The canvas renders the sheet in `mm` units, so this is the
 *  conversion between the width this panel has and the zoom that fills it. */
const PX_PER_MM = 96 / 25.4;

/** Never larger than life. A page smaller than the panel is shown at 1:1 rather than blown up —
 *  a sheet of paper at 140% is not a thing the collector will ever hold. */
const MAX_ZOOM = 1;

/** The sheet's own border and shadow, which the zoom has to leave room for or a page fitted exactly
 *  to the panel grows a horizontal scrollbar under itself. */
const SHEET_CHROME_PX = 4;

const PANEL_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.625rem",
  minWidth: 0,
};

const CONTROL_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const NOTE_STYLE: React.CSSProperties = {
  fontSize: "0.75rem",
  lineHeight: 1.45,
  color: "var(--color-text-muted)",
  margin: 0,
};

const WARN_STYLE: React.CSSProperties = {
  ...NOTE_STYLE,
  color: "var(--color-warning)",
};

interface AlbumTemplatePreviewPanelProps {
  collectionId: string;
  /** The form the preset is read off. The preview goes through the **same parser a save goes
   *  through**, so it can never draw a page the template would refuse to store. */
  formRef: React.RefObject<HTMLFormElement | null>;
  /** Bumped by the dialog whenever any field changes — including the four texts, which are React
   *  state written into hidden inputs and therefore fire no `input` event of their own. */
  revision: number;
}

export function AlbumTemplatePreviewPanel({
  collectionId,
  formRef,
  revision,
}: AlbumTemplatePreviewPanelProps) {
  const [source, setSource] = useState<AlbumPreviewSource>({ kind: "sample" });
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [preview, setPreview] = useState<AlbumTemplatePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [frameWidth, setFrameWidth] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  /** Which request the sheet on screen belongs to. A slow reply for an older preset must not land
   *  on top of a newer one — the collector holding an arrow key down produces exactly that race. */
  const latest = useRef(0);

  // The albums the preview may be pointed at, read once. A collection with none still previews: the
  // sample is the default and the whole reason it exists (#795).
  useEffect(() => {
    let alive = true;
    (async () => {
      const { albumPreviewAlbumsAction } = await import("@/app/actions/album-templates");
      const rows = await albumPreviewAlbumsAction(collectionId);
      if (alive) setAlbums(rows);
    })().catch(() => {
      // A failed list leaves the sample selected, which is a working preview. Nothing here is worth
      // an error message in a dialog whose subject is something else.
    });
    return () => {
      alive = false;
    };
  }, [collectionId]);

  // How wide the sheet may be drawn. A scale factor off the rendered frame — see the module header.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setFrameWidth(entry.contentRect.width);
    });

    observer.observe(el);
    setFrameWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const draw = useCallback(async () => {
    const form = formRef.current;
    if (!form) return;
    const ticket = latest.current + 1;
    latest.current = ticket;
    setPending(true);
    try {
      const { albumTemplatePreviewAction } = await import("@/app/actions/album-templates");
      const result = await albumTemplatePreviewAction(collectionId, new FormData(form), source);
      if (latest.current !== ticket) return;
      setPending(false);
      if (result.status === "invalid") {
        // The last sheet stays on screen. Blanking a field mid-edit is an ordinary thing to do, and
        // a preview that vanished on every keystroke would be harder to work against than one that
        // lags.
        setProblem(result.message);
        return;
      }
      setProblem(null);
      setPreview(result.preview);
    } catch {
      // A preview is a derivation of something the collector can still save. It says it is stale and
      // stops spinning; it does not take the dialog's own error line, which belongs to the save.
      if (latest.current !== ticket) return;
      setPending(false);
      setProblem("the page could not be drawn just now.");
    }
  }, [collectionId, formRef, source]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void draw();
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [draw, revision]);

  const sheets = preview?.sheets ?? [];
  const pageWidthMm = sheets[0]?.preset.pageWidthMm ?? 0;
  const zoom =
    frameWidth > 0 && pageWidthMm > 0
      ? Math.min(MAX_ZOOM, (frameWidth - SHEET_CHROME_PX) / (pageWidthMm * PX_PER_MM))
      : MAX_ZOOM;

  return (
    <div style={PANEL_STYLE}>
      <select
        aria-label="What the preview draws"
        value={source.kind === "sample" ? "" : source.albumId}
        onChange={(e) =>
          setSource(e.target.value ? { kind: "album", albumId: e.target.value } : { kind: "sample" })
        }
        style={CONTROL_STYLE}
      >
        <option value="">Sample page</option>
        {albums.map((album) => (
          <option key={album.id} value={album.id}>
            {album.name}
          </option>
        ))}
      </select>

      <div
        ref={frameRef}
        style={{
          display: "flex",
          flexDirection: "column",
          // `safe` for the reason #820 gives: a container that both centres and scrolls pushes an
          // over-wide child out on *both* sides and only one of them can be reached. The zoom above
          // means it should never be over-wide, which is exactly the sort of should this costs
          // nothing to stop relying on.
          alignItems: "safe center",
          gap: "0.75rem",
          minWidth: 0,
          // The sheets scroll here rather than in the dialog: the form beside this is long, and a
          // preview that scrolled away while a margin was being typed would be a preview of nothing.
          // The dialog is `min(85vh, 52rem)` tall; this is what is left of it under the source
          // picker and above the notes. Written against the dialog's own height rather than the
          // viewport's, or on a tall window the sheet runs past the bottom of the panel it is
          // stuck to.
          maxHeight: "calc(min(85vh, 52rem) - 15rem)",
          overflowY: "auto",
          // Faded while a newer sheet is being planned, rather than replaced by a spinner: what is on
          // screen is still a true page, just of the preset as it was a moment ago.
          opacity: pending && sheets.length > 0 ? 0.55 : 1,
          transition: "opacity 120ms ease",
        }}
      >
        {sheets.map((sheet) => (
          <AlbumPageCanvas
            key={sheet.position}
            sheet={sheet}
            collectionId={collectionId}
            zoom={zoom}
            interactive={false}
          />
        ))}
        {sheets.length === 0 && (
          <p style={{ ...NOTE_STYLE, padding: "2rem 0", textAlign: "center" }}>
            {pending
              ? "Drawing the page…"
              : source.kind === "album"
                ? "Every page of that album is already printed, so there is nothing live to draw under this template."
                : "Nothing to draw yet."}
          </p>
        )}
      </div>

      {preview && (
        <p style={NOTE_STYLE}>
          {source.kind === "sample"
            ? "A sample page, built from your own AlbumEasy files: four mount heights, a run that fills a row and starts a second, two short checklists sharing a band, a heading that wraps, and a souvenir sheet no strip fits."
            : `${preview.albumName}, drawn under this template. Nothing is saved to it.`}
        </p>
      )}
      {preview && preview.totalSheets > sheets.length + preview.printedSheets && (
        <p style={NOTE_STYLE}>
          Showing the first {sheets.length} of {preview.totalSheets} sheets.
        </p>
      )}
      {preview && preview.printedSheets > 0 && (
        <p style={NOTE_STYLE}>
          {preview.printedSheets === 1 ? "One sheet is" : `${preview.printedSheets} sheets are`}{" "}
          already printed and set in the template they were printed under, so they are not drawn
          here.
        </p>
      )}
      {preview?.emptyStock && (
        <p style={WARN_STYLE}>
          This collection has no hawid stock described, so every box is a pocket and the vertical
          clearance changes nothing. Add strips above and the boxes take their real heights.
        </p>
      )}
      {problem && <p style={WARN_STYLE}>Not redrawn: {problem}</p>}
    </div>
  );
}
