"use client";

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

// A headed group of rows on a printed sheet (#2559): a sold set on a packing list or an order
// summary, a shelf on a packing checklist. On paper three things hold for it:
//
// - **The heading never ends a page alone.** It is the first row of the table's `<thead>`, above the
//   column header, and the print stylesheet keeps the `<thead>` with the first copy row
//   (`.print-group-head`). As a block of its own above the table it could not be held there: the
//   set's numbers line sat between the two, and a page broke under it with every copy overleaf.
// - **A copy row is never split** — `tr { break-inside: avoid }` in the print stylesheet.
// - **A group running over a page break repeats its heading**, marked *(cont.)*, with the column
//   header, because the browser repeats a `<thead>` on every page the table continues on.
//
// The `<thead>` copy is the *continued* one, and it is the same on every page — the browser repeats
// it as drawn. So the first page's is covered by the plain heading: an overlay laid out from the same
// markup with the marker kept but invisible, so it wraps exactly as the copy under it does and hides
// all of it.
//
// **The overlay hangs from the group's first body row, never from the group** (#2569). Positioned
// against the whole group, whose box breaks across pages, Chrome drew it one heading lower than the
// `<thead>` on every group that ran over a break — both headings printed, the plain one over the
// column header and the first copy. Its containing block is now a zero-height row at the top of the
// `<tbody>` (`.print-group-anchor`): a row is never split and is kept with the `<thead>`, so the
// overlay's box never breaks and lands on the group's first page only. It hangs *up* from there: the
// plain heading, then a hidden copy of the column header as a spacer, which is as tall as the real
// one because a column header never wraps (`white-space: nowrap` on every sheet's `<th>`).
//
// The heading cell spans the whole table but must not widen a column: its content is
// `contain: inline-size`, so it adds nothing to the table's intrinsic width and takes whatever width
// the columns leave.

export interface PrintGroupHeading {
  /** The group's name, at the left. */
  title: React.ReactNode;
  /** What follows the name in small type: the copy count, and a note after it. */
  meta?: React.ReactNode;
  /** At the right edge, in tabular figures: a set's price. */
  aside?: string | null;
  /** One muted line under the heading, ellipsized, its full text on hover: a set's numbers. */
  subline?: string | null;
}

const H2: React.CSSProperties = {
  margin: "0 0 0.375rem",
  fontSize: "0.9375rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  display: "flex",
  alignItems: "baseline",
  gap: "0.5rem",
  flexWrap: "wrap",
};

const META: React.CSSProperties = { fontSize: "0.75rem", fontWeight: 500, color: "var(--color-text-muted)" };

const SUBLINE: React.CSSProperties = {
  minWidth: 0,
  margin: "-0.25rem 0 0.375rem",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** The marker a heading repeated at the top of a page carries. */
export const CONTINUED_MARK = "(cont.)";

/**
 * One group: its heading, then — when there is a `columnHeader` — its rows in a table whose header
 * carries the heading too. `columns` is how many cells a row has, screen-only ones included.
 */
export function PrintGroup({
  heading,
  columns,
  columnHeader,
  children,
}: {
  heading: PrintGroupHeading;
  columns: number;
  /** The column header's `<tr>`; without one the group is its heading alone, with no rows. */
  columnHeader?: React.ReactNode;
  /** The group's rows. */
  children?: React.ReactNode;
}) {
  if (!columnHeader) {
    return (
      <section style={{ marginTop: "1.25rem" }}>
        <Heading heading={heading} mark="none" />
      </section>
    );
  }
  return (
    <section style={{ marginTop: "1.25rem" }}>
      {/* Auto layout (the browser default): every column takes exactly the width its content needs,
          so a sheet without long series names stays tight instead of holding empty space. */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead className="print-group-head">
          <tr>
            <td colSpan={columns} style={{ padding: 0, border: 0 }}>
              <Heading heading={heading} mark="shown" />
            </td>
          </tr>
          {columnHeader}
        </thead>
        <tbody>
          {/* The plain heading over the first page's `<thead>` copy — see the note at the top. */}
          <tr className="print-group-anchor" aria-hidden style={{ position: "relative" }}>
            <td colSpan={columns} style={{ padding: 0, border: 0, height: 0 }}>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
                <div style={{ background: "var(--color-bg-page)" }}>
                  <Heading heading={heading} mark="hidden" />
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", visibility: "hidden" }}>
                  <thead>{columnHeader}</thead>
                </table>
              </div>
            </td>
          </tr>
          {children}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The heading as drawn. `mark` is the *(cont.)* marker: `shown` in the `<thead>` copy that every page
 * repeats, `hidden` (laid out, not seen) in the first page's overlay so the two wrap alike, `none`
 * for a group with no rows.
 */
function Heading({ heading, mark }: { heading: PrintGroupHeading; mark: "shown" | "hidden" | "none" }) {
  const { title, meta, aside, subline } = heading;
  return (
    <div style={{ contain: "inline-size" }}>
      {/* The overlay is `aria-hidden`; the heading a reader meets is the `<thead>` copy, and its
          marker is hidden from it, as the first page shows none. */}
      <h2 style={H2}>
        <span>
          {title}
          {mark !== "none" && (
            <span aria-hidden style={{ visibility: mark === "hidden" ? "hidden" : undefined }}>
              {" "}
              {CONTINUED_MARK}
            </span>
          )}
        </span>
        {meta && <span style={META}>{meta}</span>}
        {aside && (
          <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {aside}
          </span>
        )}
      </h2>
      {subline && (
        <Tooltip content={subline} maxWidth="32rem" style={{ display: "flex", minWidth: 0, maxWidth: "100%" }}>
          <div style={SUBLINE}>{subline}</div>
        </Tooltip>
      )}
    </div>
  );
}
