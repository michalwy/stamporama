"use client";

import type { ItemVariantHistoryData } from "@/lib/items";

const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/** `changedAt` crosses the API as an ISO string; show the date part only. */
function changedDate(value: ItemVariantHistoryData["changedAt"]): string {
  return String(value).slice(0, 10);
}

/** Read-only refinement trail for a copy (#100): each entry is a re-point from one stamp
 * to a more specific variant, oldest first. Shared by the identify dialog and the
 * standalone history view. */
export function VariantHistoryList({
  entries,
  isLoading,
}: {
  entries: ItemVariantHistoryData[] | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <p style={MUTED}>Loading history…</p>;
  }
  if (!entries || entries.length === 0) {
    return <p style={MUTED}>No refinement history yet.</p>;
  }

  return (
    <ol style={{ display: "flex", flexDirection: "column", gap: "0.625rem", margin: 0, padding: 0, listStyle: "none" }}>
      {entries.map((entry) => (
        <li
          key={entry.id}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            paddingLeft: "0.75rem",
            borderLeft: "2px solid var(--color-border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.375rem", flexWrap: "wrap", fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
            <span>{entry.fromStampLabel}</span>
            <span aria-hidden="true" style={{ color: "var(--color-text-muted)" }}>→</span>
            <span style={{ fontWeight: 600 }}>{entry.toStampLabel}</span>
          </div>
          <div style={MUTED}>
            {changedDate(entry.changedAt)}
            {entry.note ? ` · ${entry.note}` : ""}
          </div>
        </li>
      ))}
    </ol>
  );
}
