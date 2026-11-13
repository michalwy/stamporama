import type { CSSProperties } from "react";

/**
 * An icon button on the folded sidebar's rail (#2505): the jump box's search icon and every other
 * one the rail draws in `collection-sidebar.tsx`, so the column is one size and one hover throughout.
 */
export function railIconButtonStyle(pressed: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "2.25rem",
    height: "2.25rem",
    padding: 0,
    border: "none",
    borderRadius: "0.375rem",
    background: pressed ? "var(--color-bg-muted)" : "transparent",
    color: "var(--color-text-muted)",
    cursor: "pointer",
    flexShrink: 0,
  };
}
