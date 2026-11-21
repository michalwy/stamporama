"use client";

import { moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
import type { IssuePriceTotal } from "@/lib/catalog-price";
import {
  PRICE_MAIN,
  PRICE_CONVERTED,
  PRICE_STALE_ICON,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";

/**
 * A catalogue total at the right end of an Issues-list line, with the caveats it carries: the `~`
 * when a figure is estimated (#238, #343), the warning when the total is partial or uses
 * older-edition prices. The issue row draws its one value with it (#2659), a checklist branch its
 * checklist's (#2660) — one chip, so the two read the same.
 */
export function CatalogValueChip({
  total: t,
  summary,
  style,
}: {
  total: IssuePriceTotal;
  /** What the figure totals, shown on hover when no caveat's tooltip takes its place. */
  summary: string;
  style?: React.CSSProperties;
}) {
  const incomplete = t.pricedCount < t.requiredCount;
  const unpriced = t.requiredCount - t.pricedCount - t.olderEditionExcludedCount;
  const showWarning = t.usesOlderEdition || incomplete;
  // Both ways a total stops being a plain sum of recorded figures (#238, #343). One marker, one
  // tooltip listing whichever applies.
  const estimated = t.estimatedCount > 0 || t.derivedCount > 0;
  const secondary = moneySecondaryText(t);
  const warningLabel = t.usesOlderEdition ? "Older-edition prices" : "Partial total";
  return (
    <Tooltip content={showWarning ? undefined : summary} align="end" style={style}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          whiteSpace: "nowrap",
        }}
      >
        {estimated && (
          <Tooltip
            align="end"
            content={
              <>
                <div style={{ fontWeight: 600, marginBottom: "0.15rem" }}>Includes an estimate</div>
                {t.estimatedCount > 0 && (
                  <div style={{ color: "var(--color-text-secondary)" }}>
                    {t.estimatedCount} required stamp{t.estimatedCount !== 1 ? "s" : ""} priced
                    from the lowest variant (no own price).
                  </div>
                )}
                {t.derivedCount > 0 && (
                  <div style={{ color: "var(--color-text-secondary)" }}>
                    {t.derivedCount} required stamp{t.derivedCount !== 1 ? "s" : ""} priced from
                    the single by this format&apos;s multiplier.
                  </div>
                )}
              </>
            }
          >
            <span
              aria-label="Includes an estimate"
              style={{ ...PRICE_MAIN, color: "var(--color-text-muted)", cursor: "help" }}
            >
              ~
            </span>
          </Tooltip>
        )}
        {showWarning && (
          <Tooltip
            align="end"
            content={
              <>
                <div style={{ fontWeight: 600, marginBottom: "0.15rem" }}>{warningLabel}</div>
                {t.usesOlderEdition ? (
                  <div style={{ color: "var(--color-text-secondary)" }}>
                    No required stamp is priced on the current edition — the total uses
                    older-edition prices.
                  </div>
                ) : (
                  <div style={{ color: "var(--color-text-secondary)" }}>
                    {t.pricedCount} of {t.requiredCount} required stamps priced on the current
                    edition
                  </div>
                )}
                {!t.usesOlderEdition && t.olderEditionExcludedCount > 0 && (
                  <div style={{ color: "var(--color-text-muted)" }}>
                    {t.olderEditionExcludedCount} priced only on an older edition (not counted)
                  </div>
                )}
                {unpriced > 0 && (
                  <div style={{ color: "var(--color-text-muted)" }}>
                    {unpriced} without any catalog price
                  </div>
                )}
              </>
            }
          >
            <span aria-label={warningLabel} style={PRICE_STALE_ICON}>
              <Icon name="warning" size="sm" />
            </span>
          </Tooltip>
        )}
        {secondary && <span style={PRICE_CONVERTED}>{secondary}</span>}
        <span style={PRICE_MAIN}>{moneyPrimaryText(t)}</span>
      </span>
    </Tooltip>
  );
}
