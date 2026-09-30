"use client";

import { useState } from "react";
import {
  collagePreviewCapacity,
  planCollagePreview,
  type CollagePreviewValues,
} from "@/lib/collage-preview";
import { LABEL_FONT_FAMILY, fitTileLabels, labelInkColor } from "@/lib/collage-label";

// The collage template's preview (#1477): the image a template's numbers lay out, on numbered
// placeholder stamps. One component for both places it is drawn — beside the list on the Settings
// page, from a stored template, and beside the fields in the editor, from the fields as they are
// typed — so the two cannot disagree (ADR-0059 §5).
//
// The planning is `collage-preview.ts`, which is the renderer's own geometry; this file only paints
// it. Unlike the album preview there is no round trip: the whole plan is arithmetic on a few numbers,
// so it redraws on the keystroke itself.

/** A placeholder scan's paper, its edge and its number. Fixed rather than themed: they stand for a
 *  scan, which looks the same in either theme, drawn on the template's own background. */
const PAPER = "#f1ece0";
const PAPER_BACK = "#ddd6c6";
const PAPER_EDGE = "#a89f8b";
const PAPER_INK = "#7d7462";

const NOTE_STYLE: React.CSSProperties = {
  fontSize: "0.75rem",
  lineHeight: 1.45,
  color: "var(--color-text-muted)",
  margin: 0,
};

/** The drawing alone, fitted to the box it is given and never cropped. */
function CollageDrawing({
  values,
  background,
  count,
}: {
  values: CollagePreviewValues;
  background: string;
  count: number;
}) {
  const plan = planCollagePreview(values, count);
  const ink = labelInkColor(background);
  const edge = Math.min(...plan.cells.flatMap((c) => c.scans.map((s) => Math.min(s.width, s.height))));

  return (
    <svg
      role="img"
      aria-label={`Collage of ${plan.cells.length} placeholder stamps, ${plan.rowCount} ${plan.rowCount === 1 ? "row" : "rows"}`}
      viewBox={`0 0 ${plan.width} ${plan.height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <rect
        width={plan.width}
        height={plan.height}
        fill={background}
        style={{ stroke: "var(--color-border-strong)" }}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {plan.cells.map((cell) => (
        <g key={cell.number}>
          {cell.scans.map((scan) => (
            <g key={scan.side ?? "scan"}>
              <rect
                x={scan.x}
                y={scan.y}
                width={scan.width}
                height={scan.height}
                fill={scan.side === "back" ? PAPER_BACK : PAPER}
                stroke={PAPER_EDGE}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={scan.x + scan.width / 2}
                y={scan.y + scan.height / 2 + edge * 0.1}
                fontSize={edge * 0.3}
                fontFamily={LABEL_FONT_FAMILY}
                fill={PAPER_INK}
                textAnchor="middle"
              >
                {cell.number}
              </text>
              {scan.side && (
                <text
                  x={scan.x + scan.width / 2}
                  y={scan.y + scan.height / 2 + edge * 0.3}
                  fontSize={edge * 0.1}
                  fontFamily={LABEL_FONT_FAMILY}
                  fill={PAPER_INK}
                  textAnchor="middle"
                >
                  {scan.side}
                </text>
              )}
            </g>
          ))}
          {/* The caption at the size the strip gives it, fitted by the renderer's own rule (#337). */}
          {fitTileLabels({ left: `Label ${cell.number}` }, cell.label).map((placed) => (
            <text
              key={placed.anchor}
              x={placed.x}
              y={placed.y}
              fontSize={placed.fontSize}
              fontFamily={LABEL_FONT_FAMILY}
              fill={ink}
              textAnchor={placed.anchor}
            >
              {placed.text}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}

/**
 * The preview with its one control: how many stamps to lay out. A template is a maximum rather than
 * a frame, and the automatic grid only differs from the fixed one below capacity — at a full image the
 * two are the same picture — so the count is what makes the grid choice visible. It is the preview's
 * and is never saved; left at the top of its range it follows the capacity as the fields change.
 */
export function CollageTemplatePreviewPanel({
  values,
  background,
  problem,
}: {
  values: CollagePreviewValues;
  background: string;
  /** Why the drawing is not of the fields as they stand — a value that would not save. The last
   *  good drawing stays on screen. */
  problem?: string | null;
}) {
  const capacity = collagePreviewCapacity(values);
  /** Null is *a full image*, whatever the capacity becomes. */
  const [count, setCount] = useState<number | null>(null);
  const shown = count === null ? capacity : Math.min(count, capacity);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: "0.625rem",
      }}
    >
      {capacity > 1 && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.625rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary)",
            flexShrink: 0,
          }}
        >
          Stamps
          <input
            type="range"
            min={1}
            max={capacity}
            value={shown}
            onChange={(e) => {
              const next = Number(e.target.value);
              setCount(next >= capacity ? null : next);
            }}
            style={{ flex: "0 1 16rem", minWidth: 0 }}
          />
          <span style={{ color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
            {shown === capacity ? `${shown}, a full image` : `${shown} of ${capacity}`}
          </span>
        </label>
      )}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
        <CollageDrawing values={values} background={background} count={shown} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", flexShrink: 0 }}>
        <p style={NOTE_STYLE}>
          Placeholder stamps, all one size — a real collage keeps each stamp&rsquo;s true size.
        </p>
        {problem && (
          <p style={{ ...NOTE_STYLE, color: "var(--color-warning)" }}>Not redrawn: {problem}</p>
        )}
      </div>
    </div>
  );
}
