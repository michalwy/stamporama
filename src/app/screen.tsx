import type { CSSProperties, ReactNode } from "react";

/**
 * The frame every screen of a collection is drawn in (#1851): the 2rem margin round it and how it
 * fills the window's height — and **the window's whole width**.
 *
 * A screen is wide by default. Before this each page set its own frame inline, a dozen of them kept
 * #691's 56–64rem Settings column, and a new screen copied the nearest one and inherited its column
 * — so screen after screen arrived as a narrow strip down a wide window and had to be widened on
 * request (#1747, #1801, #1824, #1842). The width now goes to columns, grids and panes; what still
 * holds from #691 and #1465 is that **no single field or line of text runs across the window**, and
 * that is kept by the field or the paragraph, never by narrowing the screen.
 *
 * Its own module, without `"use client"`, so a server page and a client screen can both use it.
 */

/**
 * The screens that **are** narrower than the window, each for a reason of its own — never because
 * it was narrow before. A new cap is a new key here, with its reason, and a line in `ui-shell.md`'s
 * list of the caps kept (pinned in `tests/unit/screen-frame.test.ts`).
 */
export const SCREEN_CAPS = {
  /**
   * The Areas screen (#775). Every level of nesting spends width on indentation while each row also
   * states the catalog configuration in force beside the name (#675), and an uncapped row would
   * strand those chips at the far edge of a wide window from the name they describe.
   */
  areas: "80rem",
  /**
   * A print sheet on screen — a packing list, an enclosure, a cutting list, reference cards. It is
   * the paper's preview: drawn about an A4 page wide, its lines wrap on screen roughly where they
   * will on paper. The print stylesheet lifts the cap (`.print-sheet` in `globals.css`).
   */
  sheet: "56rem",
  /**
   * An offer's specification (#1758), a print sheet too, drawn at the width its share link draws
   * the same document for the buyer (`spec/[token]/page.tsx`), so the collector previews what the
   * buyer will see.
   */
  specification: "60rem",
} as const;

export type ScreenCap = keyof typeof SCREEN_CAPS;

/**
 * How the screen fills the window's height:
 *
 * - `flow` — as tall as its content; the default.
 * - `column` — a flex column at least the window tall, so a list or a detail panel can grow into
 *   what is left of it.
 * - `window` — exactly the window tall, a flex column whose own regions scroll (the Colnect report,
 *   the album page editor); what does not fit scrolls here rather than at the document.
 */
export type ScreenHeight = "flow" | "column" | "window";

const HEIGHT_STYLE: Record<ScreenHeight, CSSProperties> = {
  flow: {},
  column: { minHeight: "100vh", display: "flex", flexDirection: "column" },
  window: { height: "100vh", overflow: "auto", display: "flex", flexDirection: "column" },
};

interface ScreenProps {
  height?: ScreenHeight;
  /** Narrower than the window, for one of `SCREEN_CAPS`' reasons. */
  cap?: ScreenCap;
  /** `print-sheet` for a screen that prints. */
  className?: string;
  children: ReactNode;
}

export function Screen({ height = "flow", cap, className, children }: ScreenProps) {
  return (
    <div
      className={className}
      style={{
        padding: "2rem",
        ...HEIGHT_STYLE[height],
        ...(cap ? { maxWidth: SCREEN_CAPS[cap] } : {}),
      }}
    >
      {children}
    </div>
  );
}
