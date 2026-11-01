"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  DialogDestructiveButton,
  LabelWithError,
} from "@/app/dialog-shell";
import type { ProposalShareState } from "@/lib/proposal-handout";
import type { ShareAddressRefusal } from "@/lib/share-address";
import { hasProposalDocumentLabels, proposalSharePath } from "@/lib/proposal-document-rules";
import { languageLabel } from "@/lib/languages";
import { createProposalShareLinkAction, revokeProposalShareLinkAction } from "@/app/actions/proposals";
import { formControl, multiLineFormControl } from "@/app/control-style";
import { proposalKeys } from "../use-proposals-query";

// **Document…** (#2288) — the collector's end of a proposal's document: the page to print or save as a
// PDF, and the link a buyer opens without an account, managed as a post's preview link is (#2212) —
// create, copy, open as the buyer sees it, replace, withdraw — with when it was made and last opened.
// Neither making the link nor opening the page changes the proposal's state (#2329). It says when the
// proposal is closed, which is all a buyer opening the link then sees, and when its language is one
// the page has no words in.

const LINK_BOX: React.CSSProperties = {
  ...formControl,
  ...multiLineFormControl,
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  color: "var(--color-text-primary)",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "0.8125rem",
  wordBreak: "break-all",
  background: "var(--color-bg-page)",
};

const META: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  margin: 0,
  lineHeight: 1.5,
};

/** Why an existing link cannot be shown, each ending in the step that follows. */
const UNREADABLE_MESSAGE: Record<ShareAddressRefusal, string> = {
  legacy:
    "This link's address cannot be shown here. The buyer's copy still works. Generate a new link to see the address — the old one stops working.",
  unreadable:
    "This link cannot be opened with the key this install is running now, which has changed since the link was generated. The buyer's copy still works. Generate a new link to see the address — the old one stops working.",
  unconfigured:
    "This link cannot be shown because this install has no STAMPORAMA_SECRET_KEY set. The buyer's copy still works, and a new link would be just as unreadable — set the key first.",
};

function dateText(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export function ProposalDocumentDialog({
  collectionId,
  collectionSlug,
  proposalId,
  proposalNo,
  onClose,
  onChanged,
}: {
  collectionId: string;
  collectionSlug: string;
  proposalId: string;
  proposalNo: number;
  onClose: () => void;
  /** A link was made or withdrawn. */
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const linkKey = proposalKeys.shareLink(collectionId, proposalId);
  const { data, isLoading, isError } = useQuery<ProposalShareState>({
    queryKey: linkKey,
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/proposals/${proposalId}/share-link`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ProposalShareState;
    },
  });
  const share = data?.link ?? null;
  const language = data?.language ?? null;

  // The address of a link minted in this dialog, on screen before the refetch lands.
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const shownError = error ?? (isError ? "Could not read the link. Please try again." : undefined);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link =
    minted ?? (share?.address.readable ? `${origin}${proposalSharePath(share.address.token)}` : null);
  const unreadable = !link && share && !share.address.readable ? share.address.reason : null;

  function mint() {
    setError(undefined);
    startTransition(async () => {
      const result = await createProposalShareLinkAction(proposalId);
      if (result.status === "success") {
        setMinted(`${window.location.origin}${proposalSharePath(result.token)}`);
        setConfirmRegenerate(false);
        setCopied(false);
        await queryClient.invalidateQueries({ queryKey: linkKey });
        onChanged();
      } else setError(result.message);
    });
  }

  function revoke() {
    setError(undefined);
    startTransition(async () => {
      const result = await revokeProposalShareLinkAction(proposalId);
      if (result.status === "success") {
        await queryClient.invalidateQueries({ queryKey: linkKey });
        onChanged();
        onClose();
      } else setError(result.message);
    });
  }

  const hasLink = !!share || !!minted;

  return (
    <DialogShell title="Document for the buyer" onClose={onClose} maxWidth="34rem">
      <DialogBody>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <p style={META}>
            Every lot with its number, title, price and photos, and the total — in the proposal&apos;s
            language, and nothing else from your collection.
          </p>

          <div>
            <LabelWithError>To print or save as a PDF</LabelWithError>
            <div style={{ marginTop: "0.375rem" }}>
              <DialogSecondaryButton
                type="button"
                onClick={() =>
                  window.open(`/c/${collectionSlug}/offers/proposals/${proposalNo}/document`, "_blank", "noopener,noreferrer")
                }
              >
                Open the page
              </DialogSecondaryButton>
            </div>
          </div>

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
              <p style={{ ...META, marginTop: "0.375rem" }}>{UNREADABLE_MESSAGE[unreadable]}</p>
            </div>
          )}

          {!hasLink && data && (
            <p style={META}>
              A link a buyer opens without an account. It stays live: it follows the prices until the
              proposal closes, and then says the offer is closed.
            </p>
          )}

          {share && (
            <p style={META}>
              Created {dateText(share.createdAt)}
              {share.lastUsedAt ? ` · last opened ${dateText(share.lastUsedAt)}` : " · not opened yet"}
            </p>
          )}

          {data && data.standing !== "shown" && (
            <p style={{ ...META, color: "var(--color-warning)" }}>
              The proposal is closed, so a buyer opening the link is told the offer is closed.
            </p>
          )}

          {data && !hasProposalDocumentLabels(language) && (
            <p style={{ ...META, color: "var(--color-warning)" }}>
              The proposal is in {language ? languageLabel(language) : "this proposal's language"}, but the
              page&apos;s headings and notices have no translation into it, so the buyer sees them in English.
            </p>
          )}

          {confirmRegenerate && (
            <p style={{ ...META, color: "var(--color-warning)" }}>
              Generating a new link stops the old one working. Anyone holding it will need the new address.
            </p>
          )}
        </div>
      </DialogBody>

      <DialogActions
        actionLabel={
          isPending
            ? "Working…"
            : isLoading
              ? "Loading…"
              : !hasLink
                ? "Generate link"
                : confirmRegenerate
                  ? "Generate new link"
                  : "Done"
        }
        disabled={isPending || isLoading || (data?.standing !== "shown" && (!hasLink || confirmRegenerate))}
        cancelDisabled={isPending}
        cancelLabel={hasLink && !confirmRegenerate ? "Close" : "Cancel"}
        error={shownError}
        onCancel={onClose}
        onAction={!hasLink || confirmRegenerate ? mint : onClose}
        leading={
          share && !confirmRegenerate ? (
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <DialogSecondaryButton type="button" disabled={isPending} onClick={() => setConfirmRegenerate(true)}>
                New link
              </DialogSecondaryButton>
              <DialogDestructiveButton type="button" disabled={isPending} onClick={revoke}>
                Withdraw
              </DialogDestructiveButton>
            </div>
          ) : undefined
        }
      />
    </DialogShell>
  );
}
