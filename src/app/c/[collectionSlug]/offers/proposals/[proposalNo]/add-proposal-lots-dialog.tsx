"use client";

import { useMemo, useState } from "react";
import { DialogShell, DialogBody, DialogActions, PICKER_DIALOG_HEIGHT } from "@/app/dialog-shell";
import { formControl } from "@/app/control-style";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { OfferStateChip } from "../../offer-badges";
import { useProposalLotCandidates } from "../use-proposals-query";

const SEARCH_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.625rem",
  padding: "0.5rem 0.25rem",
  borderBottom: "1px solid var(--color-border)",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const MUTED: React.CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

/**
 * *Add offers…* on a proposal's screen (#2287): the Direct offers already made that could be its lots —
 * open and in no proposal — picked here. The server asks each again on save, since the list is a
 * moment old by then.
 */
export function AddProposalLotsDialog({
  collectionId,
  proposalId,
  platformName,
  isPending,
  error,
  onCancel,
  onSubmit,
}: {
  collectionId: string;
  proposalId: string;
  /** The Direct platform's name, for the empty state. */
  platformName: string;
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (offerIds: string[]) => void;
}) {
  const { data: offers = [], isLoading } = useProposalLotCandidates(collectionId, proposalId);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | undefined>();

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^#/, "");
    if (!q) return offers;
    return offers.filter((o) => o.title.toLowerCase().includes(q) || String(o.offerNo) === q);
  }, [offers, search]);

  function toggle(offerId: string) {
    setLocalError(undefined);
    setPicked((prev) => (prev.includes(offerId) ? prev.filter((id) => id !== offerId) : [...prev, offerId]));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (picked.length === 0) {
      setLocalError("Pick the offers to add.");
      return;
    }
    onSubmit(picked);
  }

  return (
    <DialogShell
      title="Add offers to the proposal"
      maxWidth="44rem"
      height={offers.length > 8 ? PICKER_DIALOG_HEIGHT : undefined}
      onClose={() => {
        if (!isPending) onCancel();
      }}
    >
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={submit}>
        <DialogBody>
          {isLoading ? (
            <p style={MUTED}>Loading…</p>
          ) : offers.length === 0 ? (
            <p style={MUTED}>
              No offer can be added: a proposal takes {platformName} offers that are still open and in no other
              proposal. Generate offers on {platformName} from the Copies list to make some.
            </p>
          ) : (
            <>
              <TextInput
                type="search"
                aria-label="Find an offer"
                placeholder="Find by title or offer number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...SEARCH_STYLE, marginBottom: "0.5rem" }}
                {...NO_AUTOFILL}
              />
              {visible.length === 0 ? (
                <p style={MUTED}>No offer matches.</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Offers">
                  {visible.map((offer) => (
                    <li key={offer.offerId}>
                      <label style={ROW}>
                        <input
                          type="checkbox"
                          checked={picked.includes(offer.offerId)}
                          disabled={isPending}
                          onChange={() => toggle(offer.offerId)}
                        />
                        <EntityNoChip entity="offer" no={offer.offerNo} prefix="o" />
                        <span style={{ flex: 1, minWidth: 0 }}>{offer.title}</span>
                        <OfferStateChip state={offer.state} />
                        <span style={{ ...MUTED, minWidth: "5rem", textAlign: "right" }}>
                          {offer.price ? `${offer.price} ${offer.currency}` : "no price"}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Adding…" : picked.length > 1 ? `Add ${picked.length} offers` : "Add offer"}
          onCancel={onCancel}
          disabled={isPending || offers.length === 0}
          error={localError ?? error}
        />
      </form>
    </DialogShell>
  );
}
