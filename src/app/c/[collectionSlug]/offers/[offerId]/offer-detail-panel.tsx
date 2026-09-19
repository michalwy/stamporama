"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ConfirmDialog } from "@/app/dialog-shell";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useToast } from "@/app/toast-provider";
import { InlineText } from "@/app/c/[collectionSlug]/shared/inline-text";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  OfferStateChip,
  EmptiedListingChip,
  NeedsActionChip,
  InActiveBiddingChip,
  ListingOutOfDateChip,
  ListingTypeChip,
  PlatformSaleChip,
} from "../offer-badges";
import {
  useOfferDetail,
  useOfferCopies,
  useOfferTranslationGaps,
  useOfferListingDuplicates,
  useInvalidateOffers,
} from "../use-offers-query";
import { TranslationGapsPanel } from "@/app/c/[collectionSlug]/shared/translation-gaps";
import { DuplicateOfferDialog } from "../duplicate-offer-dialog";
import { SellOfferFlowDialog } from "../sell-offer-flow-dialog";
import { ActivateOfferDialog } from "../activate-offer-dialog";
import { LISTING_ELEMENT_ID, useAssistantHandoff, useAssistantPresence } from "../assistant-handoff";
import { CLOSE_ELEMENT_ID, useAssistantClose } from "../assistant-close-handoff";
import {
  AssistantOutcome,
  ListViaAssistantButton,
  UpdateViaAssistantButton,
  CloseViaAssistantButton,
} from "../assistant-listing";
import { PublishToAllegroButton } from "../allegro/publish-to-allegro";
import { ComposeSetDialog } from "./compose-set-dialog";
import { OfferPhotosCard } from "./offer-photos-card";
import { OfferPlatformItemsCard } from "./offer-platform-items-card";
import { OfferAllegroCard } from "./offer-allegro-card";
import { OfferDelcampeCard } from "./offer-delcampe-card";
import { OfferSetsView } from "./offer-sets-view";
import { useTitleLanguages } from "@/app/c/[collectionSlug]/shared/use-title-languages";
import { OfferListingText, EditedChip } from "./offer-listing-text";
import { CopyButton } from "@/app/c/[collectionSlug]/shared/copy-button";
import { TextLengthCounter } from "@/app/c/[collectionSlug]/shared/text-length-counter";
import { formatInstant } from "@/app/c/[collectionSlug]/auctions/auction-format";
import { languageLabel, normalizeLanguage } from "@/lib/languages";
import {
  isAuctionListing,
  isTerminalState,
  manualTransitions,
  OFFER_STATE_LABEL,
  quickAdvanceTarget,
  priceLabel,
  pricingReadyFor,
  requiresSets,
  type ManualOfferTarget,
} from "@/lib/offer-rules";
import { isEmptiedListing, isListedState } from "@/lib/offer-listing-drift";
import type { OfferDetailSet, OfferTextField } from "@/lib/offers";
import { isPhotoReadinessBlocker } from "@/lib/offer-photo-readiness";
import { describeCommittedCopies } from "@/lib/trade-reservation-rules";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { IssueHeader } from "@/lib/issues";
import { Icon, type IconName } from "@/app/icons";
import { formatEntityNo } from "@/lib/quick-jump";

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

const TRANSITION_LABEL: Record<string, { label: string; icon: IconName }> = {
  ready: { label: "Mark ready", icon: "check" },
  preparing: { label: "Back to preparing", icon: "revert" },
  active: { label: "Resume", icon: "resume" },
  paused: { label: "Pause", icon: "pause" },
  withdrawn: { label: "Withdraw", icon: "withdraw" },
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

/** The quick-apply chip beside the platform's opening figure (#362/#553). The catalog-value
 * suggestion and the platform's floor (#731) are links on the price line instead (#1295). */
const USE_BTN: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-accent)",
  color: "var(--color-accent)",
  background: "var(--color-accent-soft)",
  cursor: "pointer",
};

const PRICE_LINE_SEPARATOR: React.CSSProperties = { fontSize: "0.75rem", color: "var(--color-text-muted)" };

/** A figure the price is weighed against, on the price line (#1295): a short label, so three numbers
 * in a row are not told apart by position alone, and the figure as a link that applies it. A figure
 * that already *is* the stated price is drawn plain, since clicking it would change nothing. */
function PriceFigureLink({
  label,
  figure,
  about,
  target,
  applied,
  disabled,
  onApply,
}: {
  label: string;
  figure: string;
  /** What the figure is, for the hover hint. */
  about: string;
  /** The field it writes, as the hint names it: "price", or an auction's "starting price". */
  target: string;
  applied: boolean;
  disabled: boolean;
  onApply: () => void;
}) {
  const text = (
    <>
      <span style={{ color: "var(--color-text-muted)" }}>{label}</span> {figure}
    </>
  );
  return (
    <Tooltip
      content={applied ? `${about} — already the ${target}` : `${about} — click to set the ${target} to it`}
      align="end"
    >
      {applied ? (
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>{text}</span>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={onApply}
          style={{
            padding: 0,
            background: "none",
            border: "none",
            fontSize: "0.75rem",
            color: "var(--color-accent)",
            cursor: "pointer",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {text}
        </button>
      )}
    </Tooltip>
  );
}

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
function advanceLabel(to: ManualOfferTarget): { label: string; icon: IconName } {
  return to === "active" ? { label: "Activate", icon: "activate" } : TRANSITION_LABEL[to];
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
  // Confirmation toasts (#541) — used sparingly here. Most of this screen *is* the result: an edited
  // title redraws in place, a set added appears in the list below. What gets one is the act whose
  // effect is a chip disappearing or a state word changing at the top of a long page.
  const { toast } = useToast();
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
    // Both cues are the same act on this screen — re-read the offer. They stay two callbacks
    // because the workspace only ever sees the first: a batch is scoped to Ready offers, so an
    // update run cannot happen there (#462).
    // The photo step (#727) is the same act a third time: the Photos card below is showing the plan
    // the handoff has just re-rendered.
    {
      onActivated: onListingActivated,
      onUpdated: onListingActivated,
      onPhotosGenerated: onListingActivated,
    }
  );
  const handoffRunning =
    handoff?.state === "generating" ||
    handoff?.state === "loading" ||
    handoff?.state === "running";

  // Closing the listing on Colnect (#729). The dialog is the gesture: nothing is sent until the
  // collector confirms there, and it stays open, busy, until Colnect has answered and this offer has
  // been withdrawn — so the one failure worth guarding, a listing closed on Colnect with the offer
  // still Active here, happens in front of the collector rather than behind them.
  const [closingListing, setClosingListing] = useState(false);
  const [closeError, setCloseError] = useState<string | undefined>();
  const {
    handoff: closeHandoff,
    start: startClose,
    dismiss: dismissClose,
    nodeRef: closeNodeRef,
  } = useAssistantClose();
  const withdrawnFor = useRef<string | null>(null);

  /** Withdraw this offer once Colnect has confirmed the close — the same transition the Withdraw
   *  confirmation takes, so a close through the Assistant ends in exactly the record a withdrawal by
   *  hand does. */
  const withdrawAfterClose = useCallback(() => {
    setCloseError(undefined);
    startTransition(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(offerId, "withdrawn");
      if (result.status === "success") {
        setClosingListing(false);
        dismissClose();
        invalidateAll(collectionId);
        toast({ message: "Closed on Colnect — this offer is now withdrawn" });
      } else {
        setCloseError(
          `The listing is closed on Colnect, but this offer could not be withdrawn: ${result.message}`
        );
      }
    });
  }, [offerId, collectionId, dismissClose, invalidateAll, toast]);

  useEffect(() => {
    if (closeHandoff?.state !== "closed" || closeHandoff.offerId !== offerId) return;
    // Once per close: a re-render must not withdraw twice, and a refused withdrawal is retried by
    // the dialog's own button rather than by the next render.
    if (withdrawnFor.current === closeHandoff.requestId) return;
    withdrawnFor.current = closeHandoff.requestId;
    withdrawAfterClose();
  }, [closeHandoff, offerId, withdrawAfterClose]);

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
  // Other live offers on this platform listing the same thing (#1347) — the pair the collision
  // warnings exist to prevent, found after the fact so it can be merged.
  const { data: listingDuplicates = [] } = useOfferListingDuplicates(collectionId, offerId, !!offer);

  if (isLoading || !offer) {
    return (
      <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
        {isLoading ? "Loading offer…" : "Offer not found."}
      </div>
    );
  }

  // Read out once so the hoisted handlers below can see it — a function declaration does not keep
  // the narrowing the early return above gave `offer`.
  const state = offer.state;
  const editable = !isTerminalState(state);

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
  // The photo half of that gate, told apart from the rest (#727). **Mark ready** is still refused on
  // it — `readyBlockers` above is whole — but **List via Assistant** is not: its first step is to
  // render the images itself, so a photo gap is something the click *fixes* rather than a reason to
  // withhold it. What is left is the gate's other half, which is nobody's errand but the
  // collector's: a wrong grade or an over-long title is fixed before anything is posted.
  const photoGap = readyBlockers.some(isPhotoReadinessBlocker);
  const listingReadyBlockers = readyBlockers.filter((b) => !isPhotoReadinessBlocker(b));
  // Listing straight out of **Preparing** (#554): the collector who has just finished assembling an
  // offer wants to post it, and making them press **Mark ready** first is a click that decides
  // nothing. Offered under exactly the conditions that quick-advance is — the handoff marks the offer
  // ready on its way out, so a step the server would refuse must not be offered — and judged by the
  // *same* blockers, `readyBlockers` being the listing preconditions (#406) asked at Ready plus the
  // photos (#311). `listingBlockers` would report `not-ready` here, which is the very thing this
  // click undoes.
  const listingFromPreparing = offer.state === "preparing" && advanceTo === "ready" && advanceReady;
  // An offer that only lacks a price (#336): the price field is right here, so say what is missing
  // instead of silently withholding the advance button. On an auction what is missing is the
  // **starting** price (#449) — the current one follows from it while nobody has bid — so the line
  // names that field instead.
  const blockedOnPrice = advanceTo !== null && !pricedForAdvance && offer.sets.length > 0;
  const missingPriceLabel = isAuctionListing(offer.listingType) ? "a starting price" : "a price";
  // The figure the seller **states**, and the column that holds it. On a quick buy that is the asking
  // price; on an auction it is the opening one, the price beside it being wherever the bidding has
  // got to (#449). What every suggestion under the price — the catalog value, the platform's opening
  // figure, its floor (#731) — is applied to, and compared against to decide whether applying it
  // would change anything.
  const askingPriceField = isAuctionListing(offer.listingType) ? "startingPrice" : "price";
  const askingPriceNoun = isAuctionListing(offer.listingType) ? "starting price" : "price";
  const askingPrice = isAuctionListing(offer.listingType)
    ? offer.startingPrice
    : offer.price === "0.00"
      ? null
      : offer.price;
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

  /**
   * The live listing has been brought back into step (#542) — the collector saying so by hand.
   *
   * A control rather than something inferred, because nothing this app can see proves a listing was
   * re-posted on a platform it has no connection to. On a platform it *can* reach, the Assistant's
   * update run clears the flag itself; this is the same act for everywhere else, and for the change
   * that turned out not to be worth going back for.
   */
  function markListingSynced() {
    setActionError(undefined);
    startTransition(async () => {
      const { markOfferListingSyncedAction } = await import("@/app/actions/offers");
      const result = await markOfferListingSyncedAction(offerId);
      if (result.status === "success") {
        invalidateAll(collectionId);
        toast({ message: "Marked as up to date — the live listing matches this offer again" });
      } else setActionError(result.message);
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
      if (result.status === "success") {
        invalidateAll(collectionId);
        // No link — this is the offer's own screen. The state word is at the top of a page the
        // collector may have scrolled a long way down.
        toast({ message: `This offer is now ${OFFER_STATE_LABEL[next].toLowerCase()}` });
      } else setActionError(result.message);
    });
  }

  /**
   * Hand this offer to the Assistant to post (#414), from **Preparing** as well as from Ready
   * (#554).
   *
   * From Preparing the state still goes before the kit — which is served only for a Ready offer
   * (#405/#406) — but no longer before the *handoff*: it is the run's `prepare` step (#727), so it
   * happens after the photos have been rendered and not before. That order is the whole point of
   * putting it there: `preparing → ready` is refused while the listing photos are missing, which is
   * exactly what the handoff's first step goes and fixes. A refused transition stops the run with
   * its own message rather than leaving the Assistant to refuse it a second time in different words.
   *
   * No toast on the way through, unlike **Mark ready** itself: the state chip is right beside the
   * button that was pressed, and what the collector is waiting on is the report strip below.
   */
  function listViaAssistant() {
    setActionError(undefined);
    if (state === "ready") {
      void startHandoff(offerId);
      return;
    }
    void startHandoff(offerId, "create", async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(offerId, "ready");
      if (result.status !== "success") return result.message;
      invalidateAll(collectionId);
      return null;
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
          icon: activating ? "activate" : TRANSITION_LABEL[s].icon,
          danger: s === "withdrawn",
          onSelect: () => setState(s),
        };
      }),
    // The title is the one generated text with **no ↻ of its own** — the description and the private
    // note carry theirs in `OfferListingText`, and the header gives the title a pencil and this
    // entry — so this is the only control on the screen that names the act. Ungated it emptied the
    // title outright (#1163): with neither the offer's own template nor the platform's,
    // `regenerateOfferText` writes the generator's `null` and the wording is gone, silently.
    //
    // Gated on `regeneratable`, the one answer every surface asking this question reads — the
    // per-field ↻, the agent surface (#711) and the entries below — which since #1146 is the
    // offer's own template or, failing that, the platform's. **Disabled with a hint rather than
    // hidden** (#273): a fixed entry reached for by name cannot silently vanish, and with no ↻
    // beside the title there is nothing else on the screen to answer the question. The
    // other-language entries below *filter*, which is right for them and not for this one — the
    // reasoning is in `docs/agents/offers.md`.
    {
      key: "regenerate",
      label: "Regenerate title",
      icon: "refresh",
      disabled: !offer.regeneratable.name,
      hint: offer.regeneratable.name
        ? undefined
        : "Neither this listing nor the platform has a title template — set one on the platform's contact",
      onSelect: () => regenerate("name"),
    },
    // One entry per generated text × *other* language the collection lists in (#297/#266/#267) —
    // the entry above and each field's own ↻ already cover the platform's own language, and a field
    // there is no template for — the offer's own or the platform's — is skipped. Absent for a
    // single-language collection. Filtering is safe here in a way it would not be above: these are a
    // *generated cross-product* whose normal state is empty, so no named entry goes missing, and the
    // disabled entry above is what says why a title one is absent.
    ...otherTitleLanguages.flatMap((code) =>
      REGENERATABLE_TEXTS.filter((t) => offer.regeneratable[t.field]).map(
        (t): RowAction => ({
          key: `regenerate-${t.field}-${code ?? "default"}`,
          label: `Regenerate ${t.label} in ${languageLabel(code ?? defaultLanguage)}`,
          icon: "refresh",
          onSelect: () => regenerate(t.field, code),
        })
      )
    ),
    ...(offer.inActiveBidding
      ? [{ key: "clear-bidding", label: "Clear active bidding", icon: "bidding", onSelect: () => setBidding(false) } as RowAction]
      : offer.state === "active"
        ? [{ key: "mark-bidding", label: "Mark in active bidding", icon: "bidding", onSelect: () => setBidding(true) } as RowAction]
        : []),
    // Same precondition as the list's entry: a terminal offer has nothing left to sell, and an
    // offer holding no set has nothing to put on a sale line.
    ...(editable && offer.sets.length > 0
      ? [{ key: "sell", label: "Sell", icon: "sell", onSelect: () => setSelling(true) } as RowAction]
      : []),
    // Only while the flag is up (#542): an entry offering to clear something that is not set is an
    // entry that says the flag exists on every offer that has never carried one. Not on a listed offer
    // with no sets (#1277): its listing can only come down, so the server refuses and withdrawing is
    // the way off the flag.
    ...(offer.listingOutOfDate && !(isListedState(offer.state) && offer.sets.length === 0)
      ? [
          {
            key: "mark-listing-synced",
            label: "Mark listing up to date",
            icon: "check",
            onSelect: markListingSynced,
          } as RowAction,
        ]
      : []),
    { key: "duplicate", label: "List on another platform", icon: "duplicate", onSelect: () => setDuplicating(true) },
    { key: "delete", label: "Delete", icon: "delete", danger: true, separatorBefore: true, onSelect: () => setConfirm("delete") },
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
            <Icon name="close" size="sm" />
          </button>
        </div>
      )}

      {/* The same entry offered twice on this platform (#1347): the fact, never a rule (#524), and
          never a gate — the collector merges by hand, from either side. Read by what each set is
          listed as, so an umbrella offer and one on the variant it resolves to are a pair. */}
      {listingDuplicates.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
            border: "1px solid var(--color-warning-border)",
            borderRadius: "0.5rem",
            background: "var(--color-warning-soft)",
            padding: "0.625rem 1rem",
            fontSize: "0.8125rem",
            color: "var(--color-warning)",
          }}
        >
          <Icon name="warning" size="sm" />
          <span>
            The same stamps in the same conditions are already offered on {offer.platformName} in{" "}
            {listingDuplicates.map((d, i) => (
              <span key={d.offerId}>
                {i > 0 && ", "}
                <Link
                  href={`/c/${collectionSlug}/offers/${d.offerId}`}
                  style={{ color: "inherit", fontWeight: 600 }}
                >
                  {formatEntityNo(d.offerNo)} {d.offerLabel}
                </Link>
              </span>
            ))}
            .
          </span>
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
          {/* What this platform accepts for a title (#610), where a title is written. Delcampe's
              Easy Uploader export refuses over it (nothing is truncated), so the number has to be
              visible while the wording is still being decided rather than at export time. */}
          <TextLengthCounter
            text={offer.name}
            limit={offer.platformTextLimits.maxTitleLength}
            what="title"
          />
          <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>on {offer.platformName}</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <OfferStateChip state={offer.state} />
            {(canAdvance || readyBlockers.length > 0) && advanceTo && (() => {
              const { label, icon } = advanceLabel(advanceTo);
              const blocked = readyBlockers.length > 0;
              return (
                <Tooltip
                  maxWidth="26rem"
                  content={
                    blocked ? (
                      // One line per reason, never a count: each is fixed somewhere different (#406,
                      // #311) — a catalogue match on another screen, a photo run on the card below.
                      //
                      // The reason's **short title** and its subjects, never the full sentences: four
                      // of those ran into one unreadable block, which is the one thing a hint must not
                      // be. What is at fault leads in strong type, what has to be fixed follows muted
                      // and indented under it, and the whole sentence is a click away on the surfaces
                      // that have room for it — this card's own screens and the server's refusal.
                      <span style={{ display: "grid", gap: "0.5rem", textAlign: "left" }}>
                        <span style={{ fontWeight: 600 }}>
                          Not ready to be listed on {offer.platformName} yet:
                        </span>
                        {readyBlockers.map((b) => (
                          <span
                            key={b.code}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "auto 1fr",
                              columnGap: "0.4375rem",
                              rowGap: "0.125rem",
                              lineHeight: 1.45,
                            }}
                          >
                            <span aria-hidden style={{ color: "var(--color-error)" }}>
                              •
                            </span>
                            <span>{b.title}</span>
                            {b.subjects.length > 0 && (
                              <span
                                style={{
                                  gridColumn: 2,
                                  color: "var(--color-text-muted)",
                                }}
                              >
                                {b.subjects.join(", ")}
                              </span>
                            )}
                          </span>
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
                    <Icon name={icon} size="sm" />
                    {label}
                  </button>
                </Tooltip>
              );
            })()}
            {/* The same handoff the bulk workspace offers (#407/#414). A single listing is routinely
                posted from here rather than from a batch, and a step offered on one screen only is
                the step that gets skipped on the other — the same reasoning that made activation ask
                for the URL in both places (#399). Offered from **Preparing** too (#554), where the
                click marks the offer ready on its way to the form: an offer that passes every check
                is one the collector is finished with, and pressing Mark ready first only to press
                this next decides nothing. Nowhere else — anything past Ready has nothing to post,
                and the preconditions say so themselves. */}
            {(offer.state === "ready" || listingFromPreparing) && (
              <ListViaAssistantButton
                platformModule={offer.platformModule}
                present={assistantPresent}
                blockerCount={
                  offer.state === "ready"
                    ? offer.listingBlockers.length
                    : listingReadyBlockers.length
                }
                generatesPhotos={photoGap}
                busy={false}
                running={handoffRunning}
                disabled={isPending}
                marksReady={listingFromPreparing}
                style={ASSISTANT_BTN}
                onStart={listViaAssistant}
              />
            )}
            {/* The other half of the same handoff (#462): once the listing exists, the way to change
                what it says is to go back to it. Only on an Active offer — the button's own rules do
                the rest, and there is deliberately no equivalent in the bulk workspace, which is
                scoped to Ready offers because posting is what a batch is for. */}
            {offer.state === "active" && (
              <UpdateViaAssistantButton
                platformModule={offer.platformModule}
                listingUrl={offer.url}
                present={assistantPresent}
                blockerCount={offer.listingUpdateBlockers.length}
                busy={false}
                running={handoffRunning}
                disabled={isPending}
                style={ASSISTANT_BTN}
                onStart={() => {
                  setActionError(undefined);
                  void startHandoff(offerId, "update");
                }}
              />
            )}
            {/* The way down (#729): the live listing closed on Colnect and the offer withdrawn here,
                in one confirmation. Active only, as the issue scopes it — a Colnect sale that is
                paused there cannot be closed until it is resumed. */}
            {offer.state === "active" && (
              <CloseViaAssistantButton
                platformModule={offer.platformModule}
                saleId={offer.colnectSaleId}
                present={assistantPresent}
                running={closeHandoff?.state === "running"}
                disabled={isPending}
                style={ASSISTANT_BTN}
                onStart={() => {
                  setActionError(undefined);
                  setCloseError(undefined);
                  dismissClose();
                  setClosingListing(true);
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
            {/* The live listing no longer matches this record (#542). Below the committed-stock
                flags above and above the descriptive chips below, which is where it grades: a
                listing that is wrong costs a sale, not a double one. The menu carries the way off
                it, so the chip states the problem and nothing more. */}
            {offer.listingOutOfDate && <ListingOutOfDateChip since={offer.listingOutOfDate} />}
            {/* Nothing is left in a listing that was up (#1277) — the same chip the row carries. */}
            {isEmptiedListing(offer.state, offer.sets.length) && <EmptiedListingChip state={offer.state} />}
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
              <span style={CHIP}><Icon name="date" size="sm" /> {new Date(offer.listingDate).toISOString().slice(0, 10)}</span>
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
                  <Icon name="externalLink" size="sm" /> Listing
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

          {/* The price and the figures it is weighed against, stacked on the right so they read as
              one unit. What the figure is *called* follows the listing type (#449) — an auction's is
              where the bidding stands, not something the seller asked for — but it is one field
              either way, and editing it in place is how a bid is refreshed (#351's pattern:
              committing stamps the check date shown below it). */}
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.15rem" }}>
            {/* One line, weakest claim first (#1295): the platform's floor (#731), the catalog value
                (#230), then the price itself — three numbers compared at a glance rather than a row
                each. A figure that does not exist is left out, never drawn empty or as 0.00 (#1184).
                Clicking either one writes the figure the seller **states** (`askingPriceField`),
                never an auction's current price, which would be recording a bid nobody placed. */}
            <span style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", flexWrap: "wrap", gap: "0.375rem", fontVariantNumeric: "tabular-nums" }}>
              {editable && offer.platformMinimumPrice && offer.platformMinimumPrice !== "0.00" && (
                <>
                  <PriceFigureLink
                    label="min"
                    figure={offer.platformMinimumPrice}
                    about={`The lowest ${offer.platformName} is worth listing on, set on the platform`}
                    target={askingPriceNoun}
                    applied={askingPrice === offer.platformMinimumPrice}
                    disabled={isPending}
                    onApply={() => patch(askingPriceField, offer.platformMinimumPrice!)}
                  />
                  <span style={PRICE_LINE_SEPARATOR}>·</span>
                </>
              )}
              {editable && offer.suggestedPrice && offer.suggestedPrice !== "0.00" && (
                <>
                  <PriceFigureLink
                    label="suggested"
                    figure={offer.suggestedPrice}
                    about="Average catalog value per set, in this offer's currency"
                    target={askingPriceNoun}
                    applied={askingPrice === offer.suggestedPrice}
                    disabled={isPending}
                    onApply={() => patch(askingPriceField, offer.suggestedPrice!)}
                  />
                  {offer.suggestedUnpricedSets > 0 && (
                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      ({offer.suggestedUnpricedSets} set{offer.suggestedUnpricedSets === 1 ? "" : "s"} unpriced)
                    </span>
                  )}
                  <span style={PRICE_LINE_SEPARATOR}>·</span>
                </>
              )}
              <span style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
                <Tooltip content={priceLabel(offer.listingType)} align="end">
                  <InlineText
                    value={offer.price === "0.00" ? "" : offer.price}
                    placeholder={isAuctionListing(offer.listingType) ? "Record a bid" : "Set price"}
                    display={
                      offer.price === "0.00" ? (
                        <span style={{ color: "var(--color-text-muted)", fontWeight: 500, fontSize: "0.8125rem", cursor: "text" }}>
                          {/* An unbid auction is not *unpriced* — it is up at its opening figure with
                              nobody having bid, which is a different and perfectly normal thing (#449). */}
                          {isAuctionListing(offer.listingType) ? "no bids yet" : "no price yet"}
                        </span>
                      ) : (
                        <span style={{ cursor: "text" }}>{offer.price} {offer.currency}</span>
                      )
                    }
                    editable={editable}
                    isPending={isPending}
                    inputType="amount"
                    suffix={offer.currency}
                    // A price is retyped whole, never amended in the middle (#329).
                    selectOnEdit
                    onSave={(v) => patch("price", v)}
                  />
                </Tooltip>
              </span>
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
                      inputType="amount"
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
            {/* The platform's own opening figure (#362/#553), offered back only on an auction that
                still has no starting price. It is a *creation-time* seed, so on an offer that
                already carries one, showing it again would be inviting the collector to undo a
                decision they have already made. */}
            {editable &&
              isAuctionListing(offer.listingType) &&
              !offer.startingPrice &&
              offer.platformDefaultStartingPrice && (
                <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: "0.375rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <Tooltip
                    content={`What ${offer.platformName} opens an auction at by default`}
                    align="end"
                  >
                    <span>
                      <Icon name="suggestion" size="sm" /> platform default{" "}
                      {offer.platformDefaultStartingPrice} {offer.currency}
                    </span>
                  </Tooltip>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => patch("startingPrice", offer.platformDefaultStartingPrice!)}
                    style={USE_BTN}
                  >
                    Use
                  </button>
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

        {/* Promised in an agreed trade (#639), stated beside the control that would be refused for
            it. Drawn at **every** state and not only where it blocks: an offer being assembled out of
            stock that is already spoken for is worth knowing about while there is still time to
            compose it differently, and a notice that appeared only on the press of Activate would
            appear at the worst possible moment. The trades are links, because what resolves this is
            on their screens — a withdrawal (#642), or calling the trade off. */}
        {offer.tradeCommitments.length > 0 && (
          <div
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
            <p style={{ margin: 0, lineHeight: 1.5 }}>
              <strong style={{ color: "var(--color-error)" }}>Promised elsewhere:</strong>{" "}
              {describeCommittedCopies(offer.tradeCommitments)}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.375rem" }}>
              {[
                ...new Map(offer.tradeCommitments.map((c) => [c.trade.tradeId, c.trade])).values(),
              ].map((trade) => (
                <Link
                  key={trade.tradeId}
                  href={`/c/${collectionSlug}/trades/${trade.tradeId}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    color: "var(--color-accent)",
                    textDecoration: "none",
                    fontWeight: 500,
                  }}
                >
                  <Icon name="trades" size="sm" /> Trade #{trade.tradeNo} — {trade.partnerName}
                </Link>
              ))}
            </div>
          </div>
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
            note={`Used by this platform's generated texts. Regenerate a text to pick up a new translation.`}
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

      {/* The offer's stamps and what Colnect knows them as (#423), between the images and the sets:
          it is the last thing consulted before posting and the first place one leaves the screen
          from, and it is keyed on `stamp × condition` rather than on the copy, so it belongs beside
          the sets rather than inside them. Drawn on every platform (#669) — Colnect linking is how a
          stamp's own numbers and date get filled in, wherever it is being sold — so it renders
          nothing only for an offer that holds no copies yet. */}
      <OfferPlatformItemsCard
        items={offer.platformItems}
        offerId={offer.id}
        platformModule={offer.platformModule}
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

      {/* The same two questions on Delcampe (#608, #609): the category the row is filed under, and
          which listing profile it is built from. Null (and so absent) on every platform that is not
          Delcampe. */}
      {offer.delcampeListing && (
        <OfferDelcampeCard
          offerId={offerId}
          config={offer.delcampeListing}
          listingType={offer.listingType}
          categorySearchTerm={offer.delcampeListing.categorySearchTerm}
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
      {/* The close handoff (#729), on a node of its own for the same reason and in the same shape. */}
      {closeHandoff && (
        <div ref={closeNodeRef} id={CLOSE_ELEMENT_ID} hidden>
          {closeHandoff.payload}
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

      {closingListing && offer.colnectSaleId && (
        <ConfirmDialog
          title="Close the listing on Colnect"
          message="The Assistant closes this listing on Colnect, in your own signed-in Colnect session, and then withdraws this offer. Withdrawn is final here — to sell again, create a new offer. On Colnect the listing can be reopened from its own page. The copies are untouched."
          actionLabel={closeHandoff?.state === "closed" ? "Withdraw" : "Close and withdraw"}
          pendingLabel={closeHandoff?.state === "running" ? "Closing on Colnect…" : "Withdrawing…"}
          variant="destructive"
          isPending={isPending || closeHandoff?.state === "running"}
          error={closeHandoff?.state === "error" ? (closeHandoff.message ?? undefined) : closeError}
          onClose={() => {
            if (isPending || closeHandoff?.state === "running") return;
            setClosingListing(false);
            setCloseError(undefined);
            dismissClose();
          }}
          onConfirm={() => {
            // Colnect already closed it and only the withdrawal was refused: retry that alone, rather
            // than asking Colnect to close a listing that is no longer open.
            if (closeHandoff?.state === "closed") {
              withdrawAfterClose();
              return;
            }
            setCloseError(undefined);
            startClose({
              offerId,
              collectionId,
              saleId: offer.colnectSaleId!,
              label: offer.name ?? offer.label,
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
