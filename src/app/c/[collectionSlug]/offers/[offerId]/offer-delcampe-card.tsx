"use client";

import { useState, useTransition } from "react";
import type { DelcampeOfferListingConfig } from "@/lib/delcampe-listing-profile";
import { countDelcampePromotions } from "@/lib/delcampe-listing-profile-rules";
import { setOfferDelcampeListingProfileAction } from "@/app/actions/delcampe";

// What this offer's Easy Uploader row is built from (#608) — the listing profile, and what it says.
//
// One question rather than the Allegro card's three: Delcampe's row needs no category of ours and no
// parameters (the category is #609's, learned the same way Allegro's is), so what is left is which
// profile applies. It is shown on the offer's own screen for the reason the Allegro one is — the
// value is settled while the listing is being prepared, not inside whichever dialog eventually
// exports it — and it states what the profile *holds*, because "Standard letter" says nothing about
// which shipping model, how often it renews, or what bid step the row will carry.
//
// Rendered only for the Delcampe platform: `OfferDetail.delcampeListing` is null everywhere else.

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem",
};

const helpText: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const SELECT: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  maxWidth: "22rem",
};

function money(value: number): string {
  return value.toFixed(2);
}

export function OfferDelcampeCard({
  offerId,
  config,
  onChanged,
}: {
  offerId: string;
  config: DelcampeOfferListingConfig;
  /** The offer screen re-reads itself after a write, so the card holds no copy of its own — one
   *  source, re-read, rather than two that can differ. */
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function choose(profileId: string) {
    setError(null);
    startTransition(async () => {
      const answer = await setOfferDelcampeListingProfileAction(offerId, profileId);
      if (answer.status === "error") setError(answer.message);
      else onChanged();
    });
  }

  const platformDefault = config.profileOptions.find((option) => option.isDefault);
  const profile = config.profile;

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>On Delcampe</h3>
        <span style={helpText}>what this listing is uploaded with</span>
      </div>

      {error && <p style={{ ...helpText, color: "var(--color-error)", marginTop: 0 }}>{error}</p>}

      {config.profileOptions.length === 0 ? (
        <p style={{ ...helpText, margin: 0 }}>
          This platform has no listing profiles yet. An upload row states a shipping model, a renewal
          setting and a bid step — create one under Settings → Delcampe.
        </p>
      ) : (
        <>
          <select
            aria-label="Delcampe listing profile"
            value={config.profileIsOverride ? (profile?.id ?? "") : ""}
            disabled={isPending}
            style={SELECT}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">
              Platform default
              {platformDefault ? ` (${platformDefault.name})` : " — none set"}
            </option>
            {config.profileOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>

          {profile ? (
            <p style={{ ...helpText, margin: "0.375rem 0 0" }}>
              Ships as <strong>{profile.shippingModel}</strong> · renews every {profile.renewDuration}{" "}
              days, up to {profile.renewTotalCount}× · bid step {money(profile.minBidStepBelow)} under{" "}
              {money(profile.minBidStepThreshold)}, {money(profile.minBidStepAtOrAbove)} from there
              {countDelcampePromotions(profile) > 0
                ? ` · ${countDelcampePromotions(profile)} paid promotion(s)`
                : ""}
            </p>
          ) : (
            <p style={{ ...helpText, margin: "0.375rem 0 0" }}>
              No profile applies to this offer — the platform has none set as its default, so name
              one here or make one the default under Settings → Delcampe.
            </p>
          )}
        </>
      )}
    </div>
  );
}
