"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  RecombinationFiller,
  RecombinationOfferRef,
  RecombinationSeriesView,
  RecombinationStampName,
} from "@/lib/series-recombination";
import { compositionOutcome, type CompositionOfferChange } from "@/lib/series-recombination-rules";
import { formatItemNo } from "@/lib/item-number";
import { Icon } from "@/app/icons";
import { FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { ROW_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import {
  DialogActions,
  DialogBody,
  DialogPrimaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import { OfferStateChip } from "../offer-badges";
import { BAND, Callout, Empty, NOTE, SectionHeading, SkeletonBlock } from "../lot-builder/lot-builder-chrome";
import { useInvalidateOffers, useSeriesFromSingles } from "../use-offers-query";

// The series-recombination screen (#1210). The platform comes first, as on the lot builder, because
// availability is a per-platform question; it lives in the URL, so a refresh or a shared link lands on
// the same answer.
//
// Each series is a card, a row per slot, and each slot names **every** copy that can fill it — an
// available copy, or the single offer that holds one. Where there is more than one, the collector
// picks (#1211) — nothing is pre-selected, since conditions are not ranked (#570, ADR-0032) — and the
// card composes the series as one offer, after a dialog saying which offers lose a set, which of those
// are live and which are withdrawn.

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
              <SeriesCard
                key={series.checklistId}
                series={series}
                collectionId={collectionId}
                collectionSlug={collectionSlug}
                platformId={platformId}
                platformName={query.data.platformName}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SeriesCard({
  series,
  collectionId,
  collectionSlug,
  platformId,
  platformName,
}: {
  series: RecombinationSeriesView;
  collectionId: string;
  collectionSlug: string;
  platformId: string;
  platformName: string;
}) {
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [composing, setComposing] = useState(false);
  // A slot with one copy is taken as is. A choice survives a refetch only while its copy is still
  // listed for the slot, so the card never composes out of a copy it no longer shows.
  const picks = useMemo(() => {
    const out: Record<string, string> = {};
    for (const slot of series.slots) {
      const only = slot.fillers.length === 1 ? slot.fillers[0].itemId : undefined;
      const pick = chosen[slot.stamp.stampId];
      const valid = slot.fillers.some((filler) => filler.itemId === pick) ? pick : undefined;
      const itemId = only ?? valid;
      if (itemId) out[slot.stamp.stampId] = itemId;
    }
    return out;
  }, [series.slots, chosen]);
  const unchosen = series.slots.filter((slot) => !picks[slot.stamp.stampId]).length;

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
      {series.slots.map((slot, index) => {
        const choosing = slot.fillers.length > 1;
        return (
          <div
            key={slot.stamp.stampId}
            style={{ ...SLOT_ROW, borderTop: index === 0 ? undefined : "1px solid var(--color-border)" }}
          >
            <StampName stamp={slot.stamp} />
            <div
              role={choosing ? "radiogroup" : undefined}
              aria-label={choosing ? `Copy for ${slot.stamp.catalogNumber ?? slot.stamp.name ?? "this stamp"}` : undefined}
              style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}
            >
              {slot.fillers.map((filler) =>
                choosing ? (
                  <label
                    key={filler.itemId}
                    style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}
                  >
                    <input
                      type="radio"
                      name={`${series.checklistId}:${slot.stamp.stampId}`}
                      checked={picks[slot.stamp.stampId] === filler.itemId}
                      onChange={() =>
                        setChosen((prev) => ({ ...prev, [slot.stamp.stampId]: filler.itemId }))
                      }
                      style={{ margin: 0 }}
                    />
                    <FillerLine filler={filler} collectionSlug={collectionSlug} />
                  </label>
                ) : (
                  <FillerLine key={filler.itemId} filler={filler} collectionSlug={collectionSlug} />
                )
              )}
            </div>
          </div>
        );
      })}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.5rem 0.75rem",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <DialogPrimaryButton type="button" disabled={unchosen > 0} onClick={() => setComposing(true)}>
          <Icon name="newOffer" /> Compose one offer…
        </DialogPrimaryButton>
        <span style={NOTE}>
          {unchosen > 0
            ? `Choose which copy fills ${unchosen === 1 ? "the stamp" : `each of the ${unchosen} stamps`} with more than one.`
            : "One new Preparing offer holding the whole series as one set."}
        </span>
      </div>
      {composing ? (
        <ComposeSeriesDialog
          series={series}
          picks={picks}
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          platformId={platformId}
          platformName={platformName}
          onClose={() => setComposing(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * What composing is about to do, and the commit (#1211). The outcome is the same pure
 * `compositionOutcome` the commit carries out, over the offers as the screen last read them; the
 * commit re-reads, so a copy that changed since is refused by name rather than composed around.
 */
function ComposeSeriesDialog({
  series,
  picks,
  collectionId,
  collectionSlug,
  platformId,
  platformName,
  onClose,
}: {
  series: RecombinationSeriesView;
  picks: Record<string, string>;
  collectionId: string;
  collectionSlug: string;
  platformId: string;
  platformName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { invalidateAll } = useInvalidateOffers();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const chosen = series.slots.flatMap((slot) => {
    const filler = slot.fillers.find((f) => f.itemId === picks[slot.stamp.stampId]);
    return filler ? [filler] : [];
  });
  const offerRefs = new Map<string, RecombinationOfferRef>();
  for (const filler of chosen) for (const offer of filler.offers) offerRefs.set(offer.offerId, offer);
  const outcome = compositionOutcome(
    chosen.map((filler) => ({ offerIds: filler.offers.map((offer) => offer.offerId) })),
    new Map([...offerRefs].map(([id, offer]) => [id, { state: offer.state, setCount: offer.setCount }]))
  );

  function commit() {
    setError(undefined);
    startTransition(async () => {
      const { composeSeriesOfferAction } = await import("@/app/actions/offers");
      const result = await composeSeriesOfferAction(collectionId, platformId, series.checklistId, picks);
      if (result.status === "success") {
        await invalidateAll(collectionId);
        router.push(`/c/${collectionSlug}/offers/${result.offerId}`);
      } else setError(result.message);
    });
  }

  return (
    <DialogShell title="Compose the series as one offer" onClose={onClose} maxWidth="40rem">
      <DialogBody>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", fontSize: "0.875rem" }}>
          <p style={{ margin: 0, color: "var(--color-text-primary)", lineHeight: 1.5 }}>
            A new <strong>Preparing</strong> offer on {platformName} holding <strong>{series.checklistName}</strong>{" "}
            as one set of {chosen.length} {chosen.length === 1 ? "copy" : "copies"}.
          </p>
          {outcome.length === 0 ? (
            <span style={NOTE}>Every chosen copy is available, so no other offer changes.</span>
          ) : (
            <>
              <span style={NOTE}>
                Each chosen single leaves its offer; the other sets in that offer stay where they are.
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {outcome.map((change) => {
                  const offer = offerRefs.get(change.offerId);
                  return offer ? (
                    <OutcomeLine
                      key={change.offerId}
                      offer={offer}
                      change={change}
                      platformName={platformName}
                    />
                  ) : null;
                })}
              </div>
            </>
          )}
        </div>
      </DialogBody>
      <DialogActions
        actionLabel={pending ? "Composing…" : "Compose offer"}
        onCancel={onClose}
        onAction={commit}
        disabled={pending}
        error={error}
      />
    </DialogShell>
  );
}

function OutcomeLine({
  offer,
  change,
  platformName,
}: {
  offer: RecombinationOfferRef;
  change: CompositionOfferChange;
  platformName: string;
}) {
  const lost = change.setsLost === 1 ? "1 set" : `${change.setsLost} sets`;
  const left = change.setsLeft === 1 ? "1 set" : `${change.setsLeft} sets`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      <EntityNoChip entity="offer" no={offer.offerNo} prefix="o" />
      <span style={{ color: "var(--color-text-primary)" }}>{offer.label}</span>
      <OfferStateChip state={offer.state} />
      <span style={NOTE}>
        {change.withdrawn ? `loses ${lost} and is withdrawn — nothing is left in it` : `loses ${lost}, keeps ${left}`}
      </span>
      {change.live ? (
        <span style={{ ...NOTE, color: "var(--color-warning)" }}>
          {change.withdrawn
            ? `Live: take the listing down on ${platformName}.`
            : `Live: flagged as changed — update the listing on ${platformName}.`}
        </span>
      ) : null}
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
