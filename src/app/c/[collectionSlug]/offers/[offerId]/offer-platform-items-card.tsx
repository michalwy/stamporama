"use client";

import type { OfferPlatformItem } from "@/lib/offers";
import { usePersistentToggle } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

// The offer's stamps as the **platform's own catalogue** knows them (#423), each with the two pages
// a seller actually opens while pricing a listing: what the stamp *is* (its catalog page, #290) and
// what it is currently being *asked for* (the marketplace search at that grade).
//
// It exists because reaching either meant expanding every set and clicking through copy after copy —
// a komplet is dozens of copies over a handful of stamps, and the pages are keyed on
// `stamp × condition`, not on the copy. So the list is keyed that way too, and says how many of the
// offer's copies each row stands for rather than repeating the row.
//
// Deliberately **not** the sets card in miniature. It carries no price, no value, no per-copy
// anything: everything about *this* listing is a scroll away, and the one thing this card is for is
// leaving the screen for the platform. The links **lead** each row rather than trailing it, and
// while the offer is still `preparing` the list is simply open, with no toggle at all: there the
// card is the work in hand, and a ragged right edge behind a Show button puts two steps between the
// collector and the one thing they came here to click. From `ready` on it collapses again, for the
// reason the photos card does (#382) — a step taken once, with the header's count already saying how
// many stamps a buyer would be comparing.
//
// A row with no links is **still listed**. An unmatched stamp (#247) or an unmapped condition (#404)
// is a gap the collector can go and fix, and the place they are most likely to notice it is the list
// that would otherwise have taken them to the market.

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem 1.5rem 1.25rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.625rem",
};

const LINK: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px dashed var(--color-border-strong)",
  background: "var(--color-bg-page)",
  color: "var(--color-text-secondary)",
  textDecoration: "none",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const MUTED: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

/** The same "opens in a new tab" glyph the Colnect chip uses, in `currentColor`. */
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

export function OfferPlatformItemsCard({
  items,
  platformName,
  offerState,
}: {
  items: OfferPlatformItem[];
  /** Named in the heading, so the card says whose catalogue these links go to. */
  platformName: string;
  /** Where the offer is in its lifecycle: the card is the working surface only while `preparing`. */
  offerState: string;
}) {
  const preparing = offerState === "preparing";
  const [shown, setShown] = usePersistentToggle("stamporama.offerPlatformItems.expanded", false);
  const expanded = preparing || shown;
  // The platform has no module, or the offer has no copies yet: there is nothing to look up.
  if (items.length === 0) return null;

  const linkable = items.filter((i) => i.catalogUrl).length;

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <h3
          style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}
        >
          On {platformName} ({items.length})
        </h3>
        {linkable < items.length && (
          <Tooltip content="These stamps carry no item-ID for this platform, so there is nothing to link to. Match them from the stamp's own screen.">
            <span style={MUTED}>{items.length - linkable} not matched</span>
          </Tooltip>
        )}
        {!preparing && (
          <button
            type="button"
            onClick={() => setShown(!shown)}
            style={{
              marginLeft: "auto",
              padding: "0.375rem 0.875rem",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.375rem",
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              background: "var(--color-bg-elevated)",
              cursor: "pointer",
            }}
          >
            {shown ? "Hide" : "Show"}
          </button>
        )}
      </div>

      {expanded && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
          {items.map((item) => (
            <li
              key={`${item.stampId}|${item.conditionId}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                flexWrap: "wrap",
                padding: "0.4rem 0",
                borderTop: "1px solid var(--color-border)",
              }}
            >
              {/* The links lead the row: they are what the card exists for, and left-aligned they
                  stack into one column instead of a ragged edge chasing the longest stamp name. */}
              <span style={{ display: "flex", gap: "0.375rem", flexShrink: 0 }}>
                {item.catalogUrl ? (
                  <a href={item.catalogUrl} target="_blank" rel="noopener noreferrer" style={LINK}>
                    Catalog
                    <ExternalLinkIcon />
                  </a>
                ) : (
                  <Tooltip content="This stamp has no item-ID recorded for this platform yet.">
                    <span style={{ ...LINK, opacity: 0.5 }}>Catalog</span>
                  </Tooltip>
                )}
                {item.marketUrl ? (
                  <Tooltip
                    content={`What ${item.conditionName} copies are being asked for right now, cheapest first.`}
                  >
                    <a href={item.marketUrl} target="_blank" rel="noopener noreferrer" style={LINK}>
                      Market
                      <ExternalLinkIcon />
                    </a>
                  </Tooltip>
                ) : (
                  <Tooltip
                    content={
                      item.catalogUrl
                        ? "This condition is not mapped to the platform's own grades, so a market search would ask a different question. Map it in Settings → Colnect."
                        : "This stamp has no item-ID recorded for this platform yet."
                    }
                  >
                    <span style={{ ...LINK, opacity: 0.5 }}>Market</span>
                  </Tooltip>
                )}
              </span>
              {/* Every number the stamp carries, each naming its catalogue (#423): this row is read
                  against the *platform's* catalogue, so which vendor a number belongs to is the
                  thing being checked, and a stamp recorded in two is looked up in both. The bare
                  label is left only for a stamp carrying no number at all. */}
              <span
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  whiteSpace: "nowrap",
                }}
              >
                {item.catalogNumbers.length > 0 ? item.catalogNumbers.join(" · ") : item.label}
              </span>
              {item.stampName && (
                <span
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--color-text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.stampName}
                </span>
              )}
              <span style={MUTED}>{item.conditionName}</span>
              {item.copyCount > 1 && (
                <Tooltip content={`${item.copyCount} copies of this stamp in this condition are in the offer.`}>
                  <span style={MUTED}>×{item.copyCount}</span>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
