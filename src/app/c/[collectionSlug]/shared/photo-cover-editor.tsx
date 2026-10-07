"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  MIN_COVER_SIZE,
  PHOTO_COVER_SHAPE_LABELS,
  PHOTO_COVER_SHAPES,
  PHOTO_COVER_STYLE_LABELS,
  PHOTO_COVER_STYLES,
  type PhotoCover,
  type PhotoCoverShape,
  type PhotoCoverStyle,
} from "@/lib/photo-cover-rules";

// Drawing covers over a copy's photo (#1665; ADR-0066). Geometry is kept in fractions of the photo, as
// it is stored, so the picture can be drawn at whatever size the dialog has room for.
//
// What is drawn here is an **indication** of each style, not its render: a bar is black, a blur is a
// browser backdrop blur, a pixelation a blur under a coarse grid. The real one is drawn into the offer
// images by the server (`photos/covers.ts`) and seen on the Photos card once they are regenerated.

/** How one cover looks on screen — the overlay the editor and the copy's page both draw. */
export function coverAppearance(cover: PhotoCover): CSSProperties {
  const base: CSSProperties = {
    position: "absolute",
    left: `${cover.x * 100}%`,
    top: `${cover.y * 100}%`,
    width: `${cover.width * 100}%`,
    height: `${cover.height * 100}%`,
    borderRadius: cover.shape === "ellipse" ? "50%" : 0,
    boxSizing: "border-box",
  };
  if (cover.style === "bar") return { ...base, background: "#000" };
  if (cover.style === "blur") {
    return { ...base, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", background: "rgba(127,127,127,0.15)" };
  }
  return {
    ...base,
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    backgroundImage:
      "linear-gradient(rgba(0,0,0,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.25) 1px, transparent 1px)",
    backgroundSize: "16% 16%",
  };
}

/** A photo with its covers laid over it, read-only — the copy's page draws its thumbnails with it. */
export function CoveredPhoto({
  src,
  covers,
  alt,
  style,
}: {
  src: string;
  covers: readonly PhotoCover[];
  alt: string;
  style?: CSSProperties;
}) {
  return (
    <span style={{ position: "relative", display: "inline-block", lineHeight: 0, ...style }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- collection-scoped bytes, as every photo here */}
      <img src={src} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", display: "block" }} />
      {covers.map((cover, i) => (
        <span key={i} aria-hidden style={coverAppearance(cover)} />
      ))}
    </span>
  );
}

type Drag =
  | { kind: "draw"; startX: number; startY: number }
  | { kind: "move"; index: number; startX: number; startY: number; origin: PhotoCover }
  | { kind: "resize"; index: number; corner: Corner; origin: PhotoCover };

type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** The box spanned by two points, in fractions, clipped to the photo. */
function boxBetween(ax: number, ay: number, bx: number, by: number) {
  const x = clamp01(Math.min(ax, bx));
  const y = clamp01(Math.min(ay, by));
  return { x, y, width: clamp01(Math.max(ax, bx)) - x, height: clamp01(Math.max(ay, by)) - y };
}

const TOOLBAR_SELECT: CSSProperties = {
  fontSize: "0.8125rem",
  padding: "0.25rem 0.375rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
};

/**
 * Keyed on the photo by its caller, so each photo starts with nothing selected and the platform's
 * style.
 *
 * The editor: the photo as large as the space allows, covers drawn by dragging, a cover selected by
 * clicking it, moved by dragging it and resized by its corners, removed with Delete. The shape and
 * style of the *next* cover are chosen in the toolbar, which also restyles the selected one.
 */
export function PhotoCoverEditor({
  src,
  covers,
  onChange,
  defaultStyle,
  disabled = false,
}: {
  src: string;
  covers: readonly PhotoCover[];
  onChange: (covers: PhotoCover[]) => void;
  defaultStyle: PhotoCoverStyle;
  disabled?: boolean;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [area, setArea] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [shape, setShape] = useState<PhotoCoverShape>("rect");
  const [style, setStyle] = useState<PhotoCoverStyle>(defaultStyle);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<PhotoCover | null>(null);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setArea({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The photo fitted into the area, never cropped and never enlarged past twice its own size.
  const fitted = (() => {
    if (!natural || area.width === 0 || area.height === 0) return null;
    const scale = Math.min(area.width / natural.width, area.height / natural.height, 2);
    return { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) };
  })();

  const pointAt = useCallback((clientX: number, clientY: number) => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  }, []);

  const removeSelected = useCallback(() => {
    if (selected == null) return;
    onChange(covers.filter((_, i) => i !== selected));
    setSelected(null);
  }, [covers, onChange, selected]);

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "SELECT" || target.tagName === "INPUT")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected != null) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === "r" || e.key === "R") {
        setShape("rect");
      } else if (e.key === "e" || e.key === "E") {
        setShape("ellipse");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, removeSelected, selected]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    const target = e.target as HTMLElement;
    const p = pointAt(e.clientX, e.clientY);
    const corner = target.dataset.corner as Corner | undefined;
    const coverIndex = target.dataset.cover != null ? Number(target.dataset.cover) : null;
    surfaceRef.current!.setPointerCapture(e.pointerId);
    if (corner && selected != null) {
      setDrag({ kind: "resize", index: selected, corner, origin: covers[selected] });
    } else if (coverIndex != null) {
      setSelected(coverIndex);
      setDrag({ kind: "move", index: coverIndex, startX: p.x, startY: p.y, origin: covers[coverIndex] });
    } else {
      setSelected(null);
      setDrag({ kind: "draw", startX: p.x, startY: p.y });
      setDraft({ shape, style, x: p.x, y: p.y, width: 0, height: 0 });
    }
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = pointAt(e.clientX, e.clientY);
    if (drag.kind === "draw") {
      setDraft({ shape, style, ...boxBetween(drag.startX, drag.startY, p.x, p.y) });
    } else if (drag.kind === "move") {
      const o = drag.origin;
      const x = Math.min(1 - o.width, Math.max(0, o.x + p.x - drag.startX));
      const y = Math.min(1 - o.height, Math.max(0, o.y + p.y - drag.startY));
      onChange(covers.map((c, i) => (i === drag.index ? { ...c, x, y } : c)));
    } else {
      const o = drag.origin;
      // The corner opposite the one held stays put.
      const fixedX = drag.corner.endsWith("w") ? o.x + o.width : o.x;
      const fixedY = drag.corner.startsWith("n") ? o.y + o.height : o.y;
      const box = boxBetween(fixedX, fixedY, p.x, p.y);
      if (box.width >= MIN_COVER_SIZE && box.height >= MIN_COVER_SIZE) {
        onChange(covers.map((c, i) => (i === drag.index ? { ...c, ...box } : c)));
      }
    }
  };

  const onPointerUp = () => {
    if (drag?.kind === "draw" && draft) {
      if (draft.width >= MIN_COVER_SIZE * 2 && draft.height >= MIN_COVER_SIZE * 2) {
        onChange([...covers, draft]);
        setSelected(covers.length);
      }
      setDraft(null);
    }
    setDrag(null);
  };

  const restyle = (next: PhotoCoverStyle) => {
    setStyle(next);
    if (selected != null) onChange(covers.map((c, i) => (i === selected ? { ...c, style: next } : c)));
  };
  const reshape = (next: PhotoCoverShape) => {
    setShape(next);
    if (selected != null) onChange(covers.map((c, i) => (i === selected ? { ...c, shape: next } : c)));
  };

  const selectedCover = selected != null ? covers[selected] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.8125rem" }}>
        <label style={{ color: "var(--color-text-secondary)" }} htmlFor="cover-shape">
          Shape
        </label>
        <select
          id="cover-shape"
          value={selectedCover?.shape ?? shape}
          disabled={disabled}
          onChange={(e) => reshape(e.target.value as PhotoCoverShape)}
          style={TOOLBAR_SELECT}
        >
          {PHOTO_COVER_SHAPES.map((s) => (
            <option key={s} value={s}>
              {PHOTO_COVER_SHAPE_LABELS[s]}
            </option>
          ))}
        </select>
        <label style={{ color: "var(--color-text-secondary)" }} htmlFor="cover-style">
          Style
        </label>
        <select
          id="cover-style"
          value={selectedCover?.style ?? style}
          disabled={disabled}
          onChange={(e) => restyle(e.target.value as PhotoCoverStyle)}
          style={TOOLBAR_SELECT}
        >
          {PHOTO_COVER_STYLES.map((s) => (
            <option key={s} value={s}>
              {PHOTO_COVER_STYLE_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled || selected == null}
          onClick={removeSelected}
          style={{ ...TOOLBAR_SELECT, cursor: disabled || selected == null ? "default" : "pointer", opacity: selected == null ? 0.5 : 1 }}
        >
          Remove cover
        </button>
        <span style={{ color: "var(--color-text-muted)", marginLeft: "auto" }}>
          Drag across a symbol to cover it · R / E rectangle or ellipse · Delete removes
        </span>
      </div>
      <div
        ref={areaRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-bg-subtle)",
          borderRadius: "0.5rem",
          overflow: "hidden",
        }}
      >
        <div
          ref={surfaceRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            position: "relative",
            width: fitted?.width ?? "auto",
            height: fitted?.height ?? "auto",
            cursor: disabled ? "default" : "crosshair",
            touchAction: "none",
            userSelect: "none",
            visibility: fitted ? "visible" : "hidden",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- collection-scoped bytes, as every photo here */}
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) =>
              setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
            }
            style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
          />
          {covers.map((cover, i) => (
            <span
              key={i}
              data-cover={i}
              style={{
                ...coverAppearance(cover),
                cursor: disabled ? "default" : "move",
                outline: i === selected ? "2px solid var(--color-action-primary)" : "1px dashed rgba(255,255,255,0.8)",
              }}
            />
          ))}
          {draft && <span aria-hidden style={{ ...coverAppearance(draft), outline: "1px dashed #fff", pointerEvents: "none" }} />}
          {selectedCover &&
            CORNERS.map((corner) => (
              <span
                key={corner}
                data-corner={corner}
                style={{
                  position: "absolute",
                  width: 10,
                  height: 10,
                  marginLeft: -5,
                  marginTop: -5,
                  left: `${(corner.endsWith("w") ? selectedCover.x : selectedCover.x + selectedCover.width) * 100}%`,
                  top: `${(corner.startsWith("n") ? selectedCover.y : selectedCover.y + selectedCover.height) * 100}%`,
                  background: "#fff",
                  border: "1px solid var(--color-action-primary)",
                  cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
