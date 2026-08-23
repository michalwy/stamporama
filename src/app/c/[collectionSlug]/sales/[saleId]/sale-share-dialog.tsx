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
import type { SaleShareState } from "@/lib/sales";
import type { ShareAddressRefusal } from "@/lib/share-address";
import {
  createSaleShareLinkAction,
  revokeSaleShareLinkAction,
  setSaleShareOptionsAction,
} from "@/app/actions/sales";

// The seller's end of the buyer's link (#699; ADR-0013 §7) — the trade share dialog's shape (#640,
// #681), one screen over, and the differences are the interesting part.
//
// **There is no *show values* switch.** A trade's link is a column of figures and disclosing them is
// a real choice; this page has no figures at all. The buyer already knows what they paid, and the
// rest of the sale is nobody else's business in any setting, so there is no setting.
//
// **The address is on the dialog whenever it can be** (#681): a link that could not be shown again
// could not be sent twice, opened to see what the buyer is actually being asked, or handed to a
// buyer who lost it — and the only recovery was minting a new one, which silently breaks the link
// they are holding.

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
 *  because *generate a new one* is right for two of these three and wrong for the third, where it
 *  would break the buyer's address and change nothing else. */
const UNREADABLE_MESSAGE: Record<ShareAddressRefusal, string> = {
  legacy:
    "This link was generated before Stamporama kept a copy it could show you, so its address is gone from here. The buyer's copy still works. Generate a new link to see the address — the old one stops working.",
  unreadable:
    "This link cannot be opened with the key this install is running now, which has changed since the link was generated. The buyer's copy still works. Generate a new link to see the address — the old one stops working.",
  unconfigured:
    "This link cannot be shown because this install has no STAMPORAMA_SECRET_KEY set, so there is nothing to unlock it with. The buyer's copy still works, and a new link would be just as unreadable — set the key first.",
};

/** A stored timestamp as the `yyyy-mm-dd` a date input takes. */
function dayValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function dateText(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "";
}

export function SaleShareDialog({
  saleId,
  share,
  pendingCount,
  onClose,
  onChanged,
}: {
  saleId: string;
  /** The link this sale already has, or null. */
  share: SaleShareState | null;
  /** How many lines are still waiting for a set to be chosen — what the buyer would be asked. */
  pendingCount: number;
  onClose: () => void;
  /** Refresh the sale behind the dialog. Deliberately does **not** close it: the seller has just
   *  minted an address and is about to copy it. */
  onChanged: () => void;
}) {
  // The URL of a link minted in this session. Kept apart from the one read off the sale only so the
  // address is on screen the instant it is minted, ahead of the refetch behind the dialog.
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const expiresAt = String(new FormData(e.currentTarget).get("expiresAt") ?? "");
    setError(undefined);
    // With a link already in place the button saves its expiry; without one, or when the seller has
    // asked for a new address, it mints.
    const mint = !share || confirmRegenerate;
    startTransition(async () => {
      if (mint) {
        const result = await createSaleShareLinkAction(saleId, expiresAt);
        if (result.status === "success") {
          setMinted(`${window.location.origin}/s/${result.token}`);
          setConfirmRegenerate(false);
          setCopied(false);
          onChanged();
        } else setError(result.message);
        return;
      }
      const result = await setSaleShareOptionsAction(saleId, expiresAt);
      if (result.status === "success") {
        onChanged();
        onClose();
      } else setError(result.message);
    });
  }

  // The address as the buyer would type it, built from the origin the seller is already looking at —
  // by construction the right one — and from the token the sale carries, so it survives this dialog
  // being closed and reopened. `minted` leads only because it lands a moment sooner.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = minted ?? (share?.address.readable ? `${origin}/s/${share.address.token}` : null);
  const unreadable = !link && share && !share.address.readable ? share.address.reason : null;

  function revoke() {
    setError(undefined);
    startTransition(async () => {
      const result = await revokeSaleShareLinkAction(saleId);
      if (result.status === "success") {
        onChanged();
        onClose();
      } else setError(result.message);
    });
  }

  return (
    <DialogShell title="Ask the buyer" onClose={onClose} maxWidth="34rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={submit}
      >
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <p style={META}>
              {pendingCount > 0
                ? `Send the buyer a link and let them pick which copy they get. It shows ${
                    pendingCount === 1 ? "the one unit" : `the ${pendingCount} units`
                  } nobody has chosen a set for, with photos of the copies, and nothing else about this sale or your collection.`
                : "Every unit on this sale has had its set chosen, so there is nothing left to ask about. A link opens on a page saying so."}
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
                  {/* The page as the buyer has it, in a tab of its own — the one way to check what
                      they are actually being asked, and it must not take the seller off the sale
                      they are working on. */}
                  <DialogSecondaryButton
                    type="button"
                    onClick={() => window.open(link, "_blank", "noopener,noreferrer")}
                  >
                    Open as the buyer sees it
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
              <LabelWithError htmlFor="sale-share-expires">Expires (optional)</LabelWithError>
              <input
                id="sale-share-expires"
                name="expiresAt"
                type="date"
                defaultValue={dayValue(share?.expiresAt ?? null)}
                disabled={isPending}
                style={INPUT_STYLE}
              />
              <p style={HINT}>
                Left blank, the link stays live until you withdraw it. The question closes on its own
                once you mark the sale packed — from then on the page says the copies are settled.
              </p>
            </div>

            {confirmRegenerate && (
              <p style={{ ...HINT, color: "var(--color-warning)" }}>
                Generating a new link stops the old one working. The buyer will need the new address.
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
