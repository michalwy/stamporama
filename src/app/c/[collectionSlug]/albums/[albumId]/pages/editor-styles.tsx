// The page editor's small shared shapes (#769), in a module of their own so the free page's panels
// (#1429) draw with the same ones rather than a second copy of each.

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

export function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "0.6875rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        color: "var(--color-text-muted)",
        marginBottom: "0.5rem",
      }}
    >
      {children}
    </div>
  );
}
