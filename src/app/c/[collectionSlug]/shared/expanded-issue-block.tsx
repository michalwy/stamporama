/**
 * An expanded issue set apart as one block (#1729), on the Issues list and in *Browse stamps*,
 * which draw the same rows. Its header and everything under it — the checklist filter, the
 * branches, the stamp rows, the foot with **+ Add stamp** / **+ New stamp** — sit on one faint
 * tint with an accent bar down the left edge and a little space before and after, so where the
 * issue starts and ends reads at a glance in a long list. Checklist branches nest inside it with
 * no block of their own: only the issue is set apart. A collapsed issue draws as it always did.
 */

/** The row's outer wrapper: a separator rule while collapsed, the block while open. */
export function issueBlockStyle(expanded: boolean, isLast: boolean): React.CSSProperties {
  if (!expanded) return { borderBottom: isLast ? undefined : "1px solid var(--color-border)" };
  return {
    position: "relative",
    margin: "0.5rem 0",
    background: "var(--color-bg-issue-open)",
    borderTop: "1px solid var(--color-border)",
    borderBottom: "1px solid var(--color-border)",
  };
}

/** The header's surface: tinted for as long as the issue is open, so an open issue is found even
 *  when only its header is on screen. */
export function issueHeaderBackground(expanded: boolean, hovered: boolean): string {
  if (hovered) return "var(--color-bg-row-hover)";
  return expanded ? "var(--color-bg-issue-open)" : "var(--color-bg-elevated)";
}

/** The accent bar down the block's left edge, header to last row. An element of its own rather
 *  than a border, which would shift the open issue's content sideways, or an inset shadow, which
 *  the header's own opaque surface paints over. */
export function IssueBlockBar() {
  return <div aria-hidden style={BAR_STYLE} />;
}

const BAR_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
  width: "3px",
  background: "var(--color-issue-open-bar)",
  pointerEvents: "none",
  zIndex: 1,
};
