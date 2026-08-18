"use client";

import { useCallback, useState, useTransition } from "react";
import type { DelcampeOfferListingConfig } from "@/lib/delcampe-offer-listing";
import { countDelcampePromotions } from "@/lib/delcampe-listing-profile-rules";
import {
  rematchDelcampeOfferCategoryAction,
  setDelcampeOfferCategoryAction,
  setOfferDelcampeListingProfileAction,
} from "@/app/actions/delcampe";
import {
  DelcampeCategoryPath,
  DelcampeCategoryPicker,
  type DelcampeCategoryChoice,
} from "@/app/c/[collectionSlug]/shared/delcampe-category-picker";
import { Icon } from "@/app/icons";

// What this offer's Easy Uploader row is built from (#608, #609) — the category it is filed under and
// the listing profile it is uploaded with.
//
// Two questions rather than the Allegro card's three: Delcampe's categories carry **no parameters at
// all**, so a category and a profile is the whole of it. Both are shown on the offer's own screen for
// the same reason — the value is settled while the listing is being prepared, not inside whichever
// dialog eventually exports it — and the profile states what it *holds*, because "Standard letter"
// says nothing about which shipping model, how often it renews, or what bid step the row will carry.
//
// **Nothing on it is a gate.** The category is matched the moment the offer gains its first copy, and
// whatever was matched is what the file carries; every value is correctable in place and none asks to
// be confirmed. What the card carries instead is *provenance* — learned from what was prepared
// before, or picked by hand — because a value nobody can account for is one that gets re-checked by
// hand every time, which is the cost this was meant to remove.
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

/** Where a value came from, in one word. Shown rather than explained at length: the sentence beside
 *  it does the explaining, and this is what makes the difference scannable. */
const SOURCE_LABEL: Record<string, string> = {
  learned: "learned",
  manual: "chosen by you",
};

const LINK_BTN: React.CSSProperties = {
  padding: 0,
  background: "none",
  border: "none",
  color: "var(--color-accent)",
  fontSize: "0.8125rem",
  cursor: "pointer",
};

const SECTION_LABEL: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  margin: "0 0 0.25rem",
  fontWeight: 600,
};

export function OfferDelcampeCard({
  offerId,
  config,
  categorySearchTerm,
  onChanged,
}: {
  offerId: string;
  config: DelcampeOfferListingConfig;
  /** What the picker's search opens on — the offer's own key in words, "Poland used". A first guess
   *  and nothing more: Delcampe's tree is cut by country and period rather than by this collection's
   *  areas, so it is a head start rather than an answer. */
  categorySearchTerm?: string | null;
  /** The offer screen re-reads itself after a write, so the card holds no copy of its own — one
   *  source, re-read, rather than two that can differ. */
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [isPending, startTransition] = useTransition();

  const apply = useCallback(
    (run: () => Promise<{ status: "success" } | { status: "error"; message: string }>) => {
      setError(null);
      startTransition(async () => {
        const answer = await run();
        if (answer.status === "error") setError(answer.message);
        else onChanged();
      });
    },
    [onChanged]
  );

  function choose(profileId: string) {
    apply(() => setOfferDelcampeListingProfileAction(offerId, profileId));
  }

  const chooseCategory = useCallback(
    (choice: DelcampeCategoryChoice) => {
      setPicking(false);
      apply(() =>
        setDelcampeOfferCategoryAction(offerId, {
          categoryId: choice.categoryId,
          categoryName: choice.categoryName,
          categoryPath: choice.categoryPath,
        })
      );
    },
    [apply, offerId]
  );

  const platformDefault = config.profileOptions.find((option) => option.isDefault);
  const profile = config.profile;

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>On Delcampe</h3>
        <span style={helpText}>what this listing is uploaded with</span>
      </div>

      {error && <p style={{ ...helpText, color: "var(--color-error)", marginTop: 0 }}>{error}</p>}

      {/* ── Category ─────────────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "1rem" }}>
        <p style={{ ...SECTION_LABEL, color: "var(--color-text-secondary)" }}>Category</p>
        {config.categoryId ? (
          <>
            {/* The **path**, not the leaf name. Delcampe calls a leaf `Used stamps` some hundreds of
                times over, and only the breadcrumb says which country's and which period's. It
                already ends in the leaf, so the name is not shown twice; it only stands in where no
                path was recorded — a number typed by hand. */}
            <p style={{ margin: 0, fontSize: "0.875rem" }}>
              <DelcampeCategoryPath
                path={config.categoryPath}
                name={config.categoryName ?? `#${config.categoryId}`}
              />
              <span style={{ ...helpText, marginLeft: "0.5rem" }}>
                · #{config.categoryId}
                {config.source ? ` · ${SOURCE_LABEL[config.source] ?? config.source}` : ""}
              </span>
            </p>
            {config.matchedOn && <p style={{ ...helpText, margin: "0.125rem 0 0" }}>{config.matchedOn}</p>}
          </>
        ) : (
          <p style={{ ...helpText, margin: 0 }}>
            Nothing matched yet — this is the first offer of its kind. Choose a category and the next
            one like it will open with it already filled in.
          </p>
        )}

        <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
          <button type="button" style={LINK_BTN} disabled={isPending} onClick={() => setPicking(true)}>
            {config.categoryId ? "Change category" : "Choose a category"}
          </button>
          {/* Explicit, and destructive by design: it is the way back to the register's own answer
              after a correction, and after the composition has changed enough that the first match no
              longer describes the goods. Nothing re-matches on its own. */}
          <button
            type="button"
            style={LINK_BTN}
            disabled={isPending}
            onClick={() => apply(() => rematchDelcampeOfferCategoryAction(offerId))}
          >
            <Icon name="refresh" size="sm" /> Match again
          </button>
        </div>
      </div>

      {/* ── Listing profile ──────────────────────────────────────────────────────────────── */}
      <p style={{ ...SECTION_LABEL, color: "var(--color-text-secondary)" }}>Listing profile</p>
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

      {picking && (
        <DelcampeCategoryPicker
          title="Delcampe category"
          // One or the other, never both: an offer that already has a category opens *at* it, and
          // one that has none opens on its own key as a search. A search over a category already
          // chosen would narrow the tree away from the very node it should be showing.
          initialTerm={config.categoryId ? null : categorySearchTerm}
          initialPath={config.categoryPath}
          onClose={() => setPicking(false)}
          onChosen={chooseCategory}
        />
      )}
    </div>
  );
}
