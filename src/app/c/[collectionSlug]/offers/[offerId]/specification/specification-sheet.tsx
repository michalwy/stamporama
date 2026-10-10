"use client";

import type { OfferSpecificationRow } from "@/lib/offer-specification-rules";
import { THUMB_OBJECT_FIT } from "@/app/photo-viewer";

// The specification's table (#1758): one row per copy, for a buyer.
//
// A client module only because the thumbnail's fit comes from one (`THUMB_OBJECT_FIT` lives beside
// the photo viewer), and a server component must not import a value from a `"use client"` module.
// Nothing here is interactive: no column picker, no ticks, no menu — a buyer's sheet prints the
// same every time, and every field on it is one the buyer was promised.

const TH: React.CSSProperties = {
  textAlign: "left",
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
  borderBottom: "1px solid var(--color-border-strong)",
  padding: "0.25rem 0.5rem",
  whiteSpace: "nowrap",
};

const TD: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  borderBottom: "1px solid var(--color-border)",
  padding: "0.375rem 0.5rem",
  verticalAlign: "middle",
};

const MUTED_DASH = <span style={{ color: "var(--color-text-muted)" }}>—</span>;

export function SpecificationSheet({
  collectionId,
  rows,
}: {
  collectionId: string;
  rows: readonly OfferSpecificationRow[];
}) {
  if (rows.length === 0) {
    return (
      <p style={{ marginTop: "1rem", fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
        This offer holds no copies, so there is nothing to specify.
      </p>
    );
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
      <thead>
        <tr>
          <th style={TH} aria-label="Photo" />
          <th style={TH}>Catalog</th>
          <th style={TH}>Area</th>
          <th style={TH}>Series</th>
          <th style={{ ...TH, textAlign: "right" }}>Year</th>
          <th style={TH}>Stamp</th>
          <th style={TH}>Condition</th>
          <th style={TH}>Certificate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.itemId}>
            <td style={{ ...TD, width: "4.5rem", textAlign: "center" }}>
              {row.photoId ? (
                // A plain <img>: the sheet is a printout, so there is no carousel to offer, and an
                // inline image prints where a background would not.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/collections/${collectionId}/photos/${row.photoId}/thumb`}
                  alt=""
                  style={{
                    width: "4rem",
                    height: "4rem",
                    objectFit: THUMB_OBJECT_FIT,
                    display: "block",
                    margin: "0 auto",
                  }}
                />
              ) : (
                MUTED_DASH
              )}
            </td>
            <td style={{ ...TD, fontWeight: 600, whiteSpace: "nowrap" }}>
              {row.catalog || MUTED_DASH}
            </td>
            <td style={TD}>{row.area ?? MUTED_DASH}</td>
            <td style={TD}>{row.issue ?? MUTED_DASH}</td>
            <td style={{ ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {row.year ?? MUTED_DASH}
            </td>
            <td style={TD}>{row.description ?? MUTED_DASH}</td>
            <td style={TD}>
              {row.condition ?? MUTED_DASH}
              {/* The faults belong to the condition — they are what qualifies it — so they read
                  under it rather than in a column of their own that is empty on most rows. */}
              {row.faults.length > 0 && (
                <span style={{ display: "block", fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
                  {row.faults.join(", ")}
                </span>
              )}
            </td>
            <td style={TD}>{row.certificate ?? MUTED_DASH}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
