"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  DialogDestructiveButton,
  LabelWithError,
} from "@/app/dialog-shell";
import type { TradeShareState } from "@/lib/trades";
import type { TradeShareAddressRefusal } from "@/lib/trade-share-address";
import {
  createTradeShareLinkAction,
  revokeTradeShareLinkAction,
  setTradeShareOptionsAction,
} from "@/app/actions/trades";

// The collector's end of the partner's link (#640; ADR-0039 §9).
//
// **The address is on the dialog whenever it can be**, not only in the response that minted it
// (#681): a link that could not be shown again could not be sent twice, opened to see what the
// partner is actually reading, or handed to a partner who lost it — and the only recovery was
// minting a new one, which silently breaks the link they are holding. The raw token is sealed
// beside its hash for exactly this, so the box below is filled from the trade rather than from a
// response that has been and gone.
//
// **A link that cannot be shown says why**, in the terms of what to do next: a link older than #681
// or one sealed under a key that has since changed is recovered by generating a new one, while an
// install with no key configured would be no better off with a new one and needs the key first.
//
// **Two decisions, kept apart.** *Create* and *regenerate* change the address; *save* changes what
// the page shows. Turning the figures off on a list the partner is halfway through reading must not
// also break their link, so it does not.

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const HINT: React.CSSProperties = {
  margin: "0.375rem 0 0",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.5,
};

const CHECK_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const LINK_BOX: React.CSSProperties = {
  ...INPUT_STYLE,
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "0.8125rem",
  wordBreak: "break-all",
  background: "var(--color-bg-page)",
};

const META: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  margin: 0,
};

/** Why an existing link cannot be shown — each sentence ending in the step that follows from it,
 *  because *generate a new one* is the right advice for two of these three and the wrong advice for
 *  the third, where it would break the partner's address and change nothing else. */
const UNREADABLE_MESSAGE: Record<TradeShareAddressRefusal, string> = {
  legacy:
    "This link was generated before Stamporama kept a copy it could show you, so its address is gone from here. Your partner's copy still works. Generate a new link to see the address — the old one stops working.",
  unreadable:
    "This link cannot be opened with the key this install is running now, which has changed since the link was generated. Your partner's copy still works. Generate a new link to see the address — the old one stops working.",
  unconfigured:
    "This link cannot be shown because this install has no STAMPORAMA_SECRET_KEY set, so there is nothing to unlock it with. Your partner's copy still works, and a new link would be just as unreadable — set the key first.",
};

/** A stored timestamp as the `yyyy-mm-dd` a date input takes. */
function dayValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function dateText(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "";
}

export function TradeShareDialog({
  tradeId,
  share,
  onClose,
  onChanged,
}: {
  tradeId: string;
  /** The link this trade already has, or null. */
  share: TradeShareState | null;
  onClose: () => void;
  /** Refresh the trade behind the dialog. Deliberately does **not** close it: the collector has just
   *  minted an address and is about to copy it. */
  onChanged: () => void;
}) {
  // The URL of a link minted in this session. Kept apart from the one read off the trade only so the
  // address is on screen the instant it is minted, ahead of the refetch behind the dialog.
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(undefined);
    // With a link already in place the button saves its options; without one, or when the collector
    // has asked for a new address, it mints.
    const mint = !share || confirmRegenerate;
    startTransition(async () => {
      if (mint) {
        const result = await createTradeShareLinkAction(tradeId, formData);
        if (result.status === "success") {
          setMinted(`${window.location.origin}/t/${result.token}`);
          setConfirmRegenerate(false);
          setCopied(false);
          onChanged();
        } else setError(result.message);
        return;
      }
      const result = await setTradeShareOptionsAction(tradeId, formData);
      if (result.status === "success") {
        onChanged();
        onClose();
      } else setError(result.message);
    });
  }

  // The address as the partner would type it, built from the origin the collector is already looking
  // at — by construction the right one — and from the token the trade carries, so it survives this
  // dialog being closed and reopened. `minted` leads only because it lands a moment sooner.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link =
    minted ?? (share?.address.readable ? `${origin}/t/${share.address.token}` : null);
  const unreadable = !link && share && !share.address.readable ? share.address.reason : null;

  function revoke() {
    setError(undefined);
    startTransition(async () => {
      const result = await revokeTradeShareLinkAction(tradeId);
      if (result.status === "success") {
        onChanged();
        onClose();
      } else setError(result.message);
    });
  }

  return (
    <DialogShell title="Share with your partner" onClose={onClose} maxWidth="34rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={submit}
      >
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <p style={META}>
              {share
                ? "Anyone with the link can read this exchange list. They do not need an account, and they can see nothing else."
                : "Generate a link your partner can open without an account. It shows this exchange list and nothing else."}
            </p>

            {link && (
              <div>
                <LabelWithError>The link</LabelWithError>
                <div style={LINK_BOX}>{link}</div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <DialogSecondaryButton
                    type="button"
                    onClick={() =>
                      navigator.clipboard?.writeText(link).then(
                        () => setCopied(true),
                        () => setCopied(false)
                      )
                    }
                  >
                    {copied ? "Copied" : "Copy link"}
                  </DialogSecondaryButton>
                  {/* The page as the partner has it, in a tab of its own — the one way to check what
                      they are actually looking at, and it must not take the collector off the trade
                      they are working on. */}
                  <DialogSecondaryButton
                    type="button"
                    onClick={() => window.open(link, "_blank", "noopener,noreferrer")}
                  >
                    Open as your partner sees it
                  </DialogSecondaryButton>
                </div>
              </div>
            )}

            {unreadable && (
              <div>
                <LabelWithError>The link</LabelWithError>
                <p style={{ ...HINT, marginTop: "0.375rem" }}>{UNREADABLE_MESSAGE[unreadable]}</p>
              </div>
            )}

            {share && (
              <p style={META}>
                Created {dateText(share.createdAt)}
                {share.lastUsedAt
                  ? ` · last opened ${dateText(share.lastUsedAt)}`
                  : " · not opened yet"}
              </p>
            )}

            <div>
              <label style={CHECK_ROW}>
                <input
                  type="checkbox"
                  name="showValues"
                  value="true"
                  defaultChecked={share?.showValues ?? false}
                  disabled={isPending}
                />
                Show values
              </label>
              <p style={HINT}>
                With a catalogue agreed for this exchange, the page prices every line in it. Without
                one it falls back to <em>your own</em> valuation, saying which catalogue each line was
                read in — so this is what decides whether your own figures reach your partner.
              </p>
            </div>

            <div>
              <LabelWithError htmlFor="trade-share-expires">Expires (optional)</LabelWithError>
              <input
                id="trade-share-expires"
                name="expiresAt"
                type="date"
                defaultValue={dayValue(share?.expiresAt ?? null)}
                disabled={isPending}
                style={INPUT_STYLE}
              />
              <p style={HINT}>
                Left blank, the link stays live until you withdraw it. An exchange runs for weeks and a
                link that dies mid-negotiation is a phone call.
              </p>
            </div>

            {confirmRegenerate && (
              <p style={{ ...HINT, color: "var(--color-warning)" }}>
                Generating a new link stops the old one working. Your partner will need the new
                address.
              </p>
            )}
          </div>
        </DialogBody>

        <DialogActions
          actionLabel={
            isPending
              ? "Working…"
              : minted
                ? "Done"
                : share
                  ? confirmRegenerate
                    ? "Generate new link"
                    : "Save"
                  : "Generate link"
          }
          disabled={isPending}
          cancelDisabled={isPending}
          cancelLabel={minted ? "Close" : "Cancel"}
          error={error}
          onCancel={onClose}
          // `Done` on a minted link closes rather than submitting again — there is nothing left to
          // save, and pressing it a second time must not mint a third address.
          onAction={minted ? onClose : undefined}
          leading={
            share && !minted ? (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <DialogSecondaryButton
                  type="button"
                  disabled={isPending}
                  onClick={() => setConfirmRegenerate(true)}
                >
                  New link
                </DialogSecondaryButton>
                <DialogDestructiveButton type="button" disabled={isPending} onClick={revoke}>
                  Withdraw
                </DialogDestructiveButton>
              </div>
            ) : undefined
          }
        />
      </form>
    </DialogShell>
  );
}
