"use client";

import type { CSSProperties, ReactNode } from "react";

// The lot builder's own chrome — the handful of shapes its two halves share (#760).
//
// The screen is a **single** rounded, clipped, elevated container holding the area rail and the work
// beside it, which is the shape every area-picking screen in this app already has (the copies list,
// the stamps list, the bulk listing workspace). Everything stacked inside it is therefore a *band*
// divided by a rule rather than a card: inside a card, a card says only "another box".
//
// Two shades do all the work. A **band** is the container's own white — it is part of the card, not
// a thing sitting on it. A **frame** is `--color-bg-page` inside that white, the recessed shape the
// holdings and offer summary bars already use for "figures over the current scope"; it reads as
// *inset* only because there is white around it, which is exactly what this screen used to lack —
// its boxes were page-coloured on the page itself, so nothing but a hairline showed and the whole
// screen looked half-drawn.

/** One section of the work column: a rule under it, the container's own background. */
export const BAND: CSSProperties = {
  padding: "0.875rem 1.25rem",
  borderBottom: "1px solid var(--color-border)",
};

/** A recessed block **inside** a band — a row of figures, a callout, the create-the-offer form. */
export const FIGURE_FRAME: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
  padding: "0.625rem 1rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-page)",
};

export const NOTE: CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/**
 * A section's name, and one line saying what it is for.
 *
 * The two criteria bands had no headings at all, which is most of what made the screen read as
 * unfinished: ten controls in two anonymous strips, with nothing to say that the first decides
 * *which copies are eligible* and the second *what to do with them*. The name takes the uppercase
 * micro-heading every card in this app uses; the sentence beside it is muted and sits on the same
 * baseline, so it explains without competing.
 */
export function SectionHeading({
  title,
  note,
  actions,
}: {
  title: string;
  note?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "0.625rem",
        flexWrap: "wrap",
        marginBottom: "0.75rem",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: "0.75rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--color-text-secondary)",
        }}
      >
        {title}
      </h3>
      {note ? <span style={NOTE}>{note}</span> : null}
      {actions ? (
        <>
          <span style={{ flex: 1 }} />
          {actions}
        </>
      ) : null}
    </div>
  );
}

/** What the work column says when it has nothing to draw yet. The list screens' empty note, to the
 *  character — a screen that explains itself in the same voice everywhere is the point. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "2rem 1.25rem",
        color: "var(--color-text-muted)",
        fontSize: "0.9375rem",
        lineHeight: 1.6,
        maxWidth: "40rem",
      }}
    >
      {children}
    </div>
  );
}

/** A shimmering placeholder block, the one the summary bars use: a loading readout keeps its final
 *  height so the screen does not jump as figures arrive (#151). */
export function SkeletonBlock({ style }: { style: CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        ...style,
        display: "inline-block",
        borderRadius: "0.25rem",
        background: "var(--color-border)",
        color: "transparent",
      }}
    >
      &nbsp;
    </span>
  );
}

/**
 * A callout inside the proposal: something the pick has to say for itself — a set left out, a pinned
 * copy that can no longer be listed, copies promised in a trade.
 *
 * `tone` colours the **border only**, the idiom the bulk listing workspace already uses for its
 * export refusals: a full soft-tinted panel would shout, and these are things to notice on the way
 * past, not errors.
 */
export function Callout({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warning";
  children: ReactNode;
}) {
  return (
    <div
      style={{
        ...FIGURE_FRAME,
        padding: "0.625rem 0.875rem",
        borderColor: tone === "warning" ? "var(--color-warning-border)" : "var(--color-border)",
        fontSize: "0.8125rem",
        color: "var(--color-text-secondary)",
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
