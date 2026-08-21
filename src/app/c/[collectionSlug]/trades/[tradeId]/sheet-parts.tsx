import { GeneratedAt } from "@/app/c/[collectionSlug]/shared/generated-at";

// The furniture the trade's two printouts share (#643): the header's meta row, and the line pinned to
// the foot of every printed page. Both sheets are documents about the same parcel, so a reader holding
// one page of either has to be able to tell what it is — and two copies of that line would drift.
//
// Server-side by design: nothing here is interactive, and `GeneratedAt` is the one client component in
// it, rendered rather than imported for its value.

/** The header's row of `Label: value` pairs. */
export const SHEET_META_ROW: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.375rem 1.5rem",
  margin: "0.625rem 0 0",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
};

export function SheetMeta({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ fontWeight: 600, color: "var(--color-text-muted)" }}>{label}: </span>
      <span style={{ color: "var(--color-text-primary)" }}>{value}</span>
    </span>
  );
}

/**
 * Pinned to the foot of every printed page (`.print-footer`).
 *
 * It carries enough to identify the trade on its own — a page that gets separated from the stack has
 * to be matchable back to the parcel without the header — plus the provenance of the printout itself,
 * so two printings of the same trade can be told apart and a sheet found weeks later says where it
 * came from.
 */
export function SheetFooter({
  lead,
  detail,
  collectionName,
  version,
}: {
  /** What the sheet is about, in bold: the trade's number and the partner. */
  lead: string;
  /** The rest of the identifying line — status, counts, whatever the sheet is a list of. */
  detail: string;
  collectionName: string;
  version: string;
}) {
  return (
    <div
      className="print-footer"
      style={{
        marginTop: "0.5rem",
        fontSize: "0.6875rem",
        color: "var(--color-text-muted)",
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "0.75rem",
        flexWrap: "wrap",
      }}
    >
      <span>
        <strong style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>{lead}</strong>
        {detail ? ` · ${detail}` : ""}
      </span>
      <span>
        Stamporama {version} · {collectionName} · generated{" "}
        <GeneratedAt iso={new Date().toISOString()} />
      </span>
    </div>
  );
}

/** A trade's timestamps are real instants, so they are printed as the day they fall on in UTC — the
 *  same reading the trade screen gives them. The generated *time* is the collector's own zone
 *  instead; that one is `GeneratedAt` (#503). */
export function formatSheetDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
