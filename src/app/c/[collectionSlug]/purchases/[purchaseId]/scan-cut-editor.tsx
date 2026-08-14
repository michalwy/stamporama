"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import { Icon, type IconName } from "@/app/icons";
import {
  MIN_BOX_EDGE_PX,
  mergeBoxes,
  normalizeBox,
  readingOrder,
  splitBox,
  type Box,
} from "@/lib/scan-boxes";

/**
 * The cut review editor (#566, ADR-0033).
 *
 * **The primitive, not a fallback.** However good detection gets (#574), it will sometimes take two
 * touching stamps for one, halve a dark one, or find a shadow along the card's edge — and a bad cut
 * on a parcel already broken up cannot be undone by re-scanning. So the graphical repair exists
 * first and unconditionally; detection quality decides how often it is reached, never whether it
 * exists. In this issue it is also where every box comes from, drawn by hand.
 *
 * It works in **rectangles** — not because stamps are rectangular, which triangles and diamonds are
 * not, but because a crop is. Nothing here paints a mask or edits an outline.
 *
 * Nothing is created until Commit, so the whole review is free to be wrong.
 *
 * Coordinates are the **sheet's original pixels** throughout, converted for display by one scale
 * factor. That is what `sharp.extract` is handed, it survives the browser being resized mid-cut,
 * and it means a box means the same number here and in the database. The image on screen is the
 * `view` derivative; the crops come from the original.
 */

export interface ScanCutEditorSheet {
  id: string;
  side: "front" | "back";
  batchNo: number;
  /** Original dimensions — the coordinate space every box lives in. */
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
}

interface Props {
  collectionId: string;
  sheet: ScanCutEditorSheet;
  /** A previous cut's boxes, when re-cutting. Empty on a first pass — an empty canvas is the
   * ordinary case here, and #574 is what fills it. */
  initialBoxes: Box[];
  /** How many front tiles the batch already holds, shown while cutting a back so the two counts
   * can be compared *before* committing rather than only in the report afterwards. */
  frontTileCount: number | null;
  committing: boolean;
  error: string | null;
  onCommit: (boxes: Box[]) => void;
  onClose: () => void;
}

/** What the next pointer-down will do. `select` is the resting state; the two split modes are armed
 * by a toolbar button and disarmed by committing one cut or pressing Escape. */
type Mode = "select" | "split-v" | "split-h";

type Drag =
  | { kind: "draw"; originX: number; originY: number; current: Box | null }
  | { kind: "move"; ids: string[]; startX: number; startY: number; origin: Map<string, Box> }
  | { kind: "resize"; id: string; handle: Handle; start: Box };

/** The eight grips. Named by the edges they move, so the maths below is the same for all of them. */
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface Region {
  id: string;
  box: Box;
}

let nextRegionId = 0;
const newRegion = (box: Box): Region => ({ id: `r${nextRegionId++}`, box });

export function ScanCutEditor({
  collectionId,
  sheet,
  initialBoxes,
  frontTileCount,
  committing,
  error,
  onCommit,
  onClose,
}: Props) {
  const [regions, setRegions] = useState<Region[]>(() => initialBoxes.map(newRegion));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("select");
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Where the split guide currently sits, in sheet pixels, while a split mode is armed. */
  const [splitAt, setSplitAt] = useState<number | null>(null);

  const surfaceRef = useRef<HTMLDivElement>(null);
  /** Display pixels per sheet pixel. Measured from the rendered element rather than taken from
   * `viewWidth`, because the image is laid out to fit the dialog and is very often smaller than the
   * view derivative it is drawn from. */
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / sheet.width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sheet.width]);

  const toSheet = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect || scale === 0) return { x: 0, y: 0 };
      return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
    },
    [scale]
  );

  const selectedRegions = useMemo(
    () => regions.filter((r) => selected.has(r.id)),
    [regions, selected]
  );
  const soleSelected = selectedRegions.length === 1 ? selectedRegions[0] : null;

  // Reading order drives the number drawn in each box, so the collector sees the order the tiles
  // will actually be created in — which is the order they will then be worked through in #567.
  const order = useMemo(() => {
    const positions = new Map<string, number>();
    readingOrder(regions.map((r) => r.box)).forEach((regionIndex, position) => {
      positions.set(regions[regionIndex].id, position + 1);
    });
    return positions;
  }, [regions]);

  // ── Editing ────────────────────────────────────────────────────────────────────────────────

  const replaceSelection = useCallback((next: Region[], select: string[]) => {
    setRegions(next);
    setSelected(new Set(select));
  }, []);

  const deleteSelected = useCallback(() => {
    if (selected.size === 0) return;
    replaceSelection(
      regions.filter((r) => !selected.has(r.id)),
      []
    );
  }, [regions, selected, replaceSelection]);

  const mergeSelected = useCallback(() => {
    if (selectedRegions.length < 2) return;
    const merged = mergeBoxes(selectedRegions.map((r) => r.box));
    if (!merged) return;
    const replacement = newRegion(merged);
    replaceSelection(
      [...regions.filter((r) => !selected.has(r.id)), replacement],
      [replacement.id]
    );
  }, [regions, selected, selectedRegions, replaceSelection]);

  const commitSplit = useCallback(
    (at: number) => {
      if (!soleSelected || mode === "select") return;
      const halves = splitBox(soleSelected.box, mode === "split-v" ? "vertical" : "horizontal", at);
      // A cut that would leave a sliver is simply refused; the guide stays up so the collector can
      // aim again, rather than producing a box they then have to notice and delete.
      if (!halves) return;
      const created = halves.map(newRegion);
      replaceSelection(
        [...regions.filter((r) => r.id !== soleSelected.id), ...created],
        created.map((r) => r.id)
      );
      setMode("select");
      setSplitAt(null);
    },
    [mode, regions, soleSelected, replaceSelection]
  );

  // ── Pointer ────────────────────────────────────────────────────────────────────────────────

  const onSurfacePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toSheet(e.clientX, e.clientY);

    if (mode !== "select") {
      commitSplit(mode === "split-v" ? p.x : p.y);
      return;
    }

    // Topmost box under the pointer wins, so a box drawn inside another is still reachable.
    const hit = [...regions].reverse().find((r) => inside(r.box, p));
    if (hit) {
      const nextSelected = e.shiftKey
        ? toggled(selected, hit.id)
        : selected.has(hit.id)
          ? selected
          : new Set([hit.id]);
      setSelected(nextSelected);
      const ids = [...nextSelected];
      setDrag({
        kind: "move",
        ids,
        startX: p.x,
        startY: p.y,
        origin: new Map(regions.filter((r) => nextSelected.has(r.id)).map((r) => [r.id, r.box])),
      });
    } else {
      if (!e.shiftKey) setSelected(new Set());
      setDrag({ kind: "draw", originX: p.x, originY: p.y, current: null });
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onSurfacePointerMove = (e: React.PointerEvent) => {
    const p = toSheet(e.clientX, e.clientY);

    if (mode !== "select") {
      setSplitAt(mode === "split-v" ? p.x : p.y);
      return;
    }
    if (!drag) return;

    if (drag.kind === "draw") {
      setDrag({
        ...drag,
        current: normalizeBox(
          { x: drag.originX, y: drag.originY, w: p.x - drag.originX, h: p.y - drag.originY },
          sheet
        ),
      });
      return;
    }
    if (drag.kind === "move") {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      setRegions((rs) =>
        rs.map((r) => {
          const origin = drag.origin.get(r.id);
          if (!origin) return r;
          // Clamped as a whole rather than per edge: a box dragged past the card's edge stops
          // there keeping its size, instead of being squashed against it.
          return {
            ...r,
            box: {
              ...origin,
              x: Math.round(clamp(origin.x + dx, 0, sheet.width - origin.w)),
              y: Math.round(clamp(origin.y + dy, 0, sheet.height - origin.h)),
            },
          };
        })
      );
      return;
    }
    setRegions((rs) =>
      rs.map((r) => (r.id === drag.id ? { ...r, box: resized(drag.start, drag.handle, p, sheet) } : r))
    );
  };

  const onSurfacePointerUp = () => {
    if (drag?.kind === "draw" && drag.current) {
      const created = newRegion(drag.current);
      setRegions((rs) => [...rs, created]);
      setSelected(new Set([created.id]));
    }
    setDrag(null);
  };

  const onHandlePointerDown = (e: React.PointerEvent, region: Region, handle: Handle) => {
    if (e.button !== 0 || mode !== "select") return;
    e.stopPropagation();
    setSelected(new Set([region.id]));
    setDrag({ kind: "resize", id: region.id, handle, start: region.box });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  // ── Keyboard ───────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape" && mode !== "select") {
        // Taken before the dialog's own Escape layer sees it: the first Escape disarms the split,
        // a second one closes the editor. Closing while aiming a cut would lose the whole cut.
        e.preventDefault();
        e.stopPropagation();
        setMode("select");
        setSplitAt(null);
      } else if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSelected(new Set(regions.map((r) => r.id)));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [deleteSelected, mode, regions]);

  // ── Render ─────────────────────────────────────────────────────────────────────────────────

  const drawing = drag?.kind === "draw" ? drag.current : null;
  const countMismatch =
    sheet.side === "back" && frontTileCount != null && frontTileCount !== regions.length;

  return (
    <DialogShell
      title={`${sheet.side === "front" ? "Front" : "Back"} of batch ${sheet.batchNo} — review the cut`}
      onClose={onClose}
      maxWidth="min(96vw, 88rem)"
      height="92vh"
      // The editor owns Escape while a split is armed, and a stray backdrop click mid-drag must not
      // throw away a card's worth of boxes.
      dismissable={false}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <Toolbar
          count={regions.length}
          selectedCount={selectedRegions.length}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            setSplitAt(null);
          }}
          onDelete={deleteSelected}
          onMerge={mergeSelected}
          onClear={() => replaceSelection([], [])}
        />

        {(countMismatch || error) && (
          <div
            style={{
              padding: "0.625rem 1.25rem",
              fontSize: "0.8125rem",
              background: error ? "var(--color-error-soft)" : "var(--color-warning-soft)",
              color: error ? "var(--color-error)" : "var(--color-warning)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            {error ?? (
              <>
                <strong>
                  Front {frontTileCount}, back {regions.length}.
                </strong>{" "}
                A stamp fell out, two were drawn as one, or this is the wrong file. Committing is
                allowed — what pairs, pairs; the rest is reported.
              </>
            )}
          </div>
        )}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "1rem",
            background: "var(--color-bg-subtle)",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
          }}
        >
          <div
            ref={surfaceRef}
            onPointerDown={onSurfacePointerDown}
            onPointerMove={onSurfacePointerMove}
            onPointerUp={onSurfacePointerUp}
            style={{
              position: "relative",
              width: "100%",
              maxWidth: `${sheet.viewWidth}px`,
              aspectRatio: `${sheet.width} / ${sheet.height}`,
              cursor: mode === "select" ? "crosshair" : "col-resize",
              userSelect: "none",
              touchAction: "none",
              boxShadow: "0 0 0 1px var(--color-border)",
            }}
          >
            {/* A scan is served by an authenticated route at whatever size the card was, which is
                exactly the case `next/image`'s loader cannot size or optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/collections/${collectionId}/scan-sheets/${sheet.id}/view`}
              alt={`${sheet.side} scan of batch ${sheet.batchNo}`}
              draggable={false}
              style={{ display: "block", width: "100%", height: "100%", objectFit: "fill" }}
            />

            {regions.map((r) => (
              <RegionRect
                key={r.id}
                region={r}
                position={order.get(r.id) ?? 0}
                selected={selected.has(r.id)}
                scale={scale}
                interactive={mode === "select"}
                onHandlePointerDown={onHandlePointerDown}
              />
            ))}

            {drawing && (
              <div
                style={{
                  position: "absolute",
                  left: drawing.x * scale,
                  top: drawing.y * scale,
                  width: drawing.w * scale,
                  height: drawing.h * scale,
                  border: "1px dashed var(--color-action-primary)",
                  background: "rgb(59 130 246 / 0.12)",
                  pointerEvents: "none",
                }}
              />
            )}

            {mode !== "select" && soleSelected && splitAt != null && (
              <SplitGuide box={soleSelected.box} axis={mode} at={splitAt} scale={scale} />
            )}
          </div>
        </div>
      </div>

      <DialogFooter>
        <span
          style={{
            marginRight: "auto",
            fontSize: "0.8125rem",
            color: "var(--color-text-muted)",
          }}
        >
          Drag on the card to draw · click a box to select · shift-click to add · Delete removes
        </span>
        <DialogSecondaryButton onClick={onClose} disabled={committing}>
          Cancel
        </DialogSecondaryButton>
        <DialogPrimaryButton
          type="button"
          onClick={() => onCommit(orderedBoxes(regions))}
          disabled={committing || regions.length === 0}
        >
          {committing
            ? "Cutting…"
            : `Cut ${regions.length} ${regions.length === 1 ? "tile" : "tiles"}`}
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>
  );
}

/** Boxes in reading order — the order the tiles are created in, and the order the numbers on
 * screen have been promising all along. */
function orderedBoxes(regions: readonly Region[]): Box[] {
  const boxes = regions.map((r) => r.box);
  return readingOrder(boxes).map((i) => boxes[i]);
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────

function Toolbar({
  count,
  selectedCount,
  mode,
  onMode,
  onDelete,
  onMerge,
  onClear,
}: {
  count: number;
  selectedCount: number;
  mode: Mode;
  onMode: (m: Mode) => void;
  onDelete: () => void;
  onMerge: () => void;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.75rem 1.25rem",
        borderBottom: "1px solid var(--color-border)",
        flexWrap: "wrap",
      }}
    >
      <strong style={{ fontSize: "0.875rem" }}>
        {count} {count === 1 ? "box" : "boxes"}
      </strong>
      <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
        {selectedCount > 0 ? `${selectedCount} selected` : "nothing selected"}
      </span>
      <span style={{ flex: 1 }} />
      <ToolButton
        icon="merge"
        label="Merge"
        hint="Two boxes that halved one stamp become the rectangle holding both"
        disabled={selectedCount < 2}
        onClick={onMerge}
      />
      <ToolButton
        icon="splitColumns"
        label="Split ↔"
        hint="Cut the selected box into a left and a right — click where the seam is"
        disabled={selectedCount !== 1}
        active={mode === "split-v"}
        onClick={() => onMode(mode === "split-v" ? "select" : "split-v")}
      />
      <ToolButton
        icon="splitRows"
        label="Split ↕"
        hint="Cut the selected box into a top and a bottom"
        disabled={selectedCount !== 1}
        active={mode === "split-h"}
        onClick={() => onMode(mode === "split-h" ? "select" : "split-h")}
      />
      <ToolButton
        icon="delete"
        label="Delete"
        hint="Remove the selected boxes — a shadow, a fibre, the card's edge"
        disabled={selectedCount === 0}
        onClick={onDelete}
      />
      <ToolButton
        icon="clear"
        label="Clear all"
        hint="Start the cut again from an empty card"
        disabled={count === 0}
        onClick={onClear}
      />
    </div>
  );
}

function ToolButton({
  icon,
  label,
  hint,
  disabled,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        padding: "0.3125rem 0.625rem",
        borderRadius: "0.375rem",
        fontSize: "0.8125rem",
        border: "1px solid var(--color-border-strong)",
        background: active ? "var(--color-action-primary)" : "var(--color-bg-elevated)",
        color: active ? "#fff" : "var(--color-text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon name={icon} size="sm" />
      {label}
    </button>
  );
}

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function RegionRect({
  region,
  position,
  selected,
  scale,
  interactive,
  onHandlePointerDown,
}: {
  region: Region;
  position: number;
  selected: boolean;
  scale: number;
  interactive: boolean;
  onHandlePointerDown: (e: React.PointerEvent, region: Region, handle: Handle) => void;
}) {
  const { box } = region;
  return (
    <div
      style={{
        position: "absolute",
        left: box.x * scale,
        top: box.y * scale,
        width: box.w * scale,
        height: box.h * scale,
        border: `${selected ? 2 : 1}px solid ${
          selected ? "var(--color-action-primary)" : "rgb(255 255 255 / 0.85)"
        }`,
        background: selected ? "rgb(59 130 246 / 0.16)" : "transparent",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          padding: "0 0.25rem",
          fontSize: "0.6875rem",
          fontWeight: 600,
          lineHeight: 1.4,
          background: selected ? "var(--color-action-primary)" : "rgb(0 0 0 / 0.6)",
          color: "#fff",
        }}
      >
        {position}
      </span>
      {selected &&
        interactive &&
        HANDLES.map((h) => (
          <span
            key={h}
            onPointerDown={(e) => onHandlePointerDown(e, region, h)}
            style={{
              position: "absolute",
              width: 10,
              height: 10,
              marginLeft: -5,
              marginTop: -5,
              borderRadius: 2,
              background: "var(--color-action-primary)",
              border: "1px solid #fff",
              cursor: `${h}-resize`,
              pointerEvents: "auto",
              ...handleOffset(h),
            }}
          />
        ))}
    </div>
  );
}

function handleOffset(h: Handle): React.CSSProperties {
  const left = h.includes("w") ? "0%" : h === "n" || h === "s" ? "50%" : "100%";
  const top = h.includes("n") ? "0%" : h === "e" || h === "w" ? "50%" : "100%";
  return { left, top };
}

/** The line the next click will cut along, drawn inside the box it would cut. */
function SplitGuide({
  box,
  axis,
  at,
  scale,
}: {
  box: Box;
  axis: "split-v" | "split-h";
  at: number;
  scale: number;
}) {
  const vertical = axis === "split-v";
  const within =
    vertical
      ? at > box.x + MIN_BOX_EDGE_PX && at < box.x + box.w - MIN_BOX_EDGE_PX
      : at > box.y + MIN_BOX_EDGE_PX && at < box.y + box.h - MIN_BOX_EDGE_PX;
  return (
    <div
      style={{
        position: "absolute",
        left: vertical ? at * scale : box.x * scale,
        top: vertical ? box.y * scale : at * scale,
        width: vertical ? 0 : box.w * scale,
        height: vertical ? box.h * scale : 0,
        // Red where the cut would leave a sliver and so would be refused — the refusal is visible
        // before the click rather than as nothing happening after it.
        borderLeft: vertical ? `2px solid ${within ? "#fff" : "var(--color-error)"}` : undefined,
        borderTop: vertical ? undefined : `2px solid ${within ? "#fff" : "var(--color-error)"}`,
        pointerEvents: "none",
      }}
    />
  );
}

// ── Geometry helpers ─────────────────────────────────────────────────────────────────────────

function inside(box: Box, p: { x: number; y: number }): boolean {
  return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function toggled(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** A box with one grip dragged to `p`. Each handle moves the edges its name contains; the result
 * goes back through `normalizeBox`, so dragging an edge past its opposite flips the box rather
 * than inverting it, and the sheet's bounds are respected the same way everywhere. */
function resized(
  start: Box,
  handle: Handle,
  p: { x: number; y: number },
  sheet: { width: number; height: number }
): Box {
  let { x, y, w, h } = start;
  if (handle.includes("w")) {
    const right = x + w;
    x = p.x;
    w = right - x;
  }
  if (handle.includes("e")) w = p.x - x;
  if (handle.includes("n")) {
    const bottom = y + h;
    y = p.y;
    h = bottom - y;
  }
  if (handle.includes("s")) h = p.y - y;
  return normalizeBox({ x, y, w, h }, sheet) ?? start;
}
