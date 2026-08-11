"use client";

import type { ContactData } from "@/lib/contacts";
import { CREATABLE_OFFER_STATES, OFFER_STATE_LABEL, type OfferState } from "@/lib/offer-rules";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";

/**
 * Quick offer mode (#537): the parameters every offer of this listing pass shares, set once, so that
 * from then on **Add to new offer** creates the offer on the spot instead of opening the create
 * dialog.
 *
 * The use case is a bulk pass — a hundred and seventy-eight copies, each its own offer on one
 * platform, all starting in the same status, with the price and the listing URL still to come. The
 * ordinary flow asks for those two things per copy in a dialog, which is a mouse trip from the row
 * to the confirm button and back, once per item. Here the only per-item act left is the click on the
 * row.
 *
 * The bar is the mode's whole affordance, deliberately: what makes a silent create safe is that it
 * is impossible not to see *which* platform and *which* status the next click will use, and how many
 * offers the pass has made so far. That is also why the mode is **not remembered across visits** —
 * a collector returning tomorrow and clicking the same row entry would get an offer with no dialog
 * and no warning, which is the one thing this must never do. Arming it is one click and it says so.
 *
 * Only the two parameters an offer cannot be created without are here. The price and the URL are
 * left unset on purpose (the offer's own screen is where they land, once the listing exists) — that
 * is what makes this pass a *bulk* one, and it is exactly what #234's remembered values could not
 * do, since pre-filling a dialog still leaves the dialog.
 */
export function QuickOfferBar({
  platforms,
  platformId,
  onPlatformIdChange,
  state,
  onStateChange,
  created,
  error,
  isPending,
  onExit,
}: {
  /** The collection's platform contacts — the same list the create dialog offers. */
  platforms: ContactData[];
  platformId: string;
  onPlatformIdChange: (id: string) => void;
  state: OfferState;
  onStateChange: (state: OfferState) => void;
  /** How many offers this pass has created — the only feedback a dialog-less create leaves behind. */
  created: number;
  /** A create that failed, reported here because there is no dialog to report into. */
  error?: string;
  isPending: boolean;
  onExit: () => void;
}) {
  const platform = platforms.find((p) => p.id === platformId) ?? null;
  // A platform with no currency yet cannot take an offer without one being chosen (#196), and the
  // choice belongs in the create form where it is visible — a quick pass silently fixing a
  // platform's currency for good is not a decision to make by not making it.
  const blocked = !platform
    ? "Choose the platform these offers are listed on."
    : !platform.platformCurrency
      ? `${platform.name} has no currency yet. List one offer on it through the ordinary form first — that is where its currency is set.`
      : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.75rem",
        margin: "0.75rem 1rem 0",
        padding: "0.625rem 0.875rem",
        borderRadius: "0.5rem",
        border: "1px solid var(--color-accent)",
        background: "var(--color-accent-soft)",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.375rem",
          fontSize: "0.8125rem",
          fontWeight: 600,
          color: "var(--color-accent)",
        }}
      >
        <Icon name="newOffer" size="sm" /> Quick offer mode
      </span>

      <label style={FIELD}>
        <span style={FIELD_LABEL}>Platform</span>
        <select
          value={platformId}
          onChange={(e) => onPlatformIdChange(e.target.value)}
          aria-label="Platform for quick offers"
          style={SELECT_STYLE}
        >
          <option value="">Choose a platform…</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label style={FIELD}>
        <span style={FIELD_LABEL}>Status</span>
        <select
          value={state}
          onChange={(e) => onStateChange(e.target.value as OfferState)}
          aria-label="Status new quick offers start in"
          style={SELECT_STYLE}
        >
          {CREATABLE_OFFER_STATES.map((s) => (
            <option key={s} value={s}>
              {OFFER_STATE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <Tooltip
        content={
          blocked ??
          `Every "Add to new offer" now creates the offer straight away on ${platform?.name} as ${OFFER_STATE_LABEL[state]}, with no asking price and no listing URL — set those on the offer itself once the listing exists.`
        }
      >
        <span
          style={{
            fontSize: "0.75rem",
            color: blocked ? "var(--color-warning)" : "var(--color-text-secondary)",
            maxWidth: "22rem",
          }}
        >
          {blocked ?? "Add to new offer now creates the offer straight away — no dialog."}
        </span>
      </Tooltip>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginLeft: "auto" }}>
        {isPending && <span style={COUNTER}>Creating…</span>}
        {created > 0 && !isPending && (
          <span style={COUNTER}>
            {created} offer{created === 1 ? "" : "s"} created
          </span>
        )}
        <button
          type="button"
          onClick={onExit}
          style={{
            padding: "0.375rem 0.75rem",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.375rem",
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-secondary)",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Done
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            flexBasis: "100%",
            fontSize: "0.8125rem",
            color: "var(--color-error)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

const FIELD: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.375rem",
};

const FIELD_LABEL: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

const SELECT_STYLE: React.CSSProperties = {
  padding: "0.3125rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

const COUNTER: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-accent)",
};
