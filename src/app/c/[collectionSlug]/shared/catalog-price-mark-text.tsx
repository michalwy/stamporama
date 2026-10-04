"use client";

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  CATALOG_PRICE_MARK_LABEL,
  catalogPriceMarkHint,
  catalogPriceMarkPhrase,
  type CatalogPriceMark,
} from "@/lib/catalog-price-mark";

/**
 * Where a value would be, the catalogue's word that there is none (#1615): *does not exist* or *not
 * determinable*, muted, with what the catalogue prints in the hover. Never `—` alone — an empty value
 * is drawn that way across the app, and this is the opposite of empty.
 *
 * `full` spells the whole phrase (*catalogue price not determinable*) for a labelled field or a
 * dialog; a list row keeps to the short word, its column already being the catalogue value.
 */
export function CatalogPriceMarkText({
  mark,
  full = false,
  rolledUp = false,
  align,
}: {
  mark: CatalogPriceMark;
  full?: boolean;
  /** Taken from every variant of an umbrella rather than recorded on the stamp — `≈`, as #238. */
  rolledUp?: boolean;
  align?: "center" | "start" | "end";
}) {
  const text = full ? catalogPriceMarkPhrase(mark) : CATALOG_PRICE_MARK_LABEL[mark];
  return (
    <Tooltip
      align={align}
      content={
        rolledUp
          ? `${catalogPriceMarkHint(mark)} Every variant of this stamp is marked so.`
          : catalogPriceMarkHint(mark)
      }
    >
      <span
        style={{
          color: "var(--color-text-muted)",
          fontStyle: "italic",
          fontSize: "0.8125rem",
          whiteSpace: "nowrap",
          cursor: "help",
        }}
      >
        {rolledUp ? `≈ ${text}` : text}
      </span>
    </Tooltip>
  );
}
