"use client";

import { type OfferState, OFFER_STATE_LABEL } from "@/lib/offer-rules";

// Shared chip presentation for an offer's lifecycle state (ADR-0012, #165), reused by the list
// rows, the lot detail panel's Offers section, and the dialog header so an offer reads
// identically everywhere.

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

function tinted(token: string, label: string, title?: string) {
  return (
    <span
      style={{
        ...CHIP,
        color: `var(--color-${token})`,
        borderColor: `var(--color-${token}-border, var(--color-border))`,
        background: `var(--color-${token}-soft, var(--color-bg-page))`,
      }}
      title={title}
    >
      {label}
    </span>
  );
}

const STATE: Record<OfferState, { token: string | null; title: string }> = {
  active: { token: "accent", title: "Live on the platform" },
  paused: { token: "warning", title: "Temporarily suspended on the platform" },
  sold: { token: "success", title: "Sold through this offer" },
  withdrawn: { token: null, title: "Taken down; not for sale here" },
};

export function OfferStateChip({ state }: { state: OfferState }) {
  const meta = STATE[state];
  const label = OFFER_STATE_LABEL[state];
  if (!meta.token) return <span style={CHIP} title={meta.title}>{label}</span>;
  return tinted(meta.token, label, meta.title);
}
