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
// it as drawn. So the first page's is covered by the plain heading: an overlay pinned to the top of
// the group, laid out from the same markup with the marker kept but invisible, so it wraps exactly as
// the copy under it does and hides all of it. Absolutely positioned at the group's top, it prints in
// the group's first page and nowhere else.
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
    <section style={{ marginTop: "1.25rem", position: "relative" }}>
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
        <tbody>{children}</tbody>
      </table>
      <div
        aria-hidden
        style={{ position: "absolute", top: 0, left: 0, right: 0, background: "var(--color-bg-page)" }}
      >
        <Heading heading={heading} mark="hidden" />
      </div>
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
