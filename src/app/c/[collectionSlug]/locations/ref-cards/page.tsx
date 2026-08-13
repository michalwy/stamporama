import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getLocations, getLocationRefUsage } from "@/lib/locations";
import { buildLocationPath } from "@/lib/location-path";
import { locationRefStrip } from "@/lib/location-ref";
import { getAppVersionLabel } from "@/lib/version";
import { PrintButton } from "@/app/c/[collectionSlug]/shared/print-button";
import { GeneratedAt } from "@/app/c/[collectionSlug]/shared/generated-at";
import { RefCardsControls, MAX_CARDS } from "./ref-cards-controls";

export const metadata: Metadata = { title: "Blank ref cards" };

interface RefCardsPageProps {
  params: Promise<{ collectionSlug: string }>;
  searchParams: Promise<{ locationId?: string; start?: string; count?: string }>;
}

const DEFAULT_COUNT = 20;

function parseCount(raw: string | undefined): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_COUNT;
  return Math.min(MAX_CARDS, Math.max(1, n));
}

/**
 * A printable strip of **blank ref cards** (#565) — the index cards a collector calls *fiszki*,
 * carrying a running ref and nothing else, cut apart and slipped onto transport cards before any
 * stamp is packed.
 *
 * The physical act leads here, which is the whole point: the cards exist on paper first, the stamps
 * are packed onto them, and only then is the filing recorded. So this sheet allocates nothing — it
 * prints a run of numbers, and a ref becomes real when copies are filed under it. The run starts
 * where the location's own counter is up to ({@link getLocationRefUsage}), never a per-lot one: the
 * box is shared across purchases.
 *
 * Built on the packing list's pattern (#330): a plain server render, `.no-print` chrome, a
 * `.print-footer` naming the sheet's provenance. What the collector can change lives in the URL, so
 * a strip is reprintable exactly as it came out.
 */
export default async function RefCardsPage({ params, searchParams }: RefCardsPageProps) {
  const { collectionSlug } = await params;
  const sp = await searchParams;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const locations = await getLocations(session.user.id, collection.id);
  const location = sp.locationId ? locations.find((l) => l.id === sp.locationId) : undefined;
  const locationId = location?.assignable ? location.id : "";
  const locationPath = locationId ? buildLocationPath(locations, locationId) : null;

  // The suggestion is only ever a *default*: an explicit `start` is the collector telling us where
  // their strip actually is, which the box has no way of knowing until copies are filed under it.
  const usage = locationId
    ? await getLocationRefUsage(session.user.id, collection.id, locationId)
    : null;
  const start = (sp.start ?? usage?.suggestion ?? "").trim();
  const count = parseCount(sp.count);
  const strip = locationRefStrip(start, count);

  return (
    <div className="print-sheet" style={{ padding: "2rem", maxWidth: "56rem" }}>
      <div
        className="no-print"
        style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}
      >
        <Link
          href={`/c/${collectionSlug}/locations`}
          style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", textDecoration: "none" }}
        >
          ← Back to locations
        </Link>
        <span style={{ marginLeft: "auto" }} />
        <PrintButton />
      </div>

      <div className="no-print" style={{ marginBottom: "1.25rem" }}>
        <RefCardsControls
          collectionSlug={collectionSlug}
          locations={locations}
          locationId={locationId}
          start={start}
          count={count}
        />
      </div>

      <header style={{ borderBottom: "2px solid var(--color-border-strong)", paddingBottom: "0.75rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
          Blank ref cards
        </h1>
        <p style={{ margin: "0.375rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          {locationPath ?? "No location chosen"}
          {strip.length > 0 && (
            <>
              {" · "}
              {strip[0]}–{strip[strip.length - 1]} · {strip.length}{" "}
              {strip.length === 1 ? "card" : "cards"}
            </>
          )}
        </p>
      </header>

      {strip.length === 0 ? (
        <p className="no-print" style={{ marginTop: "1.5rem", fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          {!locationId
            ? "Choose a location to print a strip for."
            : usage?.suggestion == null && !sp.start
              ? "Nothing has been ref’d in this location yet, so there is no counter to continue. Type the ref your strip starts at — something ending in a number, like A1."
              : "A strip counts up from a ref ending in a number, like A147. Adjust “Start at” above."}
        </p>
      ) : (
        <div
          style={{
            marginTop: "1.25rem",
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "0.25rem",
          }}
        >
          {strip.map((ref) => (
            <div
              key={ref}
              style={{
                // Dashed, because the border is a cut guide rather than part of the card.
                border: "1px dashed var(--color-border-strong)",
                borderRadius: "0.125rem",
                height: "2.4cm",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                // Cards never straddle a page break — half a card is waste paper.
                breakInside: "avoid",
              }}
            >
              <span
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--color-text-primary)",
                }}
              >
                {ref}
              </span>
            </div>
          ))}
        </div>
      )}

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
          <strong style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>
            {locationPath ?? "—"}
          </strong>
          {strip.length > 0 ? ` · ${strip[0]}–${strip[strip.length - 1]}` : ""}
        </span>
        <span>
          Stamporama {getAppVersionLabel()} · {collection.name} · generated{" "}
          <GeneratedAt iso={new Date().toISOString()} />
        </span>
      </div>
    </div>
  );
}
