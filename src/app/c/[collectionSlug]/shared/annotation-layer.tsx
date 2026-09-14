"use client";

import type { Annotation } from "@/lib/annotations";

/**
 * The marks drawn over a picture (#674), as SVG elements for a layer already sized to the picture on
 * screen.
 *
 * Its own component rather than a branch inside the tile viewer, for ADR-0049's sake: the comparison
 * view must be able to put an annotation layer over its pictures later without a second copy of the
 * drawing code coming to exist. It knows a list of shapes in the picture's own pixels and the scale
 * they are drawn at, and nothing about tiles, photos or who is looking.
 *
 * Dark under light, as every mark on a scan is — a stamp is white paper in some places and printing
 * ink in others. The snapshot draws the same shapes the same way (`snapshotOverlaySvg`).
 */
export function AnnotationShapes({
  annotations,
  scale,
}: {
  annotations: readonly Annotation[];
  scale: number;
}) {
  return (
    <>
      {annotations.map((mark, index) => (
        <AnnotationShape key={index} mark={mark} scale={scale} />
      ))}
    </>
  );
}

const STROKES = [
  { stroke: "rgba(0,0,0,0.65)", width: 3 },
  { stroke: "#fff", width: 1 },
] as const;

function AnnotationShape({ mark, scale }: { mark: Annotation; scale: number }) {
  if (mark.kind === "ellipse") {
    const x = Math.min(mark.a.x, mark.b.x) * scale;
    const y = Math.min(mark.a.y, mark.b.y) * scale;
    const w = Math.abs(mark.b.x - mark.a.x) * scale;
    const h = Math.abs(mark.b.y - mark.a.y) * scale;
    return (
      <>
        {STROKES.map((s) => (
          <ellipse
            key={s.stroke}
            cx={x + w / 2}
            cy={y + h / 2}
            rx={w / 2}
            ry={h / 2}
            fill="none"
            stroke={s.stroke}
            strokeWidth={s.width}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {STROKES.map((s) => (
        <line
          key={s.stroke}
          x1={mark.a.x * scale}
          y1={mark.a.y * scale}
          x2={mark.b.x * scale}
          y2={mark.b.y * scale}
          stroke={s.stroke}
          strokeWidth={s.width}
        />
      ))}
    </>
  );
}
