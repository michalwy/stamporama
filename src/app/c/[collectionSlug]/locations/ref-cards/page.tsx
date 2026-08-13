import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getLocations, getLocationRefUsage } from "@/lib/locations";
import { getRefCardTemplates } from "@/lib/ref-card-templates";
import { DEFAULT_REF_CARD_GEOMETRY, type RefCardGeometry } from "@/lib/ref-card-template-rules";
import { buildLocationPath } from "@/lib/location-path";
import { locationRefStrip, parseRefCardCount } from "@/lib/location-ref";
import { getAppVersionLabel } from "@/lib/version";
import { PrintButton } from "@/app/c/[collectionSlug]/shared/print-button";
import { GeneratedAt } from "@/app/c/[collectionSlug]/shared/generated-at";
import { RefCardsControls } from "./ref-cards-controls";

export const metadata: Metadata = { title: "Blank ref cards" };

interface RefCardsPageProps {
  params: Promise<{ collectionSlug: string }>;
  searchParams: Promise<{
    locationId?: string;
    start?: string;
    count?: string;
    templateId?: string;
  }>;
}

/** One line, shared by the cards' right/bottom edges and the container's top/left, so every rule on
 *  the sheet is the same weight whichever of the two drew it. */
const CUT_RULE = "1px dashed var(--color-border-strong)";

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
 *
 * The card's **format is a template** (#569), read live from the collection's dictionary at print
 * time and copied nowhere — a sheet is paper, so an edit has no past act to contradict. The layout
 * is derived from it and never configured: `repeat(auto-fill, <cardWidth>)` fits as many cards per
 * row as the paper allows, so nothing here knows the page size and A4 and Letter both work.
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
  const count = parseRefCardCount(sp.count);
  const strip = locationRefStrip(start, count);

  // The format is read *now*, not remembered from when the strip was described: the sheet keeps no
  // copy of it, so a template edited in Settings takes effect on the next print and on nothing else.
  // With no template at all the built-in card prints — a collector who has never opened Settings
  // still gets a usable sheet, and no row is written on their behalf to say so.
  const templates = await getRefCardTemplates(session.user.id, collection.id);
  const chosen =
    (sp.templateId ? templates.find((t) => t.id === sp.templateId) : undefined) ?? templates[0];
  const card: RefCardGeometry = chosen ?? DEFAULT_REF_CARD_GEOMETRY;

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
          collectionId={collection.id}
          locations={locations}
          locationId={locationId}
          start={start}
          count={count}
          templates={templates}
          templateId={chosen?.id ?? ""}
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
              {/* Which stationery this sheet is cut for — the one thing about a printed strip that
                  cannot be read off the paper once it is cut apart. */}
              {" · "}
              {chosen?.name ?? "Default card"} ({card.cardWidthMm} × {card.cardHeightMm} mm)
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
            // No column count anywhere: the browser fits as many cards per row as the paper takes
            // and flows the rest below, so this sheet needs to know neither the page size nor the
            // margins, and A4 and Letter both come out right.
            gridTemplateColumns: `repeat(auto-fill, ${card.cardWidthMm}mm)`,
            justifyContent: "start",
            // A strip can never need more columns than it has cards; without this the closing rules
            // below would run the width of the page for a strip of three.
            //
            // `content-box` against the app's global `border-box` (globals.css), and it is load
            // bearing: the closing rules below are 1px of border, so under `border-box` the cap
            // would leave a content box of `n × cardWidth − 1px` while every track is exactly
            // `cardWidth` — `auto-fill` then fits one column fewer and a run of four that has room
            // for four prints 3 + 1. The same 1px is what would cost a column on any printable
            // width that is an exact multiple of the card.
            boxSizing: "content-box",
            maxWidth: `${card.cardWidthMm * strip.length}mm`,
            // Zero gap is not `gap: 0` alone. Each card draws its **right and bottom** only and the
            // container closes the **top and left**, so every interior line is exactly one line —
            // two neighbours keeping their own borders would print a double rule, and a cut down
            // the middle of it leaves ink on both halves. One cut separates two cards.
            borderTop: CUT_RULE,
            borderLeft: CUT_RULE,
          }}
        >
          {strip.map((ref) => (
            <div
              key={ref}
              style={{
                // Dashed, because the rule is a cut guide rather than part of the card.
                borderRight: CUT_RULE,
                borderBottom: CUT_RULE,
                boxSizing: "border-box",
                height: `${card.cardHeightMm}mm`,
                // The ref is pinned to the top, not centred: the rest of the card disappears into
                // the transport card's pocket once the stamps are packed onto it.
                paddingTop: `${card.paddingTopMm}mm`,
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "center",
                // Cards never straddle a page break — half a card is waste paper.
                breakInside: "avoid",
              }}
            >
              <span
                style={{
                  fontSize: `${card.fontSizeMm}mm`,
                  lineHeight: 1,
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
