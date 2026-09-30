import type { CSSProperties } from "react";
import type { RefCardGeometry } from "@/lib/ref-card-template-rules";

// One blank ref card (#565, #569) — the drawing the printed sheet and the Settings preview (#1478)
// both use, so the two cannot disagree about where the ref sits or how big it is.
//
// No `"use client"` and no hooks: the sheet is a server render and the preview a client one, and a
// plain component serves both. What differs between them is passed in and is never geometry — the
// **scale** (the preview enlarges the card to its room, every millimetre multiplied alike), the
// **edges** (the sheet's cards share their cut rules with their neighbours, the preview's one card
// draws all four), and the **ink** (the sheet uses tokens, which print black; the preview is paper
// in both themes, as the album canvas is).

/** The sheet's cut guide. One definition, so every rule on a sheet is the same weight whichever of
 *  the cards or the container drew it. */
export const REF_CARD_CUT_RULE = "1px dashed var(--color-border-strong)";

export function RefCard({
  card,
  refText,
  scale = 1,
  edges,
  ink = "var(--color-text-primary)",
  style,
}: {
  card: RefCardGeometry;
  refText: string;
  /** Every millimetre of the card is multiplied by this; 1 is the printed size. */
  scale?: number;
  /** The card's own borders. The sheet's draw right and bottom only (see the sheet's note on zero
   *  gap); a card on its own draws all four. */
  edges: Pick<CSSProperties, "border" | "borderRight" | "borderBottom">;
  ink?: string;
  /** Anything else about the card's box that is not geometry — its width when no grid gives it one,
   *  the page break rule on paper, a paper ground. */
  style?: CSSProperties;
}) {
  const mm = (value: number) => `${value * scale}mm`;
  return (
    <div
      style={{
        ...edges,
        boxSizing: "border-box",
        height: mm(card.cardHeightMm),
        // The ref is pinned to the top, not centred: the rest of the card disappears into the
        // transport card's pocket once the stamps are packed onto it.
        paddingTop: mm(card.paddingTopMm),
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        ...style,
      }}
    >
      <span
        style={{
          fontSize: mm(card.fontSizeMm),
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: "0.05em",
          fontVariantNumeric: "tabular-nums",
          color: ink,
        }}
      >
        {refText}
      </span>
    </div>
  );
}
