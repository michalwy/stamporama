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
import type {
  OfferSpecificationShareStanding,
  OfferSpecificationShareState,
} from "@/lib/offer-specification-share";
import type { ShareAddressRefusal } from "@/lib/share-address";
import { offerSpecificationSharePath } from "@/lib/offer-specification-share-rules";
import { languageLabel } from "@/lib/languages";
import { SpecificationLanguageSelect } from "./specification-language-select";
import {
  createOfferSpecificationShareLinkAction,
  revokeOfferSpecificationShareLinkAction,
} from "@/app/actions/offers";
import { formControl, multiLineFormControl } from "@/app/control-style";
import { ShareLinkVisitsLine } from "@/app/c/[collectionSlug]/shared/share-link-visits";

// The collector's end of the specification link (#1760) — the sale buyer link's dialog (#699) with
// less in it: no expiry date, because a link lives as long as the specification it was made from,
// and nothing for the buyer to answer. Create, copy, open as the buyer sees it, replace, withdraw.
//
// It says when the link no longer shows its specification — the offer changed or closed, and a buyer
// opening it is asked to contact the seller — because that is exactly when the collector needs to
// send a new one.
//
// **A link is made in a chosen language** (#2605), the offer's own by default, and keeps it. The
// selector shows the link's; choosing another means a *New link*, which replaces the address — an
// offer still has one link. It says when the language is one the buyer's page has no words in.
//
// **The address is on the dialog whenever it can be** (#681): a link that could not be shown again
// could not be sent twice or checked, and replacing it would break the address a buyer is holding.

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

/** Why an existing link cannot be shown, each ending in the step that follows — *generate a new
 *  one* is right for two of these and wrong for the third. */
const UNREADABLE_MESSAGE: Record<ShareAddressRefusal, string> = {
  legacy:
    "This link's address cannot be shown here. The buyer's copy still works. Generate a new link to see the address — the old one stops working.",
  unreadable:
    "This link cannot be opened with the key this install is running now, which has changed since the link was generated. The buyer's copy still works. Generate a new link to see the address — the old one stops working.",
  unconfigured:
    "This link cannot be shown because this install has no STAMPORAMA_SECRET_KEY set. The buyer's copy still works, and a new link would be just as unreadable — set the key first.",
};

/** What a link that no longer shows its specification means, ending in what to do about it. */
const STANDING_MESSAGE: Record<Exclude<OfferSpecificationShareStanding, "current">, string> = {
  changed:
    "The specification has changed since this link was made, so a buyer opening it is asked to contact you instead. Generate a new link to share the current one.",
  closed:
    "This offer is closed, so a buyer opening the link is asked to contact you instead of seeing the specification.",
};

function shareLinkKey(offerId: string) {
  return ["offer-specification-share", offerId] as const;
}

export function SpecificationShareDialog({
  collectionId,
  offerId,
  onClose,
}: {
  collectionId: string;
  offerId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<OfferSpecificationShareState>({
    queryKey: shareLinkKey(offerId),
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/offers/${offerId}/specification/share`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as OfferSpecificationShareState;
    },
  });
  const share = data?.link ?? null;
  // The language chosen here, until which the selector shows the link's — or, with no link, the
  // offer's own.
  const [chosen, setChosen] = useState<string | null>(null);
  const language = chosen ?? share?.language ?? data?.offerLanguage ?? null;
  const newLanguage = !!share && language !== share.language;

  // The address of a link minted in this dialog, on screen before the refetch lands.
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const shownError = error ?? (isError ? "Could not read the link. Please try again." : undefined);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link =
    minted ??
    (share?.address.readable ? `${origin}${offerSpecificationSharePath(share.address.token)}` : null);
  const unreadable = !link && share && !share.address.readable ? share.address.reason : null;

  function mint() {
    setError(undefined);
    startTransition(async () => {
      const result = await createOfferSpecificationShareLinkAction(offerId, language);
      if (result.status === "success") {
        setMinted(`${window.location.origin}${offerSpecificationSharePath(result.token)}`);
        setConfirmRegenerate(false);
        setCopied(false);
        await queryClient.invalidateQueries({ queryKey: shareLinkKey(offerId) });
        setChosen(null);
      } else setError(result.message);
    });
  }

  function revoke() {
    setError(undefined);
    startTransition(async () => {
      const result = await revokeOfferSpecificationShareLinkAction(offerId);
      if (result.status === "success") {
        await queryClient.invalidateQueries({ queryKey: shareLinkKey(offerId) });
        onClose();
      } else setError(result.message);
    });
  }

  const hasLink = !!share || !!minted;

  return (
    <DialogShell title="Share specification" onClose={onClose} maxWidth="34rem">
      <DialogBody>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <p style={META}>
            A link a buyer opens without an account: this offer&apos;s specification as it is now,
            in the language you choose, and nothing else from your collection. If the
            specification changes or the offer closes, the link asks the buyer to contact you instead.
          </p>

          {data && (
            <SpecificationLanguageSelect
              id="specification-share-language"
              value={language}
              offerLanguage={data.offerLanguage}
              languages={data.languages}
              disabled={isPending}
              onChange={(next) => {
                setChosen(next);
                // Another language is another link.
                if (share && next !== share.language) setConfirmRegenerate(true);
              }}
            />
          )}

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

          <ShareLinkVisitsLine
            collectionId={collectionId}
            kind="offer_specification"
            subjectId={offerId}
            createdAt={share?.createdAt ?? null}
          />

          {share && !minted && share.standing !== "current" && (
            <p style={{ ...META, color: "var(--color-warning)" }}>{STANDING_MESSAGE[share.standing]}</p>
          )}

          {confirmRegenerate && (
            <p style={{ ...META, color: "var(--color-warning)" }}>
              {newLanguage && share?.language && language
                ? `This link is in ${languageLabel(share.language)}. A link in ${languageLabel(language)} is a new link: it stops the old one working, and anyone holding it will need the new address.`
                : "Generating a new link stops the old one working. Anyone holding it will need the new address."}
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
        disabled={isPending || isLoading}
        cancelDisabled={isPending}
        cancelLabel={hasLink && !confirmRegenerate ? "Close" : "Cancel"}
        error={shownError}
        onCancel={onClose}
        onAction={!hasLink || confirmRegenerate ? mint : onClose}
        leading={
          share && !confirmRegenerate ? (
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
    </DialogShell>
  );
}
