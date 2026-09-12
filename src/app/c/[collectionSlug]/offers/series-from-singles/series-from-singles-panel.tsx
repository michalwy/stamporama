"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  RecombinationFiller,
  RecombinationSeriesView,
  RecombinationStampName,
} from "@/lib/series-recombination";
import { formatItemNo } from "@/lib/item-number";
import { Icon } from "@/app/icons";
import { FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { ROW_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { OfferStateChip } from "../offer-badges";
import { BAND, Callout, Empty, NOTE, SectionHeading, SkeletonBlock } from "../lot-builder/lot-builder-chrome";
import { useSeriesFromSingles } from "../use-offers-query";

// The series-recombination screen (#1210). The platform comes first, as on the lot builder, because
// availability is a per-platform question; it lives in the URL, so a refresh or a shared link lands on
// the same answer.
//
// Each series is a card, a row per slot, and each slot names **every** copy that can fill it — an
// available copy, or the single offer that holds one. Which of them to use is the collector's choice
// and #1211's act; this screen only says the series can be made, and what it would cost in offers.

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  overflow: "clip",
  background: "var(--color-bg-elevated)",
};

const SERIES_CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  overflow: "clip",
  background: "var(--color-bg-elevated)",
};

const SERIES_HEADING: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "0.5rem",
  flexWrap: "wrap",
  padding: "0.5rem 0.75rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-subtle)",
  borderBottom: "1px solid var(--color-border)",
};

const SLOT_ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(10rem, 16rem) 1fr",
  gap: "0.75rem",
  padding: "0.5rem 0.75rem",
  fontSize: "0.8125rem",
};

const LINK: React.CSSProperties = { color: "var(--color-accent)", textDecoration: "none" };

interface SeriesFromSinglesPanelProps {
  collectionId: string;
  collectionSlug: string;
  platforms: { id: string; name: string }[];
}

export function SeriesFromSinglesPanel({
  collectionId,
  collectionSlug,
  platforms,
}: SeriesFromSinglesPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("platformId") ?? "";
  const platformId = platforms.some((p) => p.id === requested) ? requested : "";
  const query = useSeriesFromSingles(collectionId, platformId);

  function choosePlatform(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("platformId", id);
    else params.delete("platformId");
    const qs = params.toString();
    router.replace(`/c/${collectionSlug}/offers/series-from-singles${qs ? `?${qs}` : ""}`, {
      scroll: false,
    });
  }

  return (
    <div style={CARD}>
      <div style={BAND}>
        <SectionHeading
          title="Platform"
          note="A series and its singles compete for the same buyers, so only offers on this platform count."
        />
        <select
          aria-label="Platform"
          value={platformId}
          onChange={(e) => choosePlatform(e.currentTarget.value)}
          style={{ ...FILTER_CONTROL_STYLE, minWidth: "14rem" }}
        >
          <option value="">Choose a platform…</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ padding: "0.875rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {!platformId ? (
          <Empty>
            Choose a platform. The screen then lists every series that the copies not offered there
            yet, together with the copies already offered there one at a time, could complete — and
            that the available copies could not complete on their own.
          </Empty>
        ) : query.isPending ? (
          <SkeletonBlock style={{ height: "6rem", width: "100%" }} />
        ) : query.isError ? (
          <Callout tone="warning">The series could not be read. Try again in a moment.</Callout>
        ) : query.data.series.length === 0 ? (
          <Empty>
            No series on {query.data.platformName} can be completed by recombining single offers. A
            series the available copies complete on their own is not listed here — the lot builder
            already offers it whole.
          </Empty>
        ) : (
          <>
            <span style={NOTE}>
              {query.data.series.length === 1
                ? "1 series"
                : `${query.data.series.length} series`}{" "}
              on {query.data.platformName} could be listed whole out of the singles there and the
              copies not offered there yet.
            </span>
            {query.data.series.map((series) => (
              <SeriesCard key={series.checklistId} series={series} collectionSlug={collectionSlug} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SeriesCard({
  series,
  collectionSlug,
}: {
  series: RecombinationSeriesView;
  collectionSlug: string;
}) {
  const issueName = series.issue
    ? (series.issue.name ?? (series.issue.year !== null ? String(series.issue.year) : "Unnamed issue"))
    : null;
  const offers = series.offersToChange === 1 ? "1 offer" : `${series.offersToChange} offers`;
  return (
    <div style={SERIES_CARD}>
      <div style={SERIES_HEADING}>
        {series.issue ? (
          <>
            <Link href={`/c/${collectionSlug}/issues/${series.issue.issueId}`} style={LINK}>
              {issueName}
            </Link>
            <span style={{ color: "var(--color-text-muted)" }}>·</span>
          </>
        ) : null}
        <span>{series.checklistName}</span>
        <span style={{ flex: 1 }} />
        <span style={{ ...NOTE, fontWeight: 400 }}>
          {series.slots.length} stamps · at least {offers} would change
          {series.offersToChange > 0 ? `, ${series.liveOffersToChange} of them live` : ""}
        </span>
      </div>
      {series.slots.map((slot, index) => (
        <div
          key={slot.stamp.stampId}
          style={{ ...SLOT_ROW, borderTop: index === 0 ? undefined : "1px solid var(--color-border)" }}
        >
          <StampName stamp={slot.stamp} />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {slot.fillers.map((filler) => (
              <FillerLine key={filler.itemId} filler={filler} collectionSlug={collectionSlug} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StampName({ stamp }: { stamp: RecombinationStampName }) {
  return (
    <span style={{ color: "var(--color-text-primary)", minWidth: 0 }}>
      {stamp.catalogNumber ? (
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{stamp.catalogNumber} </span>
      ) : null}
      <span style={{ color: "var(--color-text-secondary)" }}>{stamp.name ?? ""}</span>
    </span>
  );
}

function FillerLine({ filler, collectionSlug }: { filler: RecombinationFiller; collectionSlug: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      <Link
        href={`/c/${collectionSlug}/inventory/${filler.itemId}`}
        style={{ ...LINK, fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}
      >
        {formatItemNo(filler.itemNo)}
      </Link>
      {filler.condition ? <span style={ROW_CHIP}>{filler.condition}</span> : null}
      {filler.variant ? (
        <span style={NOTE}>
          variant {filler.variant.catalogNumber ?? filler.variant.name ?? ""}
        </span>
      ) : null}
      {filler.offers.length === 0 ? (
        <span style={NOTE}>not offered here yet</span>
      ) : (
        filler.offers.map((offer) => (
          <span
            key={offer.offerId}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", minWidth: 0 }}
          >
            <span style={NOTE}>alone in</span>
            <EntityNoChip entity="offer" no={offer.offerNo} prefix="o" />
            <Link href={`/c/${collectionSlug}/offers/${offer.offerId}`} style={LINK}>
              {offer.label}
            </Link>
            <OfferStateChip state={offer.state} />
          </span>
        ))
      )}
      {/* The copy row's own *Promised* chip (#639), to the character: a promise is counted and named
          here, never a reason to leave the copy out. */}
      {filler.promisedIn ? (
        <Tooltip
          content={`Promised to ${filler.promisedIn.partnerName} in trade #${filler.promisedIn.tradeNo}, which has been agreed. It cannot go live on a marketplace while that stands.`}
        >
          <span
            style={{
              ...ROW_CHIP,
              color: "var(--color-accent)",
              borderColor: "var(--color-accent-border)",
              background: "var(--color-accent-soft)",
            }}
          >
            <Icon name="trades" size="sm" /> Promised · #{filler.promisedIn.tradeNo}
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
