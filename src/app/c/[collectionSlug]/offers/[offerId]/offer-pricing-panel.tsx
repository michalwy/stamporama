"use client";

import type { ReactNode } from "react";
import { pickPricingTab } from "@/lib/offer-pricing-tab";
import { usePersistedCollectionValue } from "../../shared/use-persisted-collection-value";

// The **Pricing** panel (#2522) — directly under the offer's compact header, because setting the price
// is what the offer's screen is for. Two columns: the price table on the left, and on the right tabs
// of what the price is weighed against — the Colnect market first (#2454), then Earlier offers (#2521).
//
// A tab is drawn only where its card would render (`content` non-null). One that is drawn but has
// nothing to show yet (`empty` — a Colnect market never read) is never picked on its own while
// another tab has content; it stays in the tab row, since its own button is what fills it. With no
// tab at all the price table takes the panel's whole width. The selected tab is remembered per
// browser, not per offer. On a narrow window the columns wrap, the price table first. The panel is
// never folded.

export interface PricingTab {
  key: string;
  label: string;
  /** The tab's card, or null when it does not apply to this offer (the tab is then not drawn). */
  content: ReactNode | null;
  /** Drawn, but with nothing to show yet — another tab with content is preferred when none is chosen. */
  empty?: boolean;
}

const PANEL: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem 1.25rem",
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-start",
  columnGap: "2rem",
  rowGap: "1.25rem",
};

export function OfferPricingPanel({
  collectionId,
  priceTable,
  tabs,
}: {
  collectionId: string;
  /** The left column: the price table, the scale, and the hints that go with the price. */
  priceTable: ReactNode;
  tabs: readonly PricingTab[];
}) {
  const [stored, setStored] = usePersistedCollectionValue("offer-pricing-tab", collectionId);
  const present = tabs.filter((tab) => tab.content !== null);
  const selected = pickPricingTab(
    present.map((tab) => ({ ...tab, present: true, empty: tab.empty ?? false })),
    stored
  );

  return (
    <section aria-label="Pricing" style={PANEL}>
      <div style={{ flex: "0 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Pricing
        </h3>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.15rem" }}>
          {priceTable}
        </div>
      </div>

      {selected && (
        <div
          style={{
            flex: "1 1 40rem",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            borderLeft: "1px solid var(--color-border)",
            paddingLeft: "1.5rem",
          }}
        >
          <div
            role="tablist"
            aria-label="Pricing references"
            style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", borderBottom: "1px solid var(--color-border)", paddingBottom: "0.5rem" }}
          >
            {present.map((tab) => {
              const isActive = tab.key === selected.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setStored(tab.key)}
                  style={{
                    padding: "0.25rem 0.625rem",
                    fontSize: "0.875rem",
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "var(--color-text-primary)" : "var(--color-text-muted)",
                    background: isActive ? "var(--color-bg-page)" : "transparent",
                    border: `1px solid ${isActive ? "var(--color-border-strong)" : "transparent"}`,
                    borderRadius: "0.375rem",
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div role="tabpanel" aria-label={selected.label}>
            {selected.content}
          </div>
        </div>
      )}
    </section>
  );
}
