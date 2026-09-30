"use client";

import { useEffect, useRef, useState } from "react";
import {
  REF_CARD_SAMPLE_REF,
  refCardPreviewScale,
  type RefCardGeometry,
} from "@/lib/ref-card-template-rules";
import { RefCard } from "@/app/c/[collectionSlug]/shared/ref-card";

// A ref card template's preview (#1478): one card, at its proportions, carrying a sample ref — on the
// Settings page beside the list and in the editor beside the fields.
//
// **Nothing here is a second drawing of the card.** It is `RefCard`, the component the printed sheet
// draws each card with, given one number the sheet does not have: the scale. Every millimetre of the
// card is multiplied by it alike, so the preview and a printed card differ in size and in nothing
// else. The scale is the one thing worked out here, off the room on screen and never off the text.
//
// The card is paper in both themes — white ground, black ink — as the album canvas is and for its
// reason (`page-canvas.tsx`): what is being judged is a printed thing, and a token that inverts would
// make dark mode mean a black card. The cut rule is the one the sheet prints (`--color-border-strong`
// on paper, globals.css). Everything around the card is tokens.

const PAPER = "#ffffff";
const INK = "#000000";
const CUT = "1px dashed #777777";

const NOTE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.75rem",
  lineHeight: 1.45,
  color: "var(--color-text-muted)",
  flexShrink: 0,
};

export function RefCardTemplatePreview({
  card,
  problem,
}: {
  card: RefCardGeometry;
  /** Why the card on screen is not the fields as they stand — a value mid-edit the save would
   *  refuse. The last card that parsed stays drawn. */
  problem?: string | null;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });

  // The room the card has — the frame is sized by its column, never by the card in it.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setFrame({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    setFrame({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  const scale = refCardPreviewScale(card, frame);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", gap: "0.625rem" }}>
      <div
        ref={frameRef}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: "var(--color-bg-muted)",
          borderRadius: "0.75rem",
        }}
      >
        {scale !== null && (
          <RefCard
            card={card}
            refText={REF_CARD_SAMPLE_REF}
            scale={scale}
            edges={{ border: CUT }}
            ink={INK}
            style={{
              width: `${card.cardWidthMm * scale}mm`,
              flexShrink: 0,
              background: PAPER,
            }}
          />
        )}
      </div>
      {scale !== null && (
        <p style={NOTE_STYLE}>
          Drawn at {Math.round(scale * 100)} % of the {card.cardWidthMm} × {card.cardHeightMm} mm card
          the sheet prints.
        </p>
      )}
      {problem && (
        <p style={{ ...NOTE_STYLE, color: "var(--color-warning)" }}>Not redrawn: {problem}</p>
      )}
    </div>
  );
}
