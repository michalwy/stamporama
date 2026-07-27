"use client";

import { colnectStampUrl } from "@/lib/colnect-link";
import { Tooltip } from "./tooltip";

// The Colnect tag shown next to a stamp's catalog numbers when the stamp has a Colnect
// Marketplace item-ID (#247): a link to that stamp's Colnect page, opened in a new tab
// (#290). The tag reads just "Colnect" — the item-ID itself is an external reference nobody
// reads off the row, so it stays in the tooltip and the catalog numbers keep the space. The
// external-link icon sits inside the border, after the label. Dashed, like the other Colnect
// affordances, because an item-ID is an external reference and not one of our catalog numbers.

const CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontFamily: "monospace",
  color: "var(--color-text-muted)",
  border: "1px dashed var(--color-border-strong)",
  borderRadius: "0.25rem",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
  textDecoration: "none",
  flexShrink: 0,
};

/** Standard "opens in a new tab" glyph, in `currentColor` so it tracks the chip's text. */
function ExternalLinkIcon() {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path d="M5 2H2.5v7.5H10V7" />
      <path d="M7 2h3v3" />
      <path d="M10 2 5.75 6.25" />
    </svg>
  );
}

export function ColnectChip({
  colnectId,
  /** Slightly larger variant used on the flat stamp list, which sizes its chips up. */
  size = "small",
}: {
  colnectId: string | null | undefined;
  size?: "small" | "medium";
}) {
  const url = colnectStampUrl(colnectId);
  if (!url) return null;
  const medium = size === "medium";
  const label = `Open Colnect item-ID ${colnectId?.trim()} on colnect.com`;
  return (
    <Tooltip content={label}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        style={{
          ...CHIP,
          fontSize: medium ? "0.75rem" : "0.6875rem",
          padding: medium ? "0.1rem 0.4rem" : "0.05rem 0.35rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        Colnect
        <ExternalLinkIcon />
      </a>
    </Tooltip>
  );
}
