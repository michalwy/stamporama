"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  DEFAULT_PHOTO_COVER_COLOR,
  MIN_COVER_SIZE,
  normalizeCoverColor,
  normalizePhotoCoverShape,
  PHOTO_COVER_PALETTE,
  PHOTO_COVER_SHAPE_LABELS,
  PHOTO_COVER_SHAPES,
  PHOTO_COVER_STYLE_LABELS,
  PHOTO_COVER_STYLES,
  type PhotoCover,
  type PhotoCoverShape,
  type PhotoCoverStyle,
} from "@/lib/photo-cover-rules";
import { Tooltip } from "./tooltip";
import { usePersistedCollectionValue } from "./use-persisted-collection-value";

// Drawing covers over a copy's photo (#1665; ADR-0066). Geometry is kept in fractions of the photo, as
// it is stored, so the picture can be drawn at whatever size the dialog has room for.
//
// What is drawn here is an **indication** of each style, not its render: a bar is its colour, a blur is a
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
  if (cover.style === "bar") return { ...base, background: cover.color ?? DEFAULT_PHOTO_COVER_COLOR };
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

/** Where the colour last given to a bar is remembered, per collection on this browser (#1702). */
const COVER_COLOR_NAMESPACE = "photo-cover-color";

/** Where the shape last chosen for a new cover is remembered, the same way as the colour (#1761). */
const COVER_SHAPE_NAMESPACE = "photo-cover-shape";

/**
 * A bar's colour (#1702): the short palette as swatches, and any other colour from the browser's
 * picker. Used by the editor's toolbar and by the platform's settings, so the two offer one choice.
 */
export function CoverColorPicker({
  value,
  onChange,
  disabled = false,
  id,
}: {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
      {PHOTO_COVER_PALETTE.map((swatch) => (
        <Tooltip key={swatch.color} content={swatch.label}>
          <button
            type="button"
            aria-label={swatch.label}
            aria-pressed={value === swatch.color}
            disabled={disabled}
            onClick={() => onChange(swatch.color)}
            style={{
              width: "1.25rem",
              height: "1.25rem",
              padding: 0,
              borderRadius: "0.25rem",
              background: swatch.color,
              border: "1px solid var(--color-border)",
              outline: value === swatch.color ? "2px solid var(--color-action-primary)" : "none",
              outlineOffset: 1,
              cursor: disabled ? "default" : "pointer",
            }}
          />
        </Tooltip>
      ))}
      <Tooltip content="Any other colour">
        <input
          id={id}
          type="color"
          aria-label="Any other colour"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const next = normalizeCoverColor(e.target.value);
            if (next) onChange(next);
          }}
          style={{ width: "2rem", height: "1.5rem", padding: 0, border: "none", background: "none", cursor: disabled ? "default" : "pointer" }}
        />
      </Tooltip>
    </span>
  );
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
 * style. A bar starts in the colour last given to one on this browser, or the platform's the first
 * time (#1702); a new cover in the shape last chosen on this browser, or a rectangle (#1761).
 *
 * The editor: the photo as large as the space allows, covers drawn by dragging, a cover selected by
 * clicking it, moved by dragging it and resized by its corners, removed with Delete — or all at
 * once with *Clear all*, which a proposal carried from the previous photo needs (#1703). The shape,
 * style and bar colour of the *next* cover are chosen in the toolbar, which also restyles the
 * selected one.
 */
export function PhotoCoverEditor({
  collectionId,
  src,
  covers,
  onChange,
  defaultStyle,
  defaultColor,
  disabled = false,
}: {
  collectionId: string;
  src: string;
  covers: readonly PhotoCover[];
  onChange: (covers: PhotoCover[]) => void;
  defaultStyle: PhotoCoverStyle;
  /** The colour the first bar starts in — the platform's (#1702). */
  defaultColor: string;
  disabled?: boolean;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [area, setArea] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [style, setStyle] = useState<PhotoCoverStyle>(defaultStyle);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<PhotoCover | null>(null);
  const [lastColor, setLastColor] = usePersistedCollectionValue(COVER_COLOR_NAMESPACE, collectionId);
  // The colour the next bar is drawn in: the last one used, else the platform's.
  const color = normalizeCoverColor(lastColor) ?? defaultColor;
  const [lastShape, setShape] = usePersistedCollectionValue(COVER_SHAPE_NAMESPACE, collectionId);
  // The shape the next cover is drawn in: the last one chosen, else a rectangle.
  const shape = normalizePhotoCoverShape(lastShape);
  /** The next cover as the toolbar stands — a bar in the current colour, anything else in none. */
  const next = (box: { x: number; y: number; width: number; height: number }): PhotoCover =>
    style === "bar" ? { shape, style, color, ...box } : { shape, style, ...box };

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
  }, [disabled, removeSelected, selected, setShape]);

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
      setDraft(next({ x: p.x, y: p.y, width: 0, height: 0 }));
    }
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = pointAt(e.clientX, e.clientY);
    if (drag.kind === "draw") {
      setDraft(next(boxBetween(drag.startX, drag.startY, p.x, p.y)));
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
    // A cover turned into a bar gets the current colour unless it was a bar of its own colour before.
    if (selected != null) {
      onChange(
        covers.map((c, i) =>
          i === selected ? { ...c, style: next, ...(next === "bar" && !c.color ? { color } : {}) } : c
        )
      );
    }
  };
  const recolor = (next: string) => {
    setLastColor(next);
    if (selected != null && covers[selected]?.style === "bar") {
      onChange(covers.map((c, i) => (i === selected ? { ...c, color: next } : c)));
    }
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
        {(selectedCover?.style ?? style) === "bar" && (
          <>
            <label style={{ color: "var(--color-text-secondary)" }} htmlFor="cover-color">
              Colour
            </label>
            <CoverColorPicker
              id="cover-color"
              value={selectedCover?.style === "bar" ? (selectedCover.color ?? DEFAULT_PHOTO_COVER_COLOR) : color}
              disabled={disabled}
              onChange={recolor}
            />
          </>
        )}
        <button
          type="button"
          disabled={disabled || selected == null}
          onClick={removeSelected}
          style={{ ...TOOLBAR_SELECT, cursor: disabled || selected == null ? "default" : "pointer", opacity: selected == null ? 0.5 : 1 }}
        >
          Remove cover
        </button>
        <button
          type="button"
          disabled={disabled || covers.length === 0}
          onClick={() => {
            setSelected(null);
            onChange([]);
          }}
          style={{ ...TOOLBAR_SELECT, cursor: disabled || covers.length === 0 ? "default" : "pointer", opacity: covers.length === 0 ? 0.5 : 1 }}
        >
          Clear all
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
