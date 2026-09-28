// The page editor's small shared shapes (#769), in a module of their own so the free page's panels
// (#1429) draw with the same ones rather than a second copy of each.

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

export const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/** A recessed frame for figures over what is selected — `--color-bg-page` inside the card's own
 *  white, the shape every summary bar in this app already carries. */
export const FRAME: React.CSSProperties = {
  background: "var(--color-bg-page)",
  borderRadius: "0.5rem",
  padding: "0.625rem 0.75rem",
};

export const INPUT: React.CSSProperties = {
  width: "100%",
  padding: "0.3125rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

export const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

export const BTN: React.CSSProperties = {
  padding: "0.3125rem 0.625rem",
  background: "transparent",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  textDecoration: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** Millimetres to a tenth, the precision everything on this track cuts to. */
export function mm(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Which reach a panel section's setting has (#1459). The one fact the old paragraphs under each
 *  control mostly existed to state, so it is a tag on the heading rather than a sentence. */
export type PanelScope = "sheet" | "album";

const SCOPES: Record<PanelScope, { label: string; hint: string; style: React.CSSProperties }> = {
  sheet: {
    label: "This sheet",
    hint: "Only this sheet. Every other sheet keeps the album's own setting.",
    style: { borderColor: "var(--color-border-strong)", color: "var(--color-text-secondary)" },
  },
  album: {
    label: "Whole album",
    hint: "Every sheet of this album, and its PDF. This album alone — the template it was made from is not touched.",
    style: {
      borderColor: "var(--color-accent-border)",
      background: "var(--color-accent-soft)",
      color: "var(--color-accent)",
    },
  },
};

export function PanelHeading({
  children,
  scope,
}: {
  children: React.ReactNode;
  scope?: PanelScope;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.5rem",
        fontSize: "0.6875rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        color: "var(--color-text-muted)",
        marginBottom: "0.5rem",
      }}
    >
      <span>{children}</span>
      {scope && (
        <Tooltip content={SCOPES[scope].hint} align="end">
          <span
            style={{
              ...CHIP,
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "none",
              letterSpacing: "normal",
              cursor: "help",
              ...SCOPES[scope].style,
            }}
          >
            {SCOPES[scope].label}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

const HINT_LINE: React.CSSProperties = {
  ...MUTED,
  fontSize: "0.75rem",
  lineHeight: 1.45,
  margin: "0.375rem 0 0",
};

/**
 * The one short line a control may carry (#1459), and only where its name does not already say it.
 * With `more`, the line is dotted and the longer explanation is a hover away — the album screen's
 * shape (#1430) — the rest being the user guide's. A panel of paragraphs is a long read in which the
 * controls get lost, so nothing longer than this goes under a control.
 */
export function Hint({ children, more }: { children: React.ReactNode; more?: React.ReactNode }) {
  return (
    <p style={HINT_LINE}>
      {more ? (
        <Tooltip content={more} align="end">
          <span
            style={{
              textDecoration: "underline dotted",
              textUnderlineOffset: "0.2em",
              cursor: "help",
            }}
          >
            {children}
          </span>
        </Tooltip>
      ) : (
        children
      )}
    </p>
  );
}
