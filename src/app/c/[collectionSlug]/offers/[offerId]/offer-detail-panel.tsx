"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { InlineText } from "@/app/c/[collectionSlug]/shared/inline-text";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  OfferStateChip,
  NeedsActionChip,
  InActiveBiddingChip,
  ListingTypeChip,
  PlatformSaleChip,
} from "../offer-badges";
import {
  useOfferDetail,
  useOfferCopies,
  useOfferTranslationGaps,
  useInvalidateOffers,
} from "../use-offers-query";
import { TranslationGapsPanel } from "@/app/c/[collectionSlug]/shared/translation-gaps";
import { DuplicateOfferDialog } from "../duplicate-offer-dialog";
import { SellOfferFlowDialog } from "../sell-offer-flow-dialog";
import { ActivateOfferDialog } from "../activate-offer-dialog";
import { LISTING_ELEMENT_ID, useAssistantHandoff, useAssistantPresence } from "../assistant-handoff";
import { AssistantOutcome, ListViaAssistantButton } from "../assistant-listing";
import { PublishToAllegroButton } from "../allegro/publish-to-allegro";
import { ComposeSetDialog } from "./compose-set-dialog";
import { OfferPhotosCard } from "./offer-photos-card";
import { OfferPlatformItemsCard } from "./offer-platform-items-card";
import { OfferAllegroCard } from "./offer-allegro-card";
import { OfferSetsView } from "./offer-sets-view";
import { useTitleLanguages } from "@/app/c/[collectionSlug]/shared/use-title-languages";
import { OfferListingText, EditedChip } from "./offer-listing-text";
import { CopyButton } from "@/app/c/[collectionSlug]/shared/copy-button";
import { formatInstant } from "@/app/c/[collectionSlug]/auctions/auction-format";
import { languageLabel, normalizeLanguage } from "@/lib/languages";
import {
  isAuctionListing,
  isTerminalState,
  manualTransitions,
  quickAdvanceTarget,
  priceLabel,
  pricingReadyFor,
  requiresSets,
  type ManualOfferTarget,
} from "@/lib/offer-rules";
import type { OfferDetailSet, OfferTextField } from "@/lib/offers";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { IssueHeader } from "@/lib/issues";

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

/** The same card the listing texts sit in, for the translation-gaps panel below them. */
const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem 1.5rem 1.25rem",
};

const BTN: React.CSSProperties = {
  padding: "0.375rem 0.875rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

const TRANSITION_LABEL: Record<string, { label: string; icon: string }> = {
  ready: { label: "Mark ready", icon: "✓" },
  preparing: { label: "Back to preparing", icon: "↩" },
  active: { label: "Resume", icon: "▶" },
  paused: { label: "Pause", icon: "⏸" },
  withdrawn: { label: "Withdraw", icon: "⇤" },
};

/** Beside the quick-advance button, and deliberately quieter than it: the Assistant fills the
 *  platform's form, while Activate is the step that changes what this collection records. */
const ASSISTANT_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const QUICK_ADVANCE_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-accent)",
  color: "var(--color-accent)",
  background: "var(--color-accent-soft)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** Label + icon for the one-click advance to `to` — publishing a `ready` offer reads "Activate";
 * marking a `preparing` one ready keeps the plain transition label. */
function advanceLabel(to: ManualOfferTarget): { label: string; icon: string } {
  return to === "active" ? { label: "Activate", icon: "▲" } : TRANSITION_LABEL[to];
}

interface OfferDetailPanelProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  offerId: string;
  /** Server-computed "today", for the quick-sell flow's new-sale step (#390) — the same value the
   * Offers list passes, so a sale started from either place defaults to the same date. */
  today: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  issueHeaderById: Record<string, IssueHeader>;
}

/** The generated texts the ⋮ menu offers a "regenerate in <Language>" entry for (#297), in the order
 * they read on screen. Each field's own ↻ handles the platform's own language. */
const REGENERATABLE_TEXTS: readonly { field: OfferTextField; label: string }[] = [
  { field: "name", label: "title" },
  { field: "description", label: "description" },
  { field: "privateNote", label: "private note" },
];

export function OfferDetailPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  offerId,
  today,
  areas,
  locations,
  issueHeaderById,
}: OfferDetailPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const skippedParam = Number(searchParams.get("skipped")) || 0;
  const { data: offer, isLoading } = useOfferDetail(collectionId, offerId);
  const { data: copies = [], isLoading: copiesLoading } = useOfferCopies(collectionId, offerId, true);
  const { invalidateAll } = useInvalidateOffers();
  const [composing, setComposing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  // Quick-sell (#390): the Offer list's own flow (#225), opened from here so recording a sale does
  // not mean navigating back to the list first. The same flow sells a **single set** (#473) when it
  // was opened from one — `sellingSet` is the set it is scoped to, null for the whole offer.
  const [selling, setSelling] = useState(false);
  const [sellingSet, setSellingSet] = useState<OfferDetailSet | null>(null);
  // Activation asks for the listing URL when the offer has none (#399) — the bulk workspace's own
  // publish step (#322), reached from here.
  const [activating, setActivating] = useState(false);
  const [removeSet, setRemoveSet] = useState<OfferDetailSet | null>(null);
  const [confirm, setConfirm] = useState<"withdraw" | "delete" | null>(null);
  // A `?skipped=N` note (#200) lands here right after a duplicate; dismissible, and cleared from the
  // URL so a refresh doesn't resurrect it.
  const [skippedNote, setSkippedNote] = useState(skippedParam);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  // The Assistant handoff (#414), exactly as the bulk workspace drives it (#407): the hidden node
  // is this page's own, and the extension answers on it.
  const assistantPresent = useAssistantPresence();
  // Submitting the filled form is what takes this offer live (#412) — the header then shows a
  // different state, a listing date and a URL, so the screen is re-read exactly as it is after its
  // own Activate. The report strip stays: it is the record of what just happened.
  // Arriving here **is** the acknowledgement of the app's own "I marked this in active bidding"
  // notice (#481): the notification centre pointed at this screen, so asking for a further click to
  // confirm having read it would be a click for nothing. Fired once per offer — the ref guards a
  // re-render or a refetch from repeating it — and outside the pending transition, since it is not
  // an edit the collector is waiting on and must not grey the screen out.
  const acknowledged = useRef<string | null>(null);
  const pendingBiddingNotice = offer?.biddingNoticeAt ?? null;
  useEffect(() => {
    if (!pendingBiddingNotice || acknowledged.current === offerId) return;
    acknowledged.current = offerId;
    void (async () => {
      const { acknowledgeOfferBiddingNoticeAction } = await import("@/app/actions/offers");
      const result = await acknowledgeOfferBiddingNoticeAction(offerId);
      // Silent on failure by design: the notice is still there, the next visit tries again, and an
      // error banner about a notification would be noise on a screen the collector opened to work.
      if (result.status === "success") invalidateAll(collectionId);
    })();
  }, [pendingBiddingNotice, offerId, collectionId, invalidateAll]);

  const onListingActivated = useCallback(() => invalidateAll(collectionId), [collectionId, invalidateAll]);
  const { handoff, start: startHandoff, dismiss: dismissHandoff, nodeRef } = useAssistantHandoff(
    collectionId,
    { onActivated: onListingActivated }
  );
  const handoffRunning = handoff?.state === "loading" || handoff?.state === "running";

  // The languages this collection lists in (#293), for regenerating the title in one of them (#297).
  const { titleLanguages, defaultLanguage } = useTitleLanguages(collectionId);
  // Every language *other* than the platform's own — the plain "Regenerate title" covers that one.
  // `null` stands for the collection's default language. Empty for a single-language collection.
  const platformLanguage = normalizeLanguage(offer?.platformTitleLanguage) ?? defaultLanguage;
  const otherTitleLanguages: (string | null)[] =
    titleLanguages.length > 0
      ? [null, ...titleLanguages].filter((code) => (code ?? defaultLanguage) !== platformLanguage)
      : [];
  // Translations missing behind the generated texts (#299). Only worth asking for once the
  // collection lists in a second language at all.
  const { data: gapData } = useOfferTranslationGaps(collectionId, offerId, titleLanguages.length > 0);
  const gapLanguage = gapData?.language ?? null;
  const gaps = gapData?.gaps ?? [];

  if (isLoading || !offer) {
    return (
      <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
        {isLoading ? "Loading offer…" : "Offer not found."}
      </div>
    );
  }

  const editable = !isTerminalState(offer.state);

  // One-click advance through the linear part of the lifecycle (#255), mirroring the offer row.
  // Only the unambiguous forward step is offered; a target that lists something needs ≥1 set.
  const advanceTo = editable ? quickAdvanceTarget(offer.state) : null;
  // Marking it ready is gated on the listing preconditions (#418) and on the listing photos being
  // generated and current (#311): a fault is fixed while the offer is still being assembled rather
  // than in the middle of a posting session. Unlike a missing set or price, each of these is fixed
  // elsewhere — another screen, or the photos card below — so the button stays put and is **disabled
  // with its reasons** (#273) instead of quietly disappearing.
  const pricedForAdvance =
    advanceTo === null ||
    pricingReadyFor(offer.listingType, advanceTo, offer.price, offer.startingPrice);
  const advanceReady =
    advanceTo !== null && (!requiresSets(advanceTo) || offer.sets.length > 0) && pricedForAdvance;
  const readyBlockers = advanceReady && advanceTo === "ready" ? offer.readyBlockers : [];
  const canAdvance = advanceReady && readyBlockers.length === 0;
  // An offer that only lacks a price (#336): the price field is right here, so say what is missing
  // instead of silently withholding the advance button. On an auction what is missing is the
  // **starting** price (#449) — the current one follows from it while nobody has bid — so the line
  // names that field instead.
  const blockedOnPrice = advanceTo !== null && !pricedForAdvance && offer.sets.length > 0;
  const missingPriceLabel = isAuctionListing(offer.listingType) ? "a starting price" : "a price";
  // Going live is a publication (#399): the platform hands back a listing URL and this is the moment
  // it is in the clipboard, so activating asks for it exactly as the bulk listing workspace does
  // (#322) — but only while the offer carries none. One that already has a URL has nothing to hand
  // over, and the header's own field takes a correction.
  const needsUrlToActivate = offer.state === "ready" && !offer.url;

  /** Patch a single header field in place, then refresh. */
  function patch(
    field: "price" | "startingPrice" | "url" | "descriptionFormat" | OfferTextField,
    value: string
  ) {
    setActionError(undefined);
    startTransition(async () => {
      const { patchOfferAction } = await import("@/app/actions/offers");
      const result = await patchOfferAction(offerId, field, value);
      if (result.status === "success") invalidateAll(collectionId);
      else setActionError(result.message);
    });
  }

  /** Regenerate one generated listing text — title (#210), description (#266) or private note
   * (#267) — from the platform's template over the current composition, overwriting any manual edit.
   * `language` (#297) regenerates in a language other than the platform's — a one-off; nothing about
   * the choice is stored. */
  function regenerate(field: OfferTextField, language?: string | null) {
    setActionError(undefined);
    startTransition(async () => {
      const { regenerateOfferTextAction } = await import("@/app/actions/offers");
      const result = await regenerateOfferTextAction(offerId, field, language);
      if (result.status === "success") invalidateAll(collectionId);
      else setActionError(result.message);
    });
  }

  function setBidding(value: boolean) {
    setActionError(undefined);
    startTransition(async () => {
      const { setOfferInActiveBiddingAction } = await import("@/app/actions/offers");
      const result = await setOfferInActiveBiddingAction(offerId, value);
      if (result.status === "success") invalidateAll(collectionId);
      else setActionError(result.message);
    });
  }

  function setState(next: ManualOfferTarget) {
    if (next === "withdrawn") {
      setConfirm("withdraw");
      return;
    }
    if (next === "active" && needsUrlToActivate) {
      setActivating(true);
      return;
    }
    setActionError(undefined);
    startTransition(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(offerId, next);
      if (result.status === "success") invalidateAll(collectionId);
      else setActionError(result.message);
    });
  }

  /** Go live with the URL the platform gave back (#399): `publishOffer` transitions first and writes
   * the URL after, so a refused activation — a lost set, a missing price — leaves no listing link
   * behind on an offer that never went live. A blank URL is a normal answer. */
  function publish(url: string) {
    setActionError(undefined);
    startTransition(async () => {
      const { publishOfferAction } = await import("@/app/actions/offers");
      const result = await publishOfferAction(offerId, url);
      if (result.status === "success") {
        setActivating(false);
        // Whatever the Assistant reported described the form, and the form has now been posted.
        dismissHandoff();
        invalidateAll(collectionId);
      } else setActionError(result.message);
    });
  }

  const menuActions: RowAction[] = [
    ...manualTransitions(offer.state)
      .filter((s): s is ManualOfferTarget => s !== "sold")
      .map((s) => {
        // Publishing a ready offer reads "Activate"; resuming a paused one keeps "Resume".
        const activating = offer.state === "ready" && s === "active";
        return {
          key: s,
          label: activating ? "Activate" : TRANSITION_LABEL[s].label,
          icon: activating ? "▲" : TRANSITION_LABEL[s].icon,
          danger: s === "withdrawn",
          onSelect: () => setState(s),
        };
      }),
    { key: "regenerate", label: "Regenerate title", icon: "↻", onSelect: () => regenerate("name") },
    // One entry per generated text × *other* language the collection lists in (#297/#266/#267) —
    // each field's own ↻ on the screen already covers the platform's own language, and a field the
    // platform has no template for is skipped. Absent for a single-language collection.
    ...otherTitleLanguages.flatMap((code) =>
      REGENERATABLE_TEXTS.filter((t) => offer.regeneratable[t.field]).map(
        (t): RowAction => ({
          key: `regenerate-${t.field}-${code ?? "default"}`,
          label: `Regenerate ${t.label} in ${languageLabel(code ?? defaultLanguage)}`,
          icon: "↻",
          onSelect: () => regenerate(t.field, code),
        })
      )
    ),
    ...(offer.inActiveBidding
      ? [{ key: "clear-bidding", label: "Clear active bidding", icon: "🔨", onSelect: () => setBidding(false) } as RowAction]
      : offer.state === "active"
        ? [{ key: "mark-bidding", label: "Mark in active bidding", icon: "🔨", onSelect: () => setBidding(true) } as RowAction]
        : []),
    // Same precondition as the list's entry: a terminal offer has nothing left to sell, and an
    // offer holding no set has nothing to put on a sale line.
    ...(editable && offer.sets.length > 0
      ? [{ key: "sell", label: "Sell", icon: "💰", onSelect: () => setSelling(true) } as RowAction]
      : []),
    { key: "duplicate", label: "List on another platform", icon: "⧉", onSelect: () => setDuplicating(true) },
    { key: "delete", label: "Delete", icon: "✕", danger: true, separatorBefore: true, onSelect: () => setConfirm("delete") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Skipped-copies note after a duplicate (#200): some copies had already sold and were left
          out of this clone. */}
      {skippedNote > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            background: "var(--color-bg-page)",
            padding: "0.625rem 1rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary)",
          }}
        >
          <span style={{ flex: 1 }}>
            {skippedNote} cop{skippedNote === 1 ? "y" : "ies"} that had already sold elsewhere{" "}
            {skippedNote === 1 ? "was" : "were"} skipped when copying this offer.
          </span>
          <button
            type="button"
            onClick={() => setSkippedNote(0)}
            aria-label="Dismiss"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: "1rem", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Header summary card */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          background: "var(--color-bg-elevated)",
          padding: "1.25rem 1.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          {/* Listing title (#209): the offer's own editable name, defaulting to the derived label
              when never generated. A pencil edits it in place; the ⋮ menu regenerates it from the
              platform's template.
              Editing starts from what is on screen — the derived label included (#363). An empty
              box under a visible title reads as "the title is gone", and retyping a label the
              collector can see is busywork; leaving it untouched still saves nothing, since
              InlineText only commits a changed draft, so the offer stays on its derived label
              until the text is actually edited. */}
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            <InlineText
              value={offer.name ?? offer.label}
              placeholder="Listing title"
              display={<span style={{ cursor: "text" }}>{offer.name ?? offer.label}</span>}
              editable
              editControl
              editAriaLabel="Edit listing title"
              isPending={isPending}
              inputType="text"
              onSave={(v) => patch("name", v)}
            />
          </h2>
          {/* Copy the title as it will be pasted into the platform's form (#327). It copies what is
              actually stored, so an offer still on its derived label has nothing to hand over and
              the button says so rather than copying a label the platform never sees. */}
          {offer.edited.name && <EditedChip what="title" />}
          <CopyButton value={offer.name} label="listing title" />
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>on {offer.platformName}</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <OfferStateChip state={offer.state} />
            {(canAdvance || readyBlockers.length > 0) && advanceTo && (() => {
              const { label, icon } = advanceLabel(advanceTo);
              const blocked = readyBlockers.length > 0;
              return (
                <Tooltip
                  content={
                    blocked ? (
                      // One line per reason, never a count: each is fixed somewhere different (#406,
                      // #311) — a catalogue match on another screen, a photo run on the card below.
                      <span style={{ display: "grid", gap: "0.25rem", maxWidth: "22rem" }}>
                        <strong>This offer is not ready to be listed on {offer.platformName} yet:</strong>
                        {readyBlockers.map((b) => (
                          <span key={b.code}>{b.message}</span>
                        ))}
                      </span>
                    ) : (
                      label
                    )
                  }
                >
                  <button
                    type="button"
                    disabled={isPending || blocked}
                    onClick={() => setState(advanceTo)}
                    aria-label={label}
                    style={{ ...QUICK_ADVANCE_BTN, ...(blocked ? { opacity: 0.55, cursor: "default" } : null) }}
                  >
                    <span aria-hidden>{icon}</span>
                    {label}
                  </button>
                </Tooltip>
              );
            })()}
            {/* The same handoff the bulk workspace offers (#407/#414). A single listing is routinely
                posted from here rather than from a batch, and a step offered on one screen only is
                the step that gets skipped on the other — the same reasoning that made activation ask
                for the URL in both places (#399). Only on a Ready offer: anything else has nothing
                to post, and the preconditions say so themselves. */}
            {offer.state === "ready" && (
              <ListViaAssistantButton
                platformModule={offer.platformModule}
                present={assistantPresent}
                blockerCount={offer.listingBlockers.length}
                busy={false}
                running={handoffRunning}
                disabled={isPending}
                style={ASSISTANT_BTN}
                onStart={() => {
                  setActionError(undefined);
                  void startHandoff(offerId);
                }}
              />
            )}
            {/* The API path (#477), which is the same step for a marketplace this instance holds a
                grant for: no form to find and no URL to paste back. It renders only where the
                platform is the one marked as Allegro, and it is the same control before and after —
                a draft published for a last look is activated from here too. */}
            <PublishToAllegroButton
              collectionId={collectionId}
              collectionSlug={collectionSlug}
              offerId={offerId}
              offerLabel={offer.name ?? offer.label}
              platformModule={offer.platformModule}
              state={offer.state}
              publication={offer.allegroPublication}
              disabled={isPending}
              style={ASSISTANT_BTN}
              onDone={() => invalidateAll(collectionId)}
            />
            {offer.needsAction && (
              <NeedsActionChip soldCopyCount={offer.sets.filter((s) => s.needsAction).length} />
            )}
            {/* The list's own flag, carried onto the screen the list opens (#505). It is the
                strongest thing an offer can be carrying — an order the marketplace has taken — and
                a chip seen in passing that is then absent from the offer's own page reads as
                something already dealt with. Ahead of the auction chips for the same reason: it
                outranks both a bid that may still be outbid and an auction still to be resolved. */}
            {offer.platformSale && (
              <PlatformSaleChip
                paymentStatus={offer.platformSale.paymentStatus}
                orderId={offer.platformSale.orderId}
                platformName={offer.platformName}
              />
            )}
            {/* An auction says how to read the price beside it (#449); "in bidding" (#215) says
                somebody has actually bid. Two different facts, so two chips. */}
            <ListingTypeChip listingType={offer.listingType} />
            {offer.inActiveBidding && <InActiveBiddingChip />}
            <RowActionsMenu actions={menuActions} ariaLabel="Offer actions" />
          </span>
        </div>

        <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.6rem", flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* Currency — inherited from the platform and locked (#196), shown as a read-only chip. */}
          <Tooltip content="Inherited from the platform — set it on the platform's contact">
            <span style={CHIP}>{offer.currency}</span>
          </Tooltip>

          {/* Listing date (#257): when the listing went live, captured at creation. Read-only here —
              editable from the offer header form. Hidden when not recorded. */}
          {offer.listingDate && (
            <Tooltip content="Listing date — when this listing went live">
              <span style={CHIP}>📅 {new Date(offer.listingDate).toISOString().slice(0, 10)}</span>
            </Tooltip>
          )}

          {/* Listing URL — editable in any state, including sold/withdrawn, for record-keeping
              (#213). When a URL is set the link opens on click and a separate pencil edits it, so
              the click-to-open never gets hijacked by editing (#214). */}
          <InlineText
            value={offer.url ?? ""}
            placeholder="Add listing URL"
            display={
              offer.url ? (
                <a
                  href={offer.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ ...CHIP, color: "var(--color-accent)", textDecoration: "none" }}
                >
                  🔗 Listing
                </a>
              ) : (
                <span style={{ ...CHIP, color: "var(--color-text-muted)", cursor: "text" }}>Add listing URL</span>
              )
            }
            editable
            editControl={!!offer.url}
            editAriaLabel="Edit listing URL"
            isPending={isPending}
            inputType="url"
            onSave={(v) => patch("url", v)}
          />

          {/* The price + its suggestion, stacked on the right so the two read as one unit. What the
              figure is *called* follows the listing type (#449) — an auction's is where the bidding
              stands, not something the seller asked for — but it is one field either way, and
              editing it in place is how a bid is refreshed (#351's pattern: committing stamps the
              check date shown below it). */}
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.15rem" }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              <Tooltip content={priceLabel(offer.listingType)} align="end">
                <InlineText
                  value={offer.price === "0.00" ? "" : offer.price}
                  placeholder={isAuctionListing(offer.listingType) ? "Record a bid" : "Set price"}
                  display={
                    offer.price === "0.00" ? (
                      <span style={{ color: "var(--color-text-muted)", fontWeight: 500, fontSize: "0.8125rem", cursor: "text" }}>
                        {/* An unbid auction is not *unpriced* — it is up at its opening figure with
                            nobody having bid, which is a different and perfectly normal thing (#449). */}
                        {isAuctionListing(offer.listingType) ? "No bids yet" : "No price yet"}
                      </span>
                    ) : (
                      <span style={{ cursor: "text" }}>{offer.price} {offer.currency}</span>
                    )
                  }
                  editable={editable}
                  isPending={isPending}
                  inputType="number"
                  suffix={offer.currency}
                  // A price is retyped whole, never amended in the middle (#329).
                  selectOnEdit
                  onSave={(v) => patch("price", v)}
                />
              </Tooltip>
            </span>
            {/* An auction's two extra facts (#449), both muted under the live figure: what it opened
                at — a record, nothing is computed from it — and when the figure was last confirmed
                against the listing. Refreshing a bid is manual by decision (ADR-0021 §8), so an
                undated one says nothing about how current it is. Auction-only: a quick buy's price
                is the seller's own and nothing moves it behind their back. */}
            {isAuctionListing(offer.listingType) && (
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: "0.375rem", fontVariantNumeric: "tabular-nums" }}>
                <Tooltip content="What this auction opened at" align="end">
                  <span>
                    <InlineText
                      value={offer.startingPrice ?? ""}
                      placeholder="Add starting price"
                      display={
                        <span style={{ cursor: "text" }}>
                          {offer.startingPrice
                            ? `from ${offer.startingPrice} ${offer.currency}`
                            : "Add starting price"}
                        </span>
                      }
                      editable={editable}
                      isPending={isPending}
                      inputType="number"
                      suffix={offer.currency}
                      selectOnEdit
                      onSave={(v) => patch("startingPrice", v)}
                    />
                  </span>
                </Tooltip>
                {/* What the platform's own sync reported (#481). It is the only way a bidder count
                    can get here — nothing types one in — so this line is also what says the figure
                    beside it, and the "In bidding" chip above, came from the marketplace rather
                    than from the collector. A flagged auction Allegro now reports no bidders on
                    still says so: that disagreement is the collector's to settle, by hand. */}
                {offer.bidderCount !== null && (
                  <Tooltip content="Reported by the platform's own sync" align="end">
                    <span>
                      · {offer.bidderCount === 0
                        ? "no bidders"
                        : `${offer.bidderCount} bidder${offer.bidderCount === 1 ? "" : "s"}`}
                    </span>
                  </Tooltip>
                )}
                {offer.priceCheckedAt && (
                  <Tooltip content="When this price was last checked against the listing" align="end">
                    <span>· checked {new Date(offer.priceCheckedAt).toISOString().slice(0, 10)}</span>
                  </Tooltip>
                )}
                {/* When the auction closes (#490) — read-only here and edited on the header form,
                    because on a connected platform it is the sync's to keep current (#481) and an
                    inline edit would invite typing over what the marketplace just said. */}
                {offer.endsAt && (
                  <Tooltip content="When this auction closes" align="end">
                    <span>· closes {formatInstant(String(offer.endsAt))}</span>
                  </Tooltip>
                )}
              </span>
            )}
            {blockedOnPrice && (
              <span style={{ fontSize: "0.75rem", color: "var(--color-warning)" }}>
                Set {missingPriceLabel} to{" "}
                {advanceTo === "active" ? "activate this offer" : "mark this offer ready"}
              </span>
            )}
            {offer.priceBase && (
              <Tooltip content={`Converted to ${offer.baseCurrency} at the current rate`} align="end">
                <span
                  style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}
                >
                  ≈ {offer.priceBase} {offer.baseCurrency}
                </span>
              </Tooltip>
            )}
            {editable && offer.suggestedPrice && (
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: "0.375rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <Tooltip content="Average catalog value per set, in this offer's currency" align="end">
                  <span>
                    💡 suggested {offer.suggestedPrice} {offer.currency}
                    {offer.suggestedUnpricedSets > 0 && ` · ${offer.suggestedUnpricedSets} set${offer.suggestedUnpricedSets === 1 ? "" : "s"} unpriced`}
                  </span>
                </Tooltip>
                {offer.price !== offer.suggestedPrice && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => patch("price", offer.suggestedPrice!)}
                    style={{
                      fontSize: "0.6875rem",
                      fontWeight: 600,
                      padding: "0.0625rem 0.375rem",
                      borderRadius: "0.375rem",
                      border: "1px solid var(--color-accent)",
                      color: "var(--color-accent)",
                      background: "var(--color-accent-soft)",
                      cursor: "pointer",
                    }}
                  >
                    Use
                  </button>
                )}
              </span>
            )}
          </div>
        </div>

        {offer.needsAction && (
          <p
            style={{
              margin: "0.75rem 0 0",
              padding: "0.625rem 0.75rem",
              borderRadius: "0.5rem",
              border: "1px solid var(--color-error-border, var(--color-border))",
              background: "var(--color-error-soft, var(--color-bg-muted))",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
            }}
          >
            <strong style={{ color: "var(--color-error)" }}>Needs action:</strong> a copy in one or
            more sets below has sold elsewhere. Update the listing on the platform, then remove the
            affected set(s) here (or withdraw the offer).
          </p>
        )}

        {/* How the Assistant's handoff went (#414), in the header the button that started it lives
            in. It publishes nothing: the form is filled but not submitted, and Activate is one line
            above. */}
        {handoff && (
          <div
            style={{
              marginTop: "0.75rem",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              overflow: "clip",
            }}
          >
            <AssistantOutcome handoff={handoff} onDismiss={dismissHandoff} />
          </div>
        )}
      </div>

      {/* Listing text (#266/#267): the offer's description and its seller-only private note, both
          generated from the platform's templates and freely editable, each with its own ↻. */}
      <OfferListingText
        offer={offer}
        isPending={isPending}
        onSave={(field, value) => patch(field, value)}
        onRegenerate={(field) => regenerate(field)}
        onFormatChange={(format) => patch("descriptionFormat", format)}
      />

      {/* Missing translations behind those texts (#299) — filled here rather than by touring
          Settings and the stamp / issue screens. Each save is an entity mutation of its own; the
          generated texts are *not* re-rendered by it, since they may have been edited by hand — the
          field's own ↻ regenerates when you want the new wording. */}
      {gaps.length > 0 && (
        <div style={CARD}>
          <TranslationGapsPanel
            collectionId={collectionId}
            language={gapLanguage}
            gaps={gaps}
            onSaved={() => invalidateAll(collectionId)}
            note={`Used by this platform's generated texts. Regenerate a text (↻) to pick up a new translation.`}
            maxHeight="14rem"
          />
        </div>
      )}

      {/* Generated listing images (#311, #314) — under the listing texts, because the texts and the
          images are the two halves of what actually goes to the platform, and this is where you leave
          the screen from. Collapsed by default: expanded it previews the whole plan and would push
          the sets far down. Photo settings live in the card's own button row (⚙) — the configuration
          is what the card renders from, so it is edited where its effect is read. */}
      <OfferPhotosCard
        collectionId={collectionId}
        offerId={offerId}
        photoConfig={offer.photoConfig}
        photoLimits={offer.platformPhotoLimits}
        platformName={offer.platformName}
        offerState={offer.state}
      />

      {/* The offer's stamps on the platform's own catalogue (#423), between the images and the sets:
          it is the last thing consulted before posting and the first place one leaves the screen
          from, and it is keyed on `stamp × condition` rather than on the copy, so it belongs beside
          the sets rather than inside them. Renders nothing for a platform with no module. */}
      <OfferPlatformItemsCard
        items={offer.platformItems}
        platformName={offer.platformName}
        offerState={offer.state}
        collectionId={collectionId}
        copies={copies}
        areas={areas}
      />

      {/* What this offer is published as on Allegro (#494) — the category, its parameter answers and
          the listing profile — beside the platform-catalogue card, for the same reason that one sits
          here: it is what is consulted while a listing is being prepared. Both listing paths read
          it, so the values are settled once, here, rather than inside whichever dialog happens to
          post. Null (and so absent) on every platform that is not Allegro. */}
      {offer.allegroListing && (
        <OfferAllegroCard
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          offerId={offerId}
          config={offer.allegroListing}
          onChanged={() => invalidateAll(collectionId)}
        />
      )}

      {/* Sets. The heading and Add set are handed to the view, which lays them out in one band with
          its own controls and the listing's figures (#378) — two separately-rendered rows aligned to
          nothing in particular and left the section's vertical rhythm broken. */}
      <OfferSetsView
        collectionId={collectionId}
        collectionSlug={collectionSlug}
        offerId={offerId}
        sets={offer.sets}
        setsTotals={offer.setsTotals}
        heading={
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            Sets{offer.sets.length > 0 ? ` (${offer.sets.length})` : ""}
          </h3>
        }
        primaryAction={
          editable ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setComposing(true)}
              style={{
                ...BTN,
                color: "#fff",
                fontWeight: 600,
                background: "var(--color-action-primary)",
                border: "none",
              }}
            >
              Add set
            </button>
          ) : undefined
        }
        copies={copies}
        isLoading={copiesLoading}
        editable={editable}
        areas={areas}
        locations={locations}
        issueHeaderById={issueHeaderById}
        baseCurrency={baseCurrency}
        onRemoveSet={setRemoveSet}
        // Per-set sell (#473) — offered on the same precondition as the offer-level one: a terminal
        // offer has nothing left to sell, whichever set is asked about.
        onSellSet={editable ? setSellingSet : undefined}
      />

      {actionError && <p style={{ fontSize: "0.8125rem", color: "var(--color-error)" }}>{actionError}</p>}

      {composing && (
        <ComposeSetDialog
          collectionId={collectionId}
          offerId={offerId}
          platformId={offer.platformId}
          platformTitleLanguage={offer.platformTitleLanguage}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          onClose={() => setComposing(false)}
          onDone={() => {
            setComposing(false);
            invalidateAll(collectionId);
          }}
        />
      )}

      {duplicating && (
        <DuplicateOfferDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          baseCurrency={baseCurrency}
          source={{ id: offerId, label: offer.label, setCount: offer.sets.length, price: offer.price, currency: offer.currency }}
          onClose={() => setDuplicating(false)}
        />
      )}

      {/* Quick-sell (#390) — the Offer list's flow (#225), reached from the offer itself. One
          dialog for both scopes (#473): the header's Sell takes every set the offer still has, a
          set's own Sell takes just that one, and the transaction they record is the same. */}
      {(selling || sellingSet) && (
        <SellOfferFlowDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          baseCurrency={baseCurrency}
          today={today}
          offer={{
            id: offerId,
            name: offer.name,
            label: offer.label,
            platformId: offer.platformId,
            platformName: offer.platformName,
            price: offer.price,
            currency: offer.currency,
          }}
          set={sellingSet ? { id: sellingSet.id, label: sellingSet.label } : undefined}
          onClose={() => {
            setSelling(false);
            setSellingSet(null);
          }}
        />
      )}

      {/* The handoff itself: machine-readable, never shown. A hidden element holding JSON text
          rather than a <script> tag, so React owns it like any other node — the registration
          payload's shape (#252), read and answered by the Assistant (#409). */}
      {handoff?.payload && (
        <div ref={nodeRef} id={LISTING_ELEMENT_ID} hidden>
          {handoff.payload}
        </div>
      )}

      {/* Activation asks for the listing URL (#399), the same step the bulk listing workspace runs
          (#322) — reached from the quick-advance button and the ⋮ *Activate* entry alike. */}
      {activating && (
        <ActivateOfferDialog
          offerLabel={offer.name ?? offer.label}
          platformName={offer.platformName}
          initialUrl={offer.url}
          isPending={isPending}
          error={actionError}
          onClose={() => {
            if (isPending) return;
            setActivating(false);
            setActionError(undefined);
          }}
          onConfirm={publish}
        />
      )}

      {removeSet && (
        <ConfirmDialog
          title="Remove set"
          message="This removes the set from the offer (its copies stay in your inventory). If the set sold elsewhere, remove the matching listing on the platform too."
          actionLabel="Remove set"
          pendingLabel="Removing…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={() => !isPending && setRemoveSet(null)}
          onConfirm={() => {
            const setId = removeSet.id;
            setActionError(undefined);
            startTransition(async () => {
              const { removeOfferSetAction } = await import("@/app/actions/offers");
              const result = await removeOfferSetAction(setId);
              if (result.status === "success") {
                setRemoveSet(null);
                invalidateAll(collectionId);
              } else setActionError(result.message);
            });
          }}
        />
      )}

      {confirm === "withdraw" && (
        <ConfirmDialog
          title="Withdraw offer"
          message="This takes the listing down on the platform. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
          actionLabel="Withdraw"
          pendingLabel="Withdrawing…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={() => !isPending && setConfirm(null)}
          onConfirm={() => {
            setActionError(undefined);
            startTransition(async () => {
              const { setOfferStateAction } = await import("@/app/actions/offers");
              const result = await setOfferStateAction(offerId, "withdrawn");
              if (result.status === "success") {
                setConfirm(null);
                invalidateAll(collectionId);
              } else setActionError(result.message);
            });
          }}
        />
      )}

      {confirm === "delete" && (
        <ConfirmDialog
          title="Delete offer"
          message="This permanently removes the offer and its sets. The copies stay in your inventory. This cannot be undone."
          actionLabel="Delete offer"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={() => !isPending && setConfirm(null)}
          onConfirm={() => {
            setActionError(undefined);
            startTransition(async () => {
              const { deleteOfferAction } = await import("@/app/actions/offers");
              const result = await deleteOfferAction(offerId);
              if (result.status === "success") {
                invalidateAll(collectionId);
                router.push(`/c/${collectionSlug}/offers`);
              } else setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}
