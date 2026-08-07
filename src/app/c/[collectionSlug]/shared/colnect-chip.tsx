"use client";

import { colnectSearchUrl, colnectStampUrl } from "@/lib/colnect-link";
import { catalogChipCopyValue } from "@/lib/catalog-number";
import type { AreaCatalogEntry } from "@/lib/areas";
import { Icon } from "@/app/icons";
import { Tooltip } from "./tooltip";

// The Colnect tag shown next to a stamp's catalog numbers when the stamp has a Colnect
// Marketplace item-ID (#247): a link to that stamp's Colnect page, opened in a new tab
// (#290). The tag reads just "Colnect" — the item-ID itself is an external reference nobody
// reads off the row, so it stays in the tooltip and the catalog numbers keep the space. The
// external-link icon sits inside the border, after the label. Dashed, like the other Colnect
// affordances, because an item-ID is an external reference and not one of our catalog numbers.
//
// With no item-ID recorded there is no page to open, and the chip becomes a **search** for the
// stamp's catalog number instead (#441) — the same catalog/search pairing the offer's platform
// card already draws (#423), and the first step of recording the ID that turns it back into a
// catalog link. The two never appear together, so the label stays "Colnect" in both states and
// the glyph carries the difference: an arrow leaves for a known page, a lens goes looking.

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

/**
 * The query a search chip runs for a stamp: the **area prefix and the number**, the vendor
 * abbreviation dropped — the same string the catalog chip beside it copies (#420), because
 * Colnect indexes numbers under country codes and knows nothing of our abbreviations. Pass the
 * primary catalog number, falling back to any other one the row shows; null when the row has no
 * number at all, which is a stamp Colnect cannot be searched for.
 */
export function colnectSearchQueryFor(
  catalogNumber: { number: string; catalogVendorId: string } | null | undefined,
  vendorMap: ReadonlyMap<string, AreaCatalogEntry>
): string | null {
  if (!catalogNumber) return null;
  const query = catalogChipCopyValue(
    vendorMap.get(catalogNumber.catalogVendorId)?.prefix,
    catalogNumber.number
  );
  return query || null;
}

export function ColnectChip({
  colnectId,
  /** The catalog number to search Colnect for when no item-ID is recorded (#441), from
   * {@link colnectSearchQueryFor}. Omitted on the surfaces that only ever show the catalog link. */
  searchQuery,
  /** Slightly larger variant used on the flat stamp list, which sizes its chips up. */
  size = "small",
}: {
  colnectId: string | null | undefined;
  searchQuery?: string | null;
  size?: "small" | "medium";
}) {
  const url = colnectStampUrl(colnectId);
  const searchUrl = url ? null : colnectSearchUrl(searchQuery);
  const href = url ?? searchUrl;
  if (!href) return null;
  const medium = size === "medium";
  const label = url
    ? `Open Colnect item-ID ${colnectId?.trim()} on colnect.com`
    : `No Colnect item-ID recorded — search colnect.com for ${searchQuery?.trim()}`;
  return (
    <Tooltip content={label}>
      <a
        href={href}
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
        {/* An arrow leaves for a known page, a lens goes looking (#441). */}
        {url ? <Icon name="externalLink" size="xs" /> : <Icon name="search" size="xs" />}
      </a>
    </Tooltip>
  );
}
