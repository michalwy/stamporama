import type { OfferSpecification } from "@/lib/offer-specification";
import { formatEntityNo } from "@/lib/quick-jump";
import { SpecificationSheet } from "./specification-sheet";

// The specification itself (#1758) — the header naming the offer and the table of its copies — as
// both of its pages draw it: the collector's printable sheet and the buyer's shared link (#1760).
// One component, so the two cannot come to show different rows, fields or headings; what differs
// is only where a thumbnail is fetched from, which each page resolves for itself.

export function SpecificationDocument({
  spec,
  thumbSrc,
}: {
  spec: Pick<OfferSpecification, "offerNo" | "title" | "rows">;
  thumbSrc: Readonly<Record<string, string>>;
}) {
  const count = spec.rows.length;
  return (
    <>
      <header style={{ borderBottom: "2px solid var(--color-border-strong)", paddingBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
            {formatEntityNo(spec.offerNo)} · {spec.title}
          </h1>
        </div>
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          Specification — {count} {count === 1 ? "copy" : "copies"}
        </p>
      </header>

      <SpecificationSheet rows={spec.rows} thumbSrc={thumbSrc} />
    </>
  );
}

/** Each row's thumbnail address, built by `src` from its photo id. */
export function specificationThumbs(
  spec: Pick<OfferSpecification, "rows">,
  src: (photoId: string) => string
): Record<string, string> {
  return Object.fromEntries(
    spec.rows.flatMap((row) => (row.photoId ? [[row.photoId, src(row.photoId)]] : []))
  );
}
