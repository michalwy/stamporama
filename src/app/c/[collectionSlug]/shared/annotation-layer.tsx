"use client";

import {
  ANNOTATION_FONT_FAMILY,
  markPrimitives,
  type Primitive,
  type SnapshotMark,
} from "@/lib/annotations";

/**
 * The marks drawn over a picture (#674, #1300), as SVG elements for a layer already sized to the
 * picture on screen.
 *
 * Its own component rather than a branch inside the tile viewer, for ADR-0049's sake: the comparison
 * view must be able to put an annotation layer over its pictures later without a second copy of the
 * drawing code coming to exist. It knows a list of shapes in the picture's own pixels, each in its own
 * style (#1342), and the scale they are drawn at — nothing about tiles, photos or who is looking.
 *
 * What it draws is `markPrimitives`' answer — the very primitives the snapshot is rendered from
 * (`snapshotOverlaySvg`), so the photo a snapshot keeps is this layer at the snapshot's resolution.
 */
export function AnnotationShapes({ marks, scale }: { marks: readonly SnapshotMark[]; scale: number }) {
  const place = { origin: { x: 0, y: 0 }, scale, screen: 1 };
  return (
    <>
      {marks.map((mark, index) => (
        <g key={index}>
          {markPrimitives(mark, place).map((p, i) => (
            <PrimitiveShape key={i} p={p} />
          ))}
        </g>
      ))}
    </>
  );
}

function PrimitiveShape({ p }: { p: Primitive }) {
  switch (p.type) {
    case "line":
      return (
        <line
          x1={p.x1}
          y1={p.y1}
          x2={p.x2}
          y2={p.y2}
          stroke={p.stroke}
          strokeWidth={p.width}
          strokeLinecap="round"
        />
      );
    case "ellipse":
      return (
        <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill="none" stroke={p.stroke} strokeWidth={p.width} />
      );
    case "rect":
      return (
        <rect x={p.x} y={p.y} width={p.w} height={p.h} fill="none" stroke={p.stroke} strokeWidth={p.width} />
      );
    case "circle":
      return <circle cx={p.cx} cy={p.cy} r={p.r} fill="none" stroke={p.stroke} strokeWidth={p.width} />;
    case "plate":
      return <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill={p.fill} />;
    case "text": {
      const common = {
        x: p.x,
        y: p.y,
        fontFamily: ANNOTATION_FONT_FAMILY,
        fontSize: p.size,
        fontWeight: p.weight,
        textAnchor: p.anchor,
        style: { whiteSpace: "pre" as const },
      };
      return (
        <>
          {p.halo && (
            <text {...common} fill="none" stroke={p.halo} strokeWidth={p.haloWidth} strokeLinejoin="round">
              {p.text}
            </text>
          )}
          <text {...common} fill={p.fill}>
            {p.text}
          </text>
        </>
      );
    }
  }
}
