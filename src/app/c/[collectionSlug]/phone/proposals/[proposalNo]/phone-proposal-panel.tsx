"use client";

import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PhoneProposal } from "@/lib/phone-proposals";
import {
  isShareDismissed,
  phoneLotCountText,
  phoneProposalShareText,
  phoneShareMarksSent,
} from "@/lib/phone-proposal-rules";
import { proposalMoveRefusal } from "@/lib/proposal-rules";
import { hasProposalDocumentLabels, proposalSharePath } from "@/lib/proposal-document-rules";
import { languageLabel } from "@/lib/languages";
import { phoneOfferPath } from "@/lib/phone";
import { DialogError } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { THUMB_OBJECT_FIT } from "@/app/photo-viewer";
import { PHONE_TAP_TARGET, phoneButton, phoneRow } from "@/app/phone-screen";
import { useToast } from "@/app/toast-provider";
import { OfferStateChip } from "@/app/c/[collectionSlug]/offers/offer-badges";
import { useInvalidateOffers } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { formatRelative } from "@/app/c/[collectionSlug]/auctions/auction-format";
import {
  BuyerPickedChip,
  LotPickChip,
  ProposalStatusChip,
  proposalTotalText,
} from "@/app/c/[collectionSlug]/offers/proposals/proposal-parts";
import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { PhoneProposalMoves } from "./phone-proposal-moves";

/**
 * A proposal's phone screen body (#2625): who it is for, where it stands, its lots — and handing it to
 * the buyer, who is reached through a phone app, mostly Messenger. Once the buyer has answered, the
 * desk's moves close it — convert to a sale, reopen, decline (#2627, `PhoneProposalMoves`).
 *
 * **Share** opens the phone's own share menu with the message and the live link in one text, so the
 * collector picks the app; a share that went through marks a Preparing proposal Sent — the one way the
 * phone differs from the desk, where only *Mark sent* does (#2329; settled with the collector on
 * 2026-11-21). **Copy message** and **Copy link** are the desk card's two copies and change nothing, so
 * *Mark sent* stands beside them for a proposal handed over that way. A proposal with no link yet gets
 * one the first time it is shared or its link copied — making a link changes nothing either.
 *
 * The language choice is the desk card's (#2603): saved on the contact, and the message, the document
 * and the link read again in it. Every write is the desk's own server action, so the server refuses in
 * the desk's words; afterwards the page is read again from the server and the offer lists marked stale.
 */
export function PhoneProposalPanel({
  collectionId,
  collectionSlug,
  proposal,
}: {
  collectionId: string;
  collectionSlug: string;
  proposal: PhoneProposal;
}) {
  return (
    <>
      <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h2 style={TITLE}>{proposal.contact.name}</h2>
          <ProposalStatusChip status={proposal.status} />
        </div>
        <div style={{ fontSize: "1.125rem", fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
          {proposalTotalText(proposal.total, proposal.currency, proposal.unpriced)}
        </div>
        <div style={META}>
          {phoneLotCountText(proposal.lots.length)}
          {proposal.sentOn && ` · ${proposal.status === "preparing" ? "last sent" : "sent"} ${proposal.sentOn}`}
        </div>
        {proposal.post && (
          <div style={META}>
            Made from Facebook post #{proposal.post.postNo}
            {proposal.post.title ? ` · ${proposal.post.title}` : ""} · {proposal.post.groupName}
          </div>
        )}
        {proposal.sale && (
          <div style={META}>
            Sold as sale #{proposal.sale.saleNo} on {proposal.sale.platformName}
          </div>
        )}
        {/* What the buyer ticked on the live page, timed from their last change — the desk's (#2628). */}
        {proposal.buyerPicks && (
          <div>
            <BuyerPickedChip
              count={proposal.buyerPicks.count}
              suffix={proposal.buyerPicks.changedAt ? formatRelative(proposal.buyerPicks.changedAt, new Date()) : undefined}
            />
          </div>
        )}
      </section>

      {proposal.message && (
        <PhoneProposalHandover collectionId={collectionId} proposal={proposal} message={proposal.message} />
      )}

      <PhoneProposalMoves collectionId={collectionId} collectionSlug={collectionSlug} proposal={proposal} />

      <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <h3 style={HEADING}>Lots</h3>
        {proposal.lots.length === 0 ? (
          <p style={NOTE}>No lots yet — they are added at the desk.</p>
        ) : (
          <nav style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {proposal.lots.map((lot) => (
              <Link
                key={lot.offerId}
                href={phoneOfferPath(collectionSlug, lot.offerId)}
                style={{ ...phoneRow, alignItems: "flex-start", padding: "0.625rem" }}
              >
                <LotPicture collectionId={collectionId} picture={lot.picture} alt={`Lot ${lot.lotNo}`} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.875rem", fontWeight: 400, color: "var(--color-text-secondary)" }}>
                    Lot {lot.lotNo}
                  </span>
                  <span style={{ overflowWrap: "anywhere", lineHeight: 1.35 }}>{lot.title}</span>
                  <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {lot.price ? `${lot.price} ${lot.currency}` : "No price"}
                    </span>
                    <OfferStateChip state={lot.state} />
                    {lot.pick && <LotPickChip pick={lot.pick} />}
                  </span>
                </span>
              </Link>
            ))}
          </nav>
        )}
      </section>
    </>
  );
}

/** The lot's picture, fitted never cropped; its first copy's dashed, as the desk's row draws it. */
function LotPicture({
  collectionId,
  picture,
  alt,
}: {
  collectionId: string;
  picture: PhoneProposal["lots"][number]["picture"];
  alt: string;
}) {
  const frame: CSSProperties = {
    flexShrink: 0,
    width: "4rem",
    height: "4rem",
    borderRadius: "0.375rem",
    border: picture?.copy ? "1px dashed var(--color-border-strong)" : "1px solid var(--color-border)",
    background: "var(--color-bg-subtle)",
    overflow: "hidden",
  };
  if (!picture) return <span style={frame} aria-hidden />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by our own photo routes
    <img
      src={`/api/collections/${collectionId}/photos/${picture.photoId}/thumb`}
      alt={picture.copy ? `${alt} — its first copy` : alt}
      loading="lazy"
      style={{ ...frame, display: "block", objectFit: THUMB_OBJECT_FIT }}
    />
  );
}

/** Handing the proposal over: the language, the message, and Share / Copy message / Copy link. */
function PhoneProposalHandover({
  collectionId,
  proposal,
  message,
}: {
  collectionId: string;
  proposal: PhoneProposal;
  message: NonNullable<PhoneProposal["message"]>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateOffers();
  const hydrated = useHydrated();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  // A link made here, in use before the page is read again.
  const [minted, setMinted] = useState<string | null>(null);

  const token = minted ?? (proposal.link && "token" in proposal.link ? proposal.link.token : null);
  const unreadable = !token && proposal.link !== null;
  const canShare = hydrated && typeof navigator !== "undefined" && typeof navigator.share === "function";
  const sendRefusal = proposalMoveRefusal(proposal.status, "send", proposal.lots.length);
  const label = `Proposal #${proposal.proposalNo}`;

  function reread() {
    void invalidateAll(collectionId);
    router.refresh();
  }

  /** The live link's address — made now when the proposal has none. Null, with the reason said, when
   *  there is none to hand over. */
  async function linkAddress(): Promise<string | null> {
    if (token) return `${window.location.origin}${proposalSharePath(token)}`;
    if (unreadable) {
      setError("The link's address cannot be read here. Make a new link at the desk — Print or share… → New link.");
      return null;
    }
    const { createProposalShareLinkAction } = await import("@/app/actions/proposals");
    const result = await createProposalShareLinkAction(proposal.proposalId);
    if (result.status === "error") {
      setError(result.message);
      return null;
    }
    setMinted(result.token);
    return `${window.location.origin}${proposalSharePath(result.token)}`;
  }

  async function markSent(): Promise<string | null> {
    const { moveProposalAction } = await import("@/app/actions/proposals");
    const result = await moveProposalAction(proposal.proposalId, "send");
    return result.status === "error" ? result.message : null;
  }

  function share() {
    setError(undefined);
    startTransition(async () => {
      const link = await linkAddress();
      if (!link) return;
      try {
        await navigator.share({ text: phoneProposalShareText(message.text, link) });
      } catch (err) {
        if (!isShareDismissed(err)) {
          // Most often the menu would not open once a new link had been made first: the tap is spent.
          setError("The share menu did not open. Tap Share again, or copy the message and the link.");
        }
        return;
      }
      if (phoneShareMarksSent(proposal.status, proposal.lots.length)) {
        const refused = await markSent();
        if (refused) setError(`Shared, but not marked sent: ${refused}`);
        else toast({ message: `${label} shared and marked sent` });
      } else toast({ message: `${label} shared` });
      reread();
    });
  }

  function copy(what: "message" | "link") {
    setError(undefined);
    startTransition(async () => {
      const text = what === "message" ? message.text : await linkAddress();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast({ message: what === "message" ? "Message copied" : "Link copied" });
      } catch {
        setError(`Could not copy — the browser blocked the clipboard. Tap Copy ${what} again.`);
      }
    });
  }

  function sendNow() {
    setError(undefined);
    startTransition(async () => {
      const refused = await markSent();
      if (refused) setError(refused);
      else {
        toast({ message: `${label} marked sent` });
        reread();
      }
    });
  }

  function chooseLanguage(code: string) {
    setError(undefined);
    startTransition(async () => {
      const { setProposalLanguageAction } = await import("@/app/actions/proposals");
      const result = await setProposalLanguageAction(proposal.proposalId, code);
      if (result.status === "error") setError(result.message);
      else {
        toast({ message: `${languageLabel(code)} saved on ${proposal.contact.name} for their next proposal too` });
        router.refresh();
      }
    });
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }} aria-label="For the buyer">
      <h3 style={HEADING}>For the buyer</h3>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem", fontSize: "0.9375rem" }}>
        <span style={{ color: "var(--color-text-secondary)" }}>Language</span>
        <select
          value={message.language ?? ""}
          disabled={isPending || message.languages.length === 0}
          onChange={(e) => chooseLanguage(e.target.value)}
          style={SELECT}
        >
          {message.language === null && <option value="">—</option>}
          {message.languages.map((code) => (
            <option key={code} value={code}>
              {languageLabel(code)}
            </option>
          ))}
        </select>
      </label>
      {message.language !== null && !hasProposalDocumentLabels(message.language) && (
        <p style={{ ...NOTE, color: "var(--color-warning)" }}>
          The link&apos;s headings and notices have no {languageLabel(message.language)} words, so they show in English.
        </p>
      )}

      {message.text ? (
        <pre style={MESSAGE}>{message.text}</pre>
      ) : (
        <p style={NOTE}>
          No message: {proposal.platformName} has no proposal message template
          {message.language ? ` in ${languageLabel(message.language)}` : ""}. It is written at the desk, in Settings →{" "}
          {proposal.platformName}. Sharing sends the link alone.
        </p>
      )}

      <DialogError>{error}</DialogError>

      {canShare ? (
        <button type="button" disabled={isPending} onClick={share} style={SHARE_BUTTON}>
          <Icon name="share" />
          {isPending ? "Working…" : "Share"}
        </button>
      ) : (
        hydrated && <p style={NOTE}>This browser has no share menu — copy the message and the link instead.</p>
      )}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {message.text && (
          <button type="button" disabled={isPending} onClick={() => copy("message")} style={{ ...BUTTON, flex: 1 }}>
            <Icon name="copy" />
            Copy message
          </button>
        )}
        <button type="button" disabled={isPending} onClick={() => copy("link")} style={{ ...BUTTON, flex: 1 }}>
          <Icon name="link" />
          Copy link
        </button>
      </div>
      {proposal.status === "preparing" && (
        <>
          <button type="button" disabled={isPending || sendRefusal !== null} onClick={sendNow} style={BUTTON}>
            <Icon name="check" />
            Mark sent
          </button>
          <p style={NOTE}>
            {sendRefusal ?? "Sharing marks it sent. Copying does not — mark it sent once the buyer has it."}
          </p>
        </>
      )}
    </section>
  );
}

const TITLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  margin: 0,
  fontSize: "1.125rem",
  fontWeight: 600,
  lineHeight: 1.35,
  color: "var(--color-text-primary)",
  overflowWrap: "anywhere",
};

const HEADING: CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-secondary)",
};

const META: CSSProperties = { fontSize: "0.9375rem", color: "var(--color-text-secondary)" };

const NOTE: CSSProperties = { margin: 0, fontSize: "0.875rem", lineHeight: 1.45, color: "var(--color-text-muted)" };

const MESSAGE: CSSProperties = {
  margin: 0,
  padding: "0.625rem 0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  fontFamily: "inherit",
  fontSize: "0.9375rem",
  lineHeight: 1.5,
  color: "var(--color-text-primary)",
  maxHeight: "14rem",
  overflowY: "auto",
};

/** A thumb's select: the phone's tap target, not the desk's form height (`formControl`). */
const SELECT: CSSProperties = {
  width: "100%",
  height: PHONE_TAP_TARGET,
  padding: "0 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "1rem",
  boxSizing: "border-box",
};

const BUTTON: CSSProperties = {
  ...phoneButton,
  gap: "0.5rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-strong)",
};

const SHARE_BUTTON: CSSProperties = {
  ...phoneButton,
  gap: "0.5rem",
  background: "var(--color-action-primary)",
  color: "#fff",
  fontWeight: 600,
};
