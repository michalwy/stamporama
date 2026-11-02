"use client";

import type { OwnOffers } from "@/lib/copy-open-offers";
import { usePersistedFlag } from "./use-persisted-flag";
import { Tooltip } from "./tooltip";

/**
 * *Not on any open offer* in the copy pickers (#2338): only the copies on no open offer on any
 * platform — the ones to prefer when putting an offer, a proposal or a trade together, since one
 * picked from them never has to be closed elsewhere when it sells. The Copies list carries the same
 * switch under *More filters*.
 *
 * Remembered per collection, one value for every picker — it is the same question in each — and the
 * picker sends it to the server, which reads it beside the picker's own eligibility.
 */
export function useNotOnOpenOffer(collectionId: string): [boolean, (next: boolean) => void] {
  return usePersistedFlag(`stamporama:copy-pickers:notOnOpenOffer:${collectionId}`);
}

export const NOT_ON_OPEN_OFFER_LABEL = "Not on any open offer";

/** What the toggle's hint calls the screen's own offers, which do not count against a copy. */
export function ownOffersNote(own: OwnOffers | null | undefined): string | undefined {
  if (own?.offerId) return "This offer is";
  if (own?.proposalId) return "This proposal's lots are";
  if (own?.facebookPostId) return "This post's lots are";
  return undefined;
}

const TOGGLE_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
  flexShrink: 0,
  cursor: "pointer",
};

/** The picker's checkbox. `ownOffers` names what does not count against a copy, where the picker
 *  was opened from an offer, a proposal or a post. */
export function NotOnOpenOfferToggle({
  checked,
  onChange,
  ownOffers,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ownOffers?: string;
}) {
  return (
    <Tooltip
      style={{ flexShrink: 0 }}
      content={`Only the copies on no open offer on any platform — a Preparing one counts, a sold or withdrawn one does not.${ownOffers ? ` ${ownOffers} not counted.` : ""}`}
    >
      <label style={TOGGLE_STYLE}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {NOT_ON_OPEN_OFFER_LABEL}
      </label>
    </Tooltip>
  );
}
