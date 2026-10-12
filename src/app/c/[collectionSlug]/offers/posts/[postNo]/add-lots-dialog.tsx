"use client";

import { useMemo, useState } from "react";
import { DialogShell, DialogBody, DialogActions, PICKER_DIALOG_HEIGHT } from "@/app/dialog-shell";
import { formControl } from "@/app/control-style";
import { OFFER_LISTING_TYPE_LABEL } from "@/lib/offer-rules";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { OfferStateChip } from "../../offer-badges";
import { useFacebookLotCandidates } from "../../use-offers-query";

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
 * *Add lots…* on a post's screen (#1870): the offers that could join the post — Facebook offers in its
 * group, in no post, not yet up, of a type it holds unless its group mixes them — picked here, and
 * added as the post's next lots **in the order they were picked**, each row saying which lot it will
 * be. The server asks each again on save, since the list is a moment old by then.
 */
export function AddLotsDialog({
  collectionId,
  postId,
  postNo,
  nextLotNo,
  isPending,
  error,
  onCancel,
  onSubmit,
}: {
  collectionId: string;
  postId: string;
  postNo: number;
  /** The number the first offer picked becomes. */
  nextLotNo: number;
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (offerIds: string[]) => void;
}) {
  const { data: offers = [], isLoading } = useFacebookLotCandidates(collectionId, postId);
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
      title={`Add lots to post #${postNo}`}
      maxWidth="44rem"
      height={offers.length > 8 ? PICKER_DIALOG_HEIGHT : undefined}
      onClose={() => {
        if (!isPending) onCancel();
      }}
    >
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={submit}>
        <DialogBody>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
            The offers you pick become the post&apos;s next lots, in the order you pick them.
          </p>
          {isLoading ? (
            <p style={MUTED}>Loading…</p>
          ) : offers.length === 0 ? (
            <p style={MUTED}>
              No offer can join this post: it takes Facebook offers in its group that are in no other post and not
              yet up{" "}— of its listing type, unless the group&apos;s posts may mix them.
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
                  {visible.map((offer) => {
                    const at = picked.indexOf(offer.offerId);
                    return (
                      <li key={offer.offerId}>
                        <label style={ROW}>
                          <input
                            type="checkbox"
                            checked={at >= 0}
                            disabled={isPending}
                            onChange={() => toggle(offer.offerId)}
                          />
                          <EntityNoChip entity="offer" no={offer.offerNo} prefix="o" />
                          <span style={{ flex: 1, minWidth: 0 }}>{offer.title}</span>
                          <span style={MUTED}>{OFFER_LISTING_TYPE_LABEL[offer.listingType]}</span>
                          <OfferStateChip state={offer.state} />
                          <span style={{ ...MUTED, minWidth: "3.5rem", textAlign: "right" }}>
                            {at >= 0 ? `lot ${nextLotNo + at}` : ""}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={
            isPending
              ? "Adding…"
              : picked.length > 1
                ? `Add ${picked.length} lots`
                : "Add lot"
          }
          onCancel={onCancel}
          disabled={isPending || offers.length === 0}
          error={localError ?? error}
        />
      </form>
    </DialogShell>
  );
}
