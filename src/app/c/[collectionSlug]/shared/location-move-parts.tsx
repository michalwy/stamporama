import Link from "next/link";
import type { LocationMoveEntry, LocationMoveNamed, LocationMovePlace } from "@/lib/location-moves";
import { locationMoveSourceLabel } from "@/lib/location-move-rules";

// The pieces a location history entry is drawn from (#2277), shared by the copy's card and the
// location's screen so an entry reads the same in both.

const MUTED: React.CSSProperties = { color: "var(--color-text-muted)" };
const LINK: React.CSSProperties = { color: "var(--color-accent)", textDecoration: "none" };
const REF: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
};

/** One end of a move: the location's path as a link to its history, then the ref. *Not filed* for
 *  no location; a deleted location by the name it had. */
export function LocationMovePlaceText({
  collectionSlug,
  place,
}: {
  collectionSlug: string;
  place: LocationMovePlace;
}) {
  if (!place.locationId && !place.label) return <span style={MUTED}>Not filed</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.375rem", flexWrap: "wrap" }}>
      {place.locationId ? (
        <Link href={`/c/${collectionSlug}/locations/${place.locationId}`} style={LINK}>
          {place.label}
        </Link>
      ) : (
        <span>
          {place.label} <span style={MUTED}>(deleted)</span>
        </span>
      )}
      {place.ref && <span style={REF}>{place.ref}</span>}
    </span>
  );
}

const NAMED_PATH: Record<LocationMoveNamed["kind"], string> = {
  purchase: "purchases",
  sale: "sales",
  trade: "trades",
};

/** What moved the copy, with the purchase, sale or trade named as a link where the entry names one. */
export function LocationMoveSourceText({
  collectionSlug,
  entry,
}: {
  collectionSlug: string;
  entry: Pick<LocationMoveEntry, "source" | "named">;
}) {
  const label = locationMoveSourceLabel(entry.source);
  if (!entry.named) return <span>{label}</span>;
  return (
    <span>
      {label}{" "}
      <Link href={`/c/${collectionSlug}/${NAMED_PATH[entry.named.kind]}/${entry.named.id}`} style={LINK}>
        {entry.named.label}
      </Link>
    </span>
  );
}

/** When an entry was written, to the minute. */
export function formatMovedAt(movedAt: string): string {
  return new Date(movedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
