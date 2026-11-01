"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FACEBOOK_POST_STAGE_LABEL,
  facebookLotPrice,
  facebookPostLink,
  facebookPostMoves,
  facebookPostStage,
  isFacebookLotClosed,
  isFacebookLotPosted,
} from "@/lib/facebook-post-rules";
import type { FacebookKitLot } from "@/lib/facebook-auctions";
import { canPreviewFacebookPost } from "@/lib/facebook-post-preview-rules";
import { languageLabel } from "@/lib/languages";
import type { TitleFallback } from "@/lib/offer-title-template";
import { lotGroupName } from "@/lib/offer-lot-group-rules";
import { facebookLotsInView, isFacebookLotForSale } from "@/lib/facebook-post-ui-state";
import { isAuctionListing, isTerminalState, manualTransitions, OFFER_LISTING_TYPE_LABEL } from "@/lib/offer-rules";
import { isPhotoRunBlocker } from "@/lib/offer-photo-readiness";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { ConfirmDialog, DialogSecondaryButton } from "@/app/dialog-shell";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { InlineText } from "@/app/c/[collectionSlug]/shared/inline-text";
import { showLineAt } from "@/app/c/[collectionSlug]/shared/reorder-list";
import { TranslationGapLinks } from "@/app/c/[collectionSlug]/shared/title-preview";
import { gapKey } from "@/app/c/[collectionSlug]/shared/translation-gaps";
import { useToast } from "@/app/toast-provider";
import { ActivateOfferDialog, type PublishTarget } from "../../activate-offer-dialog";
import { BackToReadyDialog, backToReadyDone } from "../../back-to-ready-dialog";
import { PendingLinkMark } from "../../offer-badges";
import { SellOfferFlowDialog, type SellableOfferSubject } from "../../sell-offer-flow-dialog";
import {
  useFacebookPostCatalogueFill,
  useFacebookPostLotsPrepare,
  useFacebookPostScreen,
  useInvalidateOffers,
} from "../../use-offers-query";
import { FacebookPostKit, PHOTO_SIZE } from "../../[offerId]/facebook-post-kit";
import { DeleteFacebookPostDialog, deletedPostMessage } from "../delete-post-dialog";
import { AddLotsDialog } from "./add-lots-dialog";
import { NewLotFlow, type NewLotPost, type NewLotSource } from "./new-lot-flow";
import {
  DropLine,
  GroupLotRow,
  LOT_LIST,
  priceFact,
  saleFact,
  stateFact,
  textFacts,
  type LotFact,
} from "../../lots/lot-row";
import { useLotGroupTools } from "../../lots/use-lot-group-tools";
import { LotGroupSummaryBar } from "../../lots/lot-group-summary-bar";
import { useFacebookPostStillForSale } from "./post-ui-state";
import { PostPreviewDialog } from "./post-preview-dialog";
import { PostPriceTotalsBar } from "./post-price-totals-bar";
import { postPriceTotals, statedPrice, type PriceDraft } from "@/lib/facebook-post-price-totals";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";

// A Facebook post's own screen (#1842): the one place every offer in the post is seen with its state,
// and the post is managed as one. Until it existed the post was seen from any lot's Facebook card,
// which repeated the whole post on every lot. A post of one lot — an offer posted alone, once it is
// published (#1989) — is this screen with one row, its text written as a single post's.
//
// - **The post's title** (#1862), in its heading beside its number, edited in place — what tells the
//   post apart from the others running at once. A post made before titles is named by number until it
//   is given one, and its heading offers to name it.
// - **The post's moves**, made as one — submit for approval, approve, reject, activate, withdraw (#1778,
//   #1779) — through the same actions the offer screen uses, asked of a lot: the server takes the whole
//   post with it, so the buttons are offered only where `facebookPostMoves` says the server would.
//   *Back to Ready…* (#1998) takes a post that is up back — a mistaken Publish, or a post gone from the
//   group; when lots sold or withdrawn stay behind, the others move into a new post, and the screen
//   goes there. *Back to preparing* (#2115) is its counterpart before the post is up: every Ready lot
//   back to Preparing in one go, and each lot's `⋮` the same for that lot alone.
// - **The kit**: the layout, the post's text and the photos' ZIP, above the lots.
// - **The lots' row and the tools over them** — photo settings, texts and titles, pricing and readying,
//   the order — are shared with a proposal's screen (#2313): `GroupLotRow` and `useLotGroupTools` in
//   `offers/lots/`. What only a post has stays here: its kit, captions, links, untranslated names,
//   ticks, totals and moves.
// - **The lots**, listed once (#1863), in lot order and so in posting order: each row is the lot's
//   photo (its upload set, laid out as text), the lot number, the offer (linking to it), its type, its
//   price — an auction's current bid once one is recorded, else its starting price — its state, its
//   listing link, its sale once sold, and, captioned (#1841), its caption with its *Copy*. Each lot's
//   own actions stay the offer's (*Sell*, withdrawing one lot of a post that is up) and are reached
//   from its row's `⋮`, as is *Take this lot out of the post* while the post is not up.
// - **Add lots…** (#1870), beside the lots' heading while the post is not up: offers picked from those
//   that could join become its next lots, and any the server turns away is named under the heading.
// - **New lot…** and **New lot from a new item…** (#2291), beside it: a new offer made as the post's
//   next lot — from copies in the app, or from a stamp not yet in it — and the next one offered at once,
//   so a post made by hand is filled lot by lot without leaving it. A post with no lot yet says so.
// - **Untranslated names** (#1889), while the post is not up: each lot's row names those its part of
//   the post prints in the default language, as #1733's links — the translation is entered there, is
//   the entity's own, and saving it re-renders the lots' texts at once, so the name leaves every row
//   printing it. Above the lots only their count is said, stepping to the next such row (#1980): a
//   paragraph of every name on a post of twenty lots could not be worked through. The post's own text
//   prints no translatable name of its own — every name is some lot's — so nothing is listed under it.
// - **Regenerate lot texts…** (#1983), beside *Add lots…* while the post is not up: every lot's title
//   and description from its templates in one go, instead of each offer's ↻ one by one. A row whose
//   text reads otherwise than its templates now give is marked *Out of date*, and the action then
//   offers just those; a row written by hand is marked so, and is replaced only when ticked.
// - **The lots' titles, all at once** (#2033), beside it while the post is not up: *Title template for
//   all lots…* gives every lot one title template and writes the titles again from it, a hand-written
//   one only when ticked; *Add to titles…* / *Remove from titles…* put the same words on, or take them
//   off, the start or end of every title, showing the titles that change before saving.
// - **The lots' order** (#1986), while the post is not up: a row is dragged by its grip to a new place,
//   or the whole post sorted by catalogue number or price from the lots' heading. The lot numbers are
//   the order, so the text, the captions and the photos' download follow; the rows show the new order
//   at once and the server's answer replaces it.
// - **Photo settings…** (#2032), beside them while the post is not up: every lot's photo settings in
//   one dialog — the sides to photograph, say — and their photos regenerated, instead of each offer's;
//   *Make photos* (#2323) beside it makes the photos of every lot that has none, whatever its state.
// - **Pricing and readying the lots** (#2031), while the post is not up — the Prepare screen's work, for
//   this post's lots: each row carries the compact price table with the lot's own price typed in it
//   (Enter saves it and moves down to the next lot's), its title edited in place, and what still stops
//   it from being marked ready, covers checked from the row. Above the lots, *Use estimated price*,
//   *Check covers* and *Mark ready* act on every lot of the post; a lot that cannot be readied is named
//   with its reason. The rows are read apart from the screen (`getFacebookPostLotsPrepare`). Once the
//   post is up the rows show what they showed before: pricing and readying belong to before.
// - **One lot's change refreshes that lot** (#2221): a price, a title or the lot's own *Back to
//   preparing* reads that lot again and writes it into the screen — its row, the kit the post's text and
//   captions are drawn from, the totals — rather than every lot's figures, photos and texts. The moves
//   on the whole post read it whole.
// - **The post's totals** (#2218), in a bar pinned to the bottom of the window under the lots while they
//   are priced: the lots' prices summed, and what they make against the lots' catalogue, estimated,
//   market and cost figures summed. A price counts as soon as it is typed, before Enter; a lot without a
//   price or a figure is left out of that total and counted as *over N of M lots*. Gone once the post
//   is up.
// - **Covers on Ready lots** (#2114), until the post is up: a Ready lot's row offers *Review every
//   photo*, and *Check covers* walks every lot's photos once none is left unchecked. The lot stays
//   Ready and its photos are made again; *Publish…* waits while any lot's are being made.
// - **Still for sale** (#2081), above the lots once the post is up: one chip narrowing the rows to the
//   lots neither sold nor withdrawn, remembered per post. A filter never unticks anything — a ticked lot
//   it hides stays ticked, and *Sell…* reaches only the ticked lots in view. The kit, the photos' ZIP
//   and the post's text are the post's whole, not the list's view, so the chip leaves them alone.

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem",
};

const MUTED: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const CARD_TITLE: React.CSSProperties = {
  margin: "0 0 0.75rem",
  fontSize: "1rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
};

const LINK: React.CSSProperties = { color: "var(--color-accent)" };

// *Next lot ↓* (#1980): a link in the warning's own line, not a button beside it.
const STEP_LINK: React.CSSProperties = {
  padding: 0,
  border: "none",
  background: "none",
  font: "inherit",
  color: "var(--color-accent)",
  textDecoration: "underline",
  textUnderlineOffset: "0.15em",
  cursor: "pointer",
};

type Dialog =
  | { kind: "none" }
  | { kind: "publish"; target: PublishTarget; approving: boolean }
  | { kind: "reject" }
  | { kind: "backToReady" }
  | { kind: "withdrawPost" }
  | { kind: "withdrawLot"; lot: FacebookKitLot }
  | { kind: "takeOut"; lot: FacebookKitLot }
  | { kind: "addLots" }
  | { kind: "newLot"; source: NewLotSource }
  | { kind: "sell"; lots: FacebookKitLot[] }
  | { kind: "deletePost" }
  | { kind: "preview" };

export function FacebookPostPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  areas,
  locations,
  conditions,
  certificateStatuses,
  postId,
  today,
}: {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  /** For the catalogue chips of *Fill catalogue values* (#2220). */
  areas: CollectionAreaData[];
  /** For *New lot…*'s copy picker and new-item form (#2291). */
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  postId: string;
  /** Server-computed "today", for *Sell*'s new-sale step — as the offer screen passes it. */
  today: string;
}) {
  const router = useRouter();
  const { data: screen, isLoading, isError } = useFacebookPostScreen(collectionId, postId);
  const { invalidateAll, settlePostLot, settlePostLotPrice } = useInvalidateOffers();
  // The lots as Prepare rows (#2031), asked only while the post is not up.
  const notUp = !!screen && !screen.kit.lots.some((l) => isFacebookLotPosted(l.state));
  const { data: prepare } = useFacebookPostLotsPrepare(collectionId, postId, notUp);
  const prepareRows = notUp ? (prepare ?? null) : null;
  // The lots' copies as *Fill catalogue values* lines (#2220), asked while the lots are priced.
  const { data: fill } = useFacebookPostCatalogueFill(collectionId, postId, notUp);
  const fillLines = notUp ? (fill ?? null) : null;
  // The prices being typed, by offer id, for the post's totals (#2218) — each with the saved figure it
  // was typed over, so one left behind by a save no longer counts.
  const [priceDrafts, setPriceDrafts] = useState<ReadonlyMap<string, PriceDraft>>(() => new Map());
  const { toast } = useToast();
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [error, setError] = useState<string | undefined>();
  // The offers the last *Add lots…* turned away, by number (#1870) — kept until the next add.
  const [notAdded, setNotAdded] = useState<string | null>(null);
  // The rows, by offer id, and the one *Next* last stepped to (#1980) — so the next step is the row
  // after it, even once its own names are translated and it no longer needs one.
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const [steppedTo, setSteppedTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // The lots ticked to be sold together (#2050), by offer id. Only a lot that can still be sold has a
  // box; one that has sold since it was ticked simply drops out of `tickedLots`.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());

  const serverLots = screen?.kit.lots ?? [];
  const reorderable = serverLots.length > 1 && !serverLots.some((l) => isFacebookLotPosted(l.state));
  // The tools a post's lots share with a proposal's (#2313): photo settings, texts and titles, pricing
  // and readying, and the order — offered while the post is not up.
  const tools = useLotGroupTools({
    collectionId,
    group: { kind: "post", id: postId },
    groupName: lotGroupName("post", screen?.postNo ?? 0),
    lots: serverLots,
    editable: notUp,
    reorderable,
    prepareRows,
    fillLines,
    lotTexts: screen?.lotTexts ?? null,
    lotTitles: screen?.lotTitles ?? null,
    language: screen?.translations?.language ?? null,
    areas,
    generatingNote: "Photos being generated — Publish waits for them.",
    refresh: () => invalidateAll(collectionId),
  });
  const lots = tools.lots;
  const drag = tools.drag;
  // *Still for sale* (#2081): offered once the post is up and has more than one lot — before that no
  // lot can be sold or withdrawn, and a post of one has nothing to narrow. Remembered per post.
  const [stillForSale, setStillForSale] = useFacebookPostStillForSale(collectionId, postId);
  const narrowable = serverLots.length > 1 && serverLots.some((l) => isFacebookLotPosted(l.state));
  const narrowed = narrowable && stillForSale;
  const forSaleCount = serverLots.filter((l) => isFacebookLotForSale(l.state)).length;
  const lotsInView = facebookLotsInView(lots, narrowed);
  // Ticks outlive the chip — it never touches `ticked` — and what is counted and handed to *Sell…* is the
  // ticked lots in view. The chip hides only lots that can no longer be sold, which never count anyway.
  const tickedLots = lotsInView.filter((l) => ticked.has(l.offerId) && !isTerminalState(l.state));

  if (isLoading) return <p style={MUTED}>Loading…</p>;
  if (isError || !screen) {
    // A post left with no lot is removed — deleted, or its offer joined another post (#2116) — and its
    // address goes with it.
    return (
      <p style={MUTED}>
        This post no longer exists — it was deleted, or its offer joined another post.{" "}
        <Link href={`/c/${collectionSlug}/offers`} style={LINK}>
          Back to offers
        </Link>
      </p>
    );
  }

  const { kit, postNo, title, translations, lotTexts } = screen;
  const moves = facebookPostMoves(lots);
  const stage = facebookPostStage(lots);
  const pendingLot = lots.find((l) => l.state === "pending");
  // What *New lot…* fixes (#2291): the post's platform and group, its lots' type unless the group mixes
  // them, and the closing time its auctions share.
  const newLotPost: NewLotPost = {
    postId,
    postNo,
    platform: screen.platform,
    groupId: kit.group.id,
    listingType: !screen.mixedListingTypes && serverLots.length > 0 ? serverLots[0].listingType : null,
    endsAt: serverLots.find((l) => isAuctionListing(l.listingType) && l.endsAt !== null)?.endsAt ?? null,
  };
  const postLink = facebookPostLink(lots);

  function close() {
    if (isPending) return;
    setDialog({ kind: "none" });
    setError(undefined);
  }

  function run(task: () => Promise<{ status: "success" } | { status: "error"; message: string }>, done: string, then?: () => void) {
    setError(undefined);
    startTransition(async () => {
      const result = await task();
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDialog({ kind: "none" });
      invalidateAll(collectionId);
      toast({ message: done });
      then?.();
    });
  }

  // The whole post is moved by asking any lot of it; approving asks a pending one, so the dialog's
  // closing-time question reads the post's pending auctions (#1779).
  function publish(url: string, target: PublishTarget, endsAt?: string) {
    const approving = dialog.kind === "publish" && dialog.approving;
    const via = approving && pendingLot ? pendingLot.offerId : lots[0].offerId;
    run(
      async () => {
        const { publishOfferAction } = await import("@/app/actions/offers");
        return publishOfferAction(via, url, target, endsAt);
      },
      // A lot sold or withdrawn while the post waited stays as it is (#2290).
      approving
        ? lots.some((l) => isFacebookLotClosed(l.state))
          ? `Post #${postNo} approved — the lots that were waiting are up`
          : `Post #${postNo} approved — all its lots are up`
        : target === "pending"
          ? `Post #${postNo} submitted — waiting for the group's approval`
          : lots.length > 1
            ? `Post #${postNo} is up — all ${lots.length} lots active`
            : `Post #${postNo} is up`
    );
  }

  // A translation entered from a lot's row is the entity's own; the lots' titles and descriptions are then
  // re-rendered so the post's text and captions read it at once (#1889).
  function refreshTexts() {
    startTransition(async () => {
      const { refreshFacebookPostTextsAction } = await import("@/app/actions/facebook");
      const result = await refreshFacebookPostTextsAction(postId);
      if (result.status === "error") toast({ message: result.message, tone: "error" });
      invalidateAll(collectionId);
    });
  }

  // The lots whose photos are being made — *Publish…* waits for them (#2114).
  const photoRunLots = lots.filter((l) => prepareRows?.[l.offerId]?.readyBlockers.some(isPhotoRunBlocker));
  const publishHeld =
    photoRunLots.length > 0
      ? `Waiting for the photos of ${photoRunLots.map((l) => `lot ${l.lotNo ?? lots.indexOf(l) + 1}`).join(", ")} — Publish once they are done, so the new ones go up.`
      : null;
  const gapsByKey = new Map((translations?.gaps ?? []).map((g) => [gapKey(g), g]));
  const untranslatedOf = (lot: FacebookKitLot): TitleFallback[] =>
    (translations?.byLot[lot.offerId] ?? []).flatMap((key) => gapsByKey.get(key) ?? []);
  const needingTranslation = translations?.language ? lots.filter((l) => untranslatedOf(l).length > 0) : [];

  // The next row needing a translation after the one last stepped to, in lot order, round to the first.
  function stepToNext() {
    const from = steppedTo ? lots.findIndex((l) => l.offerId === steppedTo) : -1;
    const next = needingTranslation.find((l) => lots.indexOf(l) > from) ?? needingTranslation[0];
    if (!next) return;
    setSteppedTo(next.offerId);
    rowRefs.current.get(next.offerId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Said where it was typed rather than in the moves' card: a refused title is the heading's (#1862).
  function rename(next: string) {
    startTransition(async () => {
      const { setFacebookPostTitleAction } = await import("@/app/actions/facebook");
      const result = await setFacebookPostTitleAction(postId, next);
      if (result.status === "error") {
        toast({ message: result.message, tone: "error" });
        return;
      }
      invalidateAll(collectionId);
      toast({ message: `Post #${postNo} is now called ${next.trim()}` });
    });
  }

  function setLotState(offerId: string, next: "preparing" | "ready" | "withdrawn", done: string) {
    run(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      return setOfferStateAction(offerId, next);
    }, done);
  }

  // One lot back to Preparing (#2115) is that lot's change alone, and settles only its row (#2221).
  function backToPreparingLot(offerId: string, done: string) {
    setError(undefined);
    startTransition(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(offerId, "preparing");
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      await settlePostLot(collectionId, postId, offerId);
      toast({ message: done });
    });
  }

  // Every Ready lot back to Preparing (#2115), each as its own *Back to preparing* leaves it.
  function backToPreparing() {
    setError(undefined);
    startTransition(async () => {
      const { takeFacebookPostBackToPreparingAction } = await import("@/app/actions/facebook");
      const result = await takeFacebookPostBackToPreparingAction(postId);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      invalidateAll(collectionId);
      toast({
        message:
          result.count === 1
            ? `Post #${postNo}: 1 lot back to Preparing`
            : `Post #${postNo}: ${result.count} lots back to Preparing`,
      });
    });
  }

  // Asked of any lot (#1998); a split post's lots are Ready in a new post, which is where the screen goes.
  function backToReady() {
    setError(undefined);
    startTransition(async () => {
      const { takeFacebookPostBackToReadyAction } = await import("@/app/actions/facebook");
      const result = await takeFacebookPostBackToReadyAction(lots[0].offerId);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDialog({ kind: "none" });
      invalidateAll(collectionId);
      toast({ message: backToReadyDone(result) });
      if (result.postNo !== postNo) router.push(`/c/${collectionSlug}/offers/posts/${result.postNo}`);
    });
  }

  function takeOut(lot: FacebookKitLot) {
    // The lot taken out is a post of one of its own, and this post stays — with one lot left, a post of
    // one (#2116). Only a post of several offers it, so the screen always has a post to show.
    run(
      async () => {
        const { removeFacebookLotAction } = await import("@/app/actions/facebook");
        return removeFacebookLotAction(lot.offerId);
      },
      `Offer #${lot.offerNo} taken out of post #${postNo} — it is a post of its own now`
    );
  }

  // The picked offers join as the post's next lots (#1870); the ones that cannot are named under the
  // lots' heading, the rest added — or, when none can, the dialog keeps the reason.
  function addLots(offerIds: string[]) {
    setError(undefined);
    setNotAdded(null);
    startTransition(async () => {
      const { addFacebookLotsAction } = await import("@/app/actions/facebook");
      const result = await addFacebookLotsAction(postId, offerIds);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDialog({ kind: "none" });
      invalidateAll(collectionId);
      setNotAdded(result.notAdded);
      const added = result.added;
      toast({
        message:
          added.length === 1
            ? `Offer #${added[0].offerNo} is now lot ${added[0].lotNo}`
            : `${added.length} offers are now lots ${added[0].lotNo}–${added[added.length - 1].lotNo}`,
      });
    });
  }

  function toggleTicked(offerId: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(offerId)) next.delete(offerId);
      else next.add(offerId);
      return next;
    });
  }

  // What a lot's row says of it (#1863): its type, its price once it is no longer typed in the row, its
  // state, its listing link, its sale, and — while the post is not up — its texts and untranslated names.
  function lotFacts(lot: FacebookKitLot, priced: boolean): LotFact[] {
    const price = facebookLotPrice(lot);
    const untranslated = translations?.language ? untranslatedOf(lot) : [];
    return [
      { key: "type", label: "Type", value: OFFER_LISTING_TYPE_LABEL[lot.listingType] },
      ...(priced ? [] : [priceFact(price.label, price.amount, lot.currency)]),
      stateFact(lot.state),
      {
        key: "link",
        label: "Link",
        value: lot.url ? (
          <>
            <a href={lot.url} target="_blank" rel="noreferrer" style={LINK}>
              link ↗
            </a>
            {lot.state === "pending" && <> <PendingLinkMark /></>}
          </>
        ) : (
          <span style={MUTED}>—</span>
        ),
      },
      saleFact(collectionSlug, screen!.sales[lot.offerId] ?? []),
      ...textFacts(lotTexts?.[lot.offerId] ?? null),
      ...(translations?.language && untranslated.length > 0
        ? [
            {
              key: "untranslated",
              label: "Untranslated",
              tone: "warning" as const,
              value: (
                <TranslationGapLinks
                  collectionId={collectionId}
                  language={translations.language}
                  gaps={untranslated}
                  withLanguage={false}
                  onSaved={refreshTexts}
                />
              ),
            },
          ]
        : []),
    ];
  }

  function lotActions(lot: FacebookKitLot): RowAction[] {
    const terminal = lot.state === "sold" || lot.state === "withdrawn";
    return [
      { key: "open", label: "Open offer", icon: "externalLink", href: `/c/${collectionSlug}/offers/${lot.offerId}` },
      ...(!terminal
        ? [{ key: "sell", label: "Sell", icon: "sell", onSelect: () => setDialog({ kind: "sell", lots: [lot] }) } as RowAction]
        : []),
      // Withdrawing one lot is the lot's own once the post is up (#1779); a pending post is withdrawn
      // whole, from the post's own moves.
      ...(lot.state !== "pending" && !notUp && manualTransitions(lot.state).includes("withdrawn")
        ? [
            {
              key: "withdraw",
              label: "Withdraw this lot…",
              icon: "withdraw",
              danger: true,
              onSelect: () => setDialog({ kind: "withdrawLot", lot }),
            } as RowAction,
          ]
        : []),
      // One Ready lot back to Preparing, while the post is not up (#2115) — the offer's own step.
      ...(notUp && lot.state === "ready"
        ? [
            {
              key: "back-to-preparing",
              label: "Back to preparing",
              icon: "revert",
              onSelect: () => backToPreparingLot(lot.offerId, `Lot ${lot.lotNo ?? lots.indexOf(lot) + 1} is back to Preparing`),
            } as RowAction,
          ]
        : []),
      ...(moves.takeOut
        ? [
            {
              key: "take-out",
              label: "Take this lot out of the post",
              icon: "remove",
              onSelect: () => setDialog({ kind: "takeOut", lot }),
            } as RowAction,
          ]
        : []),
    ];
  }

  const anyMove = moves.activate || moves.approve || moves.reject || moves.withdraw || moves.backToReady;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <header>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <InlineText
              value={title ?? ""}
              placeholder="Post title"
              display={
                <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
                  Post #{postNo}
                  {title ? (
                    <> · {title}</>
                  ) : (
                    <span style={{ ...MUTED, fontSize: "0.875rem", fontWeight: 400, marginLeft: "0.5rem" }}>no title</span>
                  )}
                </h2>
              }
              editable
              isPending={isPending}
              inputType="text"
              editControl
              editAriaLabel={title ? "Rename this post" : "Give this post a title"}
              selectOnEdit
              onSave={rename}
            />
          </div>
          <RowActionsMenu
            ariaLabel="Post actions"
            actions={[
              // Once the post is Ready, and while it waits or is up (#2212) — or whenever it has a link,
              // so the link can be withdrawn in any stage.
              ...(canPreviewFacebookPost(lots) || screen.hasPreviewLink
                ? [{ key: "preview", label: "Preview for a buyer…", icon: "share", onSelect: () => setDialog({ kind: "preview" }) } as RowAction]
                : []),
              // In any stage, as long as no lot has sold (#2060) — the dialog says so otherwise.
              { key: "delete", label: "Delete post…", icon: "delete", danger: true, onSelect: () => setDialog({ kind: "deletePost" }) },
            ]}
          />
        </div>
        <p style={{ ...MUTED, margin: "0.25rem 0 0" }}>
          {lots.length > 1
            ? `A Facebook post of ${lots.length} lots in `
            : lots.length === 0
              ? "A Facebook post with no lots yet, in "
              : "A Facebook post of one offer, posted alone, in "}
          <a href={kit.group.url} target="_blank" rel="noreferrer" style={LINK}>
            {kit.group.name} ↗
          </a>
          {kit.group.archived && " (archived)"} · {FACEBOOK_POST_STAGE_LABEL[stage]}
          {postLink && (
            <>
              {" "}
              ·{" "}
              <a href={postLink} target="_blank" rel="noreferrer" style={LINK}>
                {stage === "pending" ? "pending post" : "post"} ↗
              </a>
            </>
          )}{" "}
          ·{" "}
          <Link href={`/c/${collectionSlug}/offers?post=${postNo}`} style={LINK}>
            Show these lots in Offers
          </Link>
        </p>
      </header>

      {/* The moves the post makes as one (#1778, #1779). */}
      <section style={CARD} aria-label="The post's moves">
        <h3 style={CARD_TITLE}>The post</h3>
        {(anyMove || moves.backToPreparing) && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {/* One door (#1847): live or waiting for the group's approval is chosen in the dialog. */}
            {moves.activate && (
              <DialogSecondaryButton
                type="button"
                disabled={isPending || publishHeld !== null}
                onClick={() => setDialog({ kind: "publish", target: "active", approving: false })}
              >
                Publish…
              </DialogSecondaryButton>
            )}
            {moves.activate && publishHeld && <span style={MUTED}>{publishHeld}</span>}
            {moves.approve && (
              <DialogSecondaryButton
                type="button"
                disabled={isPending}
                onClick={() => setDialog({ kind: "publish", target: "active", approving: true })}
              >
                Approved…
              </DialogSecondaryButton>
            )}
            {moves.reject && (
              <DialogSecondaryButton type="button" disabled={isPending} onClick={() => setDialog({ kind: "reject" })}>
                Rejected — back to Ready
              </DialogSecondaryButton>
            )}
            {moves.withdraw && (
              <DialogSecondaryButton
                type="button"
                disabled={isPending}
                onClick={() => setDialog({ kind: "withdrawPost" })}
              >
                Withdraw…
              </DialogSecondaryButton>
            )}
            {moves.backToReady && (
              <>
                <DialogSecondaryButton type="button" disabled={isPending} onClick={() => setDialog({ kind: "backToReady" })}>
                  Back to Ready…
                </DialogSecondaryButton>
                <span style={MUTED}>Published by mistake, or gone from the group.</span>
              </>
            )}
            {moves.backToPreparing && (
              <DialogSecondaryButton type="button" disabled={isPending} onClick={backToPreparing}>
                Back to preparing
              </DialogSecondaryButton>
            )}
          </div>
        )}
        {/* A post still being prepared can have Ready lots to take back and lots still short of Ready. */}
        {!anyMove && (
          <p style={{ ...MUTED, margin: moves.backToPreparing ? "0.5rem 0 0" : 0 }}>
            {moves.waiting.length > 0
              ? `Every lot must be Ready before the post goes up: ${moves.waiting.map((n) => `lot ${n}`).join(", ")}.`
              : lots.length === 0
                ? "No lots yet — make them with New lot…, or add offers that exist with Add lots…."
                : "Every lot is sold or withdrawn."}
          </p>
        )}
        {error && dialog.kind === "none" && (
          <p role="alert" style={{ color: "var(--color-error)", fontSize: "0.8125rem", margin: "0.5rem 0 0" }}>
            {error}
          </p>
        )}
      </section>

      {/* The kit's post-wide part — layout, text, photos' ZIP — and under it the lots, in lot order, each
          row carrying everything about its lot: what it puts up and where it stands (#1863). */}
      <section style={CARD} aria-label="Post kit and lots">
        <h3 style={CARD_TITLE}>Post kit</h3>
        <FacebookPostKit
          collectionSlug={collectionSlug}
          kit={kit}
          photos={screen.photos}
          selfOfferId={null}
          onChanged={() => invalidateAll(collectionId)}
          renderLots={(lotKit) => (
            <>
              {translations?.language && needingTranslation.length > 0 && (
                <p role="status" style={{ color: "var(--color-warning)", fontSize: "0.8125rem", margin: "1.25rem 0 0" }}>
                  {needingTranslation.length === 1 ? "1 lot has" : `${needingTranslation.length} lots have`} names with
                  no {languageLabel(translations.language)} translation — the default text is printed.{" "}
                  <button type="button" style={STEP_LINK} onClick={stepToNext}>
                    Next lot ↓
                  </button>
                </p>
              )}
              {tools.textWarning}
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  margin: "1.25rem 0 0",
                }}
              >
                <h3 style={{ ...CARD_TITLE, margin: 0 }}>Lots</h3>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "0.5rem" }}>
                  {tools.headingButtons}
                  {moves.addLots && (
                    <DialogSecondaryButton
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setError(undefined);
                        setDialog({ kind: "addLots" });
                      }}
                    >
                      Add lots…
                    </DialogSecondaryButton>
                  )}
                  {/* A new offer made as the post's next lot (#2291), from copies in the app or a new item. */}
                  {moves.addLots && (
                    <>
                      <DialogSecondaryButton
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          setError(undefined);
                          setDialog({ kind: "newLot", source: "copies" });
                        }}
                      >
                        New lot…
                      </DialogSecondaryButton>
                      <Tooltip content="A lot of a stamp not yet in the app: its copy is made first, For sale, then the lot from it.">
                        <DialogSecondaryButton
                          type="button"
                          disabled={isPending}
                          onClick={() => {
                            setError(undefined);
                            setDialog({ kind: "newLot", source: "newItem" });
                          }}
                        >
                          New lot from a new item…
                        </DialogSecondaryButton>
                      </Tooltip>
                    </>
                  )}
                </div>
              </div>
              {/* What the lots come to (#2326), whatever the post's state. */}
              <div style={{ margin: "0.75rem 0 0" }}>
                <LotGroupSummaryBar collectionId={collectionId} group={{ kind: "post", id: postId }} />
              </div>
              {notAdded && (
                <p role="status" style={{ color: "var(--color-warning)", fontSize: "0.8125rem", margin: "0.5rem 0 0" }}>
                  {notAdded}
                </p>
              )}
              {tools.lotBar}
              {narrowable && (
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem 0.75rem", margin: "0.75rem 0 0" }}>
                  <FilterChip
                    label="Still for sale"
                    count={forSaleCount}
                    active={narrowed}
                    toggle
                    onClick={() => setStillForSale(!stillForSale)}
                  />
                  {narrowed && (
                    <span role="status" style={MUTED}>
                      {forSaleCount === 0
                        ? `No lot is still for sale — all ${lots.length} are sold or withdrawn.`
                        : `Showing ${forSaleCount} of ${lots.length} lots — the sold and withdrawn are hidden.`}
                    </span>
                  )}
                </div>
              )}
              {/* Lots ticked to be sold to one buyer (#2050), one sale for all of them. */}
              {tickedLots.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", margin: "0.75rem 0 0", fontSize: "0.8125rem" }}>
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    {tickedLots.length} lot{tickedLots.length === 1 ? "" : "s"} ticked
                  </span>
                  <Tooltip content="Sell the ticked lots into one sale — an open one or a new one — each at its own price.">
                    <DialogSecondaryButton
                      type="button"
                      disabled={isPending}
                      onClick={() => setDialog({ kind: "sell", lots: tickedLots })}
                    >
                      <Icon name="sell" size="sm" /> Sell…
                    </DialogSecondaryButton>
                  </Tooltip>
                  <button type="button" style={STEP_LINK} onClick={() => setTicked(new Set())}>
                    Clear
                  </button>
                </div>
              )}
              {/* The lots and, under them, the post's totals (#2218) — one box, so the bar is pinned to the
                  window's bottom edge only while some lot is on screen. */}
              <div>
                {lots.length === 0 && <p style={{ ...MUTED, margin: "0.75rem 0 0" }}>No lots yet.</p>}
                <ol style={LOT_LIST} {...(drag?.containerProps ?? {})}>
                  {lotsInView.map((lot, index) => {
                    const { photos, caption } = lotKit(lot);
                    const pricing = tools.rowPricing(lot, {
                      onPriceDraft: (text) => {
                        const row = prepareRows?.[lot.offerId];
                        if (!row) return;
                        setPriceDrafts((prev) => new Map(prev).set(lot.offerId, { text, from: statedPrice(row) }));
                      },
                      onPriceSaved: (field, value) => void settlePostLotPrice(collectionId, postId, lot.offerId, field, value),
                      onTitleChanged: () => void settlePostLot(collectionId, postId, lot.offerId),
                    });
                    return (
                      <Fragment key={lot.offerId}>
                        {showLineAt(drag, index) && <DropLine />}
                        <GroupLotRow
                          lotNo={tools.lotNoAt(lot, index)}
                          drag={drag}
                          index={index}
                          rowRef={(el) => {
                            if (el) rowRefs.current.set(lot.offerId, el);
                            else rowRefs.current.delete(lot.offerId);
                          }}
                          collectionSlug={collectionSlug}
                          lot={lot}
                          photos={photos}
                          // Captioned, the lot's one photo; as text, its upload set, wrapping within the row.
                          photoStyle={{ flex: caption ? `0 0 ${PHOTO_SIZE}` : "0 1 auto", minWidth: PHOTO_SIZE }}
                          caption={caption}
                          facts={lotFacts(lot, !!pricing)}
                          actions={lotActions(lot)}
                          select={{
                            ticked: isTerminalState(lot.state) ? null : ticked.has(lot.offerId),
                            onToggle: () => toggleTicked(lot.offerId),
                          }}
                          pricing={pricing}
                        />
                      </Fragment>
                    );
                  })}
                  {showLineAt(drag, lotsInView.length) && <DropLine />}
                </ol>
                {prepareRows && tools.prepared.length > 0 && (
                  <PostPriceTotalsBar
                    totals={postPriceTotals(tools.prepared, priceDrafts, tools.prepared[0].currency)}
                  />
                )}
              </div>
            </>
          )}
        />
      </section>

      {dialog.kind === "publish" && (
        <ActivateOfferDialog
          offerLabel={`Post #${postNo}`}
          platformName={screen.platform.name}
          initialUrl={dialog.approving ? postLink : null}
          facebookLots={lots.length}
          facebookClosedLots={dialog.approving ? lots.filter((l) => isFacebookLotClosed(l.state)).length : 0}
          initialTarget={dialog.target}
          approving={dialog.approving}
          canWait={moves.submit}
          offerId={dialog.approving ? pendingLot?.offerId : undefined}
          isPending={isPending}
          error={error}
          onClose={close}
          onConfirm={publish}
        />
      )}

      {dialog.kind === "reject" && pendingLot && (
        <ConfirmDialog
          title="Rejected by the group"
          message="Every lot of this post waiting for approval goes back to Ready, its pending link cleared — ready to post again."
          actionLabel="Back to Ready"
          pendingLabel="Saving…"
          variant="primary"
          isPending={isPending}
          error={error}
          onClose={close}
          onConfirm={() => setLotState(pendingLot.offerId, "ready", `Post #${postNo} is back to Ready`)}
        />
      )}

      {dialog.kind === "backToReady" && (
        <BackToReadyDialog
          postNo={postNo}
          lots={lots}
          isPending={isPending}
          error={error}
          onClose={close}
          onConfirm={backToReady}
        />
      )}

      {dialog.kind === "withdrawPost" && pendingLot && (
        <ConfirmDialog
          title="Withdraw post"
          message="This takes the post back from the group: every lot of it still waiting for approval is withdrawn. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
          actionLabel="Withdraw"
          pendingLabel="Withdrawing…"
          isPending={isPending}
          error={error}
          onClose={close}
          onConfirm={() => setLotState(pendingLot.offerId, "withdrawn", `Post #${postNo} withdrawn`)}
        />
      )}

      {dialog.kind === "withdrawLot" && (
        <ConfirmDialog
          title={dialog.lot.lotNo === null ? `Withdraw offer #${dialog.lot.offerNo}` : `Withdraw lot ${dialog.lot.lotNo}`}
          message={
            lots.length > 1
              ? "This lot is no longer for sale; the post and its other lots stay up. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
              : "This takes the listing down. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
          }
          actionLabel="Withdraw"
          pendingLabel="Withdrawing…"
          isPending={isPending}
          error={error}
          onClose={close}
          onConfirm={() => setLotState(dialog.lot.offerId, "withdrawn", `Offer #${dialog.lot.offerNo} withdrawn`)}
        />
      )}

      {dialog.kind === "takeOut" && (
        <ConfirmDialog
          title={
            dialog.lot.lotNo === null ? `Take offer #${dialog.lot.offerNo} out of the post` : `Take lot ${dialog.lot.lotNo} out of the post`
          }
          message="The lots after it move up one. The offer itself is untouched and becomes a post of its own, titled with its own title."
          actionLabel="Take out"
          pendingLabel="Taking out…"
          variant="primary"
          isPending={isPending}
          error={error}
          onClose={close}
          onConfirm={() => takeOut(dialog.lot)}
        />
      )}

      {dialog.kind === "newLot" && (
        <NewLotFlow
          collectionId={collectionId}
          areas={areas}
          locations={locations}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          baseCurrency={baseCurrency}
          post={newLotPost}
          source={dialog.source}
          onCreated={(created) => {
            invalidateAll(collectionId);
            toast({ message: `Offer #${created.offerNo} is now lot ${created.lotNo}` });
          }}
          onClose={close}
        />
      )}

      {dialog.kind === "addLots" && (
        <AddLotsDialog
          collectionId={collectionId}
          postId={postId}
          postNo={postNo}
          nextLotNo={Math.max(lots.length, ...lots.map((l) => l.lotNo ?? 0)) + 1}
          isPending={isPending}
          error={error}
          onCancel={close}
          onSubmit={addLots}
        />
      )}

      {tools.dialogs}

      {dialog.kind === "preview" && (
        <PostPreviewDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          postId={postId}
          postNo={postNo}
          onClose={() => setDialog({ kind: "none" })}
          onChanged={() => void invalidateAll(collectionId)}
        />
      )}

      {dialog.kind === "deletePost" && (
        <DeleteFacebookPostDialog
          postId={postId}
          onClose={() => setDialog({ kind: "none" })}
          onDeleted={(deleted) => {
            toast({ message: deletedPostMessage(deleted) });
            router.push(`/c/${collectionSlug}/offers/posts`);
            void invalidateAll(collectionId);
          }}
        />
      )}

      {/* One lot's Sell, or the ticked lots' (#2050) — one sale either way, and the screen stays (#2049). */}
      {dialog.kind === "sell" && (
        <SellOfferFlowDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          baseCurrency={baseCurrency}
          today={today}
          offers={dialog.lots.map(
            (lot): SellableOfferSubject => ({
              id: lot.offerId,
              offerNo: lot.offerNo,
              name: null,
              label: lot.title,
              platformId: screen.platform.id,
              platformName: screen.platform.name,
              price: lot.price,
              currency: lot.currency,
              facebookGroupId: kit.group.id,
              closed: isTerminalState(lot.state),
            })
          )}
          onSold={(ids) =>
            setTicked((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
          }
          onClose={() => setDialog({ kind: "none" })}
        />
      )}
    </div>
  );
}
