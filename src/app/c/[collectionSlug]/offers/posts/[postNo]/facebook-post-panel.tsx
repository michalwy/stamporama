"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FACEBOOK_LOT_SORT_LABEL,
  FACEBOOK_LOT_SORTS,
  FACEBOOK_POST_STAGE_LABEL,
  facebookLotPrice,
  facebookPostLink,
  facebookPostMoves,
  facebookPostStage,
  isFacebookLotPosted,
  sortFacebookLots,
  type FacebookLotSort,
  type FacebookTitleEdge,
  type FacebookTitleWordsMode,
} from "@/lib/facebook-post-rules";
import type { FacebookKitLot } from "@/lib/facebook-auctions";
import { languageLabel } from "@/lib/languages";
import type { OfferTextStatus, PrepareOffer } from "@/lib/offers";
import type { TitleFallback } from "@/lib/offer-title-template";
import { facebookLotsInView, isFacebookLotForSale } from "@/lib/facebook-post-ui-state";
import { isTerminalState, manualTransitions, OFFER_LISTING_TYPE_LABEL, pricingReadyFor } from "@/lib/offer-rules";
import { isCoverReadinessBlocker, isPhotoRunBlocker } from "@/lib/offer-photo-readiness";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { ConfirmDialog, DialogSecondaryButton } from "@/app/dialog-shell";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { InlineText } from "@/app/c/[collectionSlug]/shared/inline-text";
import { CheckCell } from "@/app/c/[collectionSlug]/shared/cell-target";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import {
  DragGrip,
  dragStyle,
  InsertionLine,
  showLineAt,
  useReorderList,
  type DragList,
} from "@/app/c/[collectionSlug]/shared/reorder-list";
import { TranslationGapLinks } from "@/app/c/[collectionSlug]/shared/title-preview";
import { gapKey } from "@/app/c/[collectionSlug]/shared/translation-gaps";
import { useToast } from "@/app/toast-provider";
import { ActivateOfferDialog, type PublishTarget } from "../../activate-offer-dialog";
import { BackToReadyDialog, backToReadyDone } from "../../back-to-ready-dialog";
import { OfferStateChip, PendingLinkMark } from "../../offer-badges";
import { SellOfferFlowDialog, type SellableOfferSubject } from "../../sell-offer-flow-dialog";
import { useFacebookPostLotsPrepare, useFacebookPostScreen, useInvalidateOffers } from "../../use-offers-query";
import { FacebookPostKit, PHOTO_SIZE } from "../../[offerId]/facebook-post-kit";
import { OfferCoverWalk, OffersCoverWalk } from "../../[offerId]/offer-cover-walk";
import { PreparePriceField, PrepareReadiness, PrepareTitleField } from "../../prepare/prepare-offer-parts";
import { DeleteFacebookPostDialog, deletedPostMessage } from "../delete-post-dialog";
import { AddLotsDialog } from "./add-lots-dialog";
import { PostPhotoSettingsButton } from "./post-photo-settings";
import { RegenerateLotTextsDialog, type RegenerateScope } from "./regenerate-lot-texts-dialog";
import { LotTitleTemplateDialog, LotTitleWordsDialog } from "./lot-titles-dialogs";
import { useFacebookPostStillForSale } from "./post-ui-state";

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
// - **The lots**, listed once (#1863), in lot order and so in posting order: each row is the lot's
//   photo (its upload set, laid out as text), the lot number, the offer (linking to it), its type, its
//   price — an auction's current bid once one is recorded, else its starting price — its state, its
//   listing link, its sale once sold, and, captioned (#1841), its caption with its *Copy*. Each lot's
//   own actions stay the offer's (*Sell*, withdrawing one lot of a post that is up) and are reached
//   from its row's `⋮`, as is *Take this lot out of the post* while the post is not up.
// - **Add lots…** (#1870), beside the lots' heading while the post is not up: offers picked from those
//   that could join become its next lots, and any the server turns away is named under the heading.
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
//   one dialog — the sides to photograph, say — and their photos regenerated, instead of each offer's.
// - **Pricing and readying the lots** (#2031), while the post is not up — the Prepare screen's work, for
//   this post's lots: each row carries the compact price table with the lot's own price typed in it
//   (Enter saves it and moves down to the next lot's), its title edited in place, and what still stops
//   it from being marked ready, covers checked from the row. Above the lots, *Use estimated price*,
//   *Check covers* and *Mark ready* act on every lot of the post; a lot that cannot be readied is named
//   with its reason. The rows are read apart from the screen (`getFacebookPostLotsPrepare`), so a price
//   saved settles its own row and refreshes only the kit. Once the post is up the rows show what they
//   showed before: pricing and readying belong to before.
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

// The post's lots (#1863): one row per lot, which wraps onto the next line rather than shrinking the
// photo — large enough to recognise the stamps — or the caption.
const LOT_LIST: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0 };

const LOT_ROW_PAD = "0.875rem";

// The tick cell comes first and runs the row's whole height (#2082, as on every list row, #1589), so
// the row itself does not wrap: what follows the cell does, in `LOT_BODY`.
const LOT_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  padding: `${LOT_ROW_PAD} 0`,
  borderBottom: "1px solid var(--color-border)",
};

const LOT_BODY: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-start",
  gap: "0.75rem 1.25rem",
};

const LOT_FACTS: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "0.25rem 0.75rem",
  margin: "0.5rem 0 0",
  fontSize: "0.875rem",
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
  | { kind: "regenerate"; scope: RegenerateScope }
  | { kind: "titleTemplate" }
  | { kind: "titleWords"; mode: FacebookTitleWordsMode }
  | { kind: "sell"; lots: FacebookKitLot[] }
  | { kind: "deletePost" };

/** What a run over the post's lots could not do, named against its lot (#323's rule, #2031). */
interface LotSkip {
  offerId: string;
  message: string;
}

/** Which covers walk is open (#2031): one lot's, from its row, or every lot's in one pass — the photos
 *  not yet checked, or every one again on Ready lots (#2114). */
type CoverWalk =
  | { kind: "lot"; offerId: string; mode: "unchecked" | "all"; includeOtherAreas: boolean }
  | { kind: "post"; offers: { id: string; offerNo: number }[]; mode: "unchecked" | "all" };

/** The lot has no stated price yet — the figure *Use estimated price* fills. */
function unpriced(offer: PrepareOffer): boolean {
  return !pricingReadyFor(offer.listingType, "ready", offer.price, offer.startingPrice);
}

/** How many of the lot's photos its ready gate still wants checked for symbols (#1665). */
function uncheckedCovers(offer: PrepareOffer): number {
  return offer.readyBlockers.find(isCoverReadinessBlocker)?.count ?? 0;
}

export function FacebookPostPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  postId,
  today,
}: {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  postId: string;
  /** Server-computed "today", for *Sell*'s new-sale step — as the offer screen passes it. */
  today: string;
}) {
  const router = useRouter();
  const { data: screen, isLoading, isError } = useFacebookPostScreen(collectionId, postId);
  const { invalidateAll, settlePostLotPrice } = useInvalidateOffers();
  // The lots as Prepare rows (#2031), asked only while the post is not up.
  const notUp = !!screen && !screen.kit.lots.some((l) => isFacebookLotPosted(l.state));
  const { data: prepare } = useFacebookPostLotsPrepare(collectionId, postId, notUp);
  const prepareRows = notUp ? (prepare ?? null) : null;
  const [lotSkips, setLotSkips] = useState<LotSkip[]>([]);
  const [coverWalk, setCoverWalk] = useState<CoverWalk | null>(null);
  // The lots' price fields, by offer id — Enter moves down them in lot order (#2031).
  const priceInputs = useRef(new Map<string, HTMLInputElement>());
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
  // The order just asked for (#1986), drawn until the screen is read again — so a dragged row stays
  // where it was dropped rather than jumping back for the round trip.
  const [movedOrder, setMovedOrder] = useState<string[] | null>(null);
  // The lots ticked to be sold together (#2050), by offer id. Only a lot that can still be sold has a
  // box; one that has sold since it was ticked simply drops out of `tickedLots`.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());

  const serverLots = screen?.kit.lots ?? [];
  const lots = movedOrder
    ? movedOrder.flatMap((id) => serverLots.find((l) => l.offerId === id) ?? [])
    : serverLots;
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
  const reorderable = serverLots.length > 1 && !serverLots.some((l) => isFacebookLotPosted(l.state));

  // The lots in their new order, numbered from it (#1986); the server writes the numbers.
  function reorder(offerIds: string[]) {
    if (!screen || isPending || offerIds.every((id, i) => id === lots[i]?.offerId)) return;
    setError(undefined);
    setMovedOrder(offerIds);
    startTransition(async () => {
      const { reorderFacebookLotsAction } = await import("@/app/actions/facebook");
      const result = await reorderFacebookLotsAction(postId, offerIds);
      if (result.status === "error") toast({ message: result.message, tone: "error" });
      await invalidateAll(collectionId);
      setMovedOrder(null);
    });
  }

  const drag = useReorderList(
    reorderable,
    (from, to) => {
      const next = lots.map((l) => l.offerId);
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      reorder(next);
    },
    { handleOnly: true }
  );

  function sortLots(by: FacebookLotSort) {
    reorder(sortFacebookLots(lots, by));
  }

  // Enter in a lot's price field: the next lot's, in the order drawn; the last one is left, which saves it.
  function focusAfter(offerId: string) {
    const index = lots.findIndex((l) => l.offerId === offerId);
    const next = lots.slice(index + 1).find((l) => priceInputs.current.has(l.offerId));
    const el = next ? priceInputs.current.get(next.offerId) : undefined;
    if (el) {
      el.focus();
      el.select();
    } else {
      priceInputs.current.get(offerId)?.blur();
    }
  }

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

  const { kit, postNo, title, translations, lotTexts, lotTitles } = screen;
  const moves = facebookPostMoves(lots);
  const stage = facebookPostStage(lots);
  const pendingLot = lots.find((l) => l.state === "pending");
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
      approving
        ? `Post #${postNo} approved — all its lots are up`
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

  // The lots' titles and descriptions from their templates (#1983); the ticked hand-written ones too.
  function regenerate(offerIds: string[], overwrite: string[]) {
    setError(undefined);
    startTransition(async () => {
      const { regenerateFacebookLotTextsAction } = await import("@/app/actions/facebook");
      const result = await regenerateFacebookLotTextsAction(postId, offerIds, overwrite);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDialog({ kind: "none" });
      invalidateAll(collectionId);
      toast({ message: result.count === 1 ? "1 lot's texts regenerated" : `${result.count} lots' texts regenerated` });
    });
  }

  // Every lot's title from one template (#2033); the ticked hand-written ones too.
  function retitle(template: string, overwrite: string[]) {
    setError(undefined);
    startTransition(async () => {
      const { setFacebookPostTitleTemplateAction } = await import("@/app/actions/facebook");
      const result = await setFacebookPostTitleTemplateAction(postId, template, overwrite);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDialog({ kind: "none" });
      invalidateAll(collectionId);
      toast({ message: result.count === 1 ? "1 lot's title written from the template" : `${result.count} lots' titles written from the template` });
    });
  }

  // The same words on, or off, the start or end of every lot's title (#2033).
  function changeTitleWords(mode: FacebookTitleWordsMode, words: string, edge: FacebookTitleEdge) {
    setError(undefined);
    startTransition(async () => {
      const { changeFacebookLotTitleWordsAction } = await import("@/app/actions/facebook");
      const result = await changeFacebookLotTitleWordsAction(postId, words, edge, mode);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDialog({ kind: "none" });
      invalidateAll(collectionId);
      toast({ message: result.count === 1 ? "1 title changed" : `${result.count} titles changed` });
    });
  }

  const outOfDateCount = lotTexts ? lots.filter((l) => lotTexts[l.offerId]?.outOfDate).length : 0;

  /* ── Pricing and readying every lot (#2031) — the Prepare screen's bulk actions, over the post ── */
  const prepared = prepareRows ? lots.flatMap((l) => prepareRows[l.offerId] ?? []) : [];
  const estimable = prepared.filter((o) => unpriced(o) && o.suggestedPrice !== null);
  const toCover = prepared.filter((o) => uncheckedCovers(o) > 0);
  const coverCount = toCover.reduce((sum, o) => sum + uncheckedCovers(o), 0);
  const toReady = prepared.filter((o) => lots.find((l) => l.offerId === o.id)?.state === "preparing");
  // With nothing left unchecked, *Check covers* walks every photo of the lots that apply covers again —
  // a cover found wrong at the last look, on a Ready lot (#2114).
  const toReview = prepared.filter((o) => o.covers.needed && o.covers.photoCount > 0);
  const coverWalkOffers = toCover.length > 0 ? toCover : toReview;
  // The lots whose photos are being made — *Publish…* waits for them (#2114).
  const photoRunLots = lots.filter((l) => prepareRows?.[l.offerId]?.readyBlockers.some(isPhotoRunBlocker));
  const publishHeld =
    photoRunLots.length > 0
      ? `Waiting for the photos of ${photoRunLots.map((l) => `lot ${l.lotNo ?? lots.indexOf(l) + 1}`).join(", ")} — Publish once they are done, so the new ones go up.`
      : null;
  const lotNoOf = (offerId: string) => {
    const lot = lots.find((l) => l.offerId === offerId);
    return lot ? `Lot ${lot.lotNo ?? lots.indexOf(lot) + 1}` : "A lot";
  };

  function applyEstimates() {
    if (estimable.length === 0) return;
    setLotSkips([]);
    startTransition(async () => {
      const { applyEstimatedPricesAction } = await import("@/app/actions/offers");
      const result = await applyEstimatedPricesAction(
        collectionId,
        estimable.map((o) => o.id)
      );
      invalidateAll(collectionId);
      setLotSkips(result.skipped);
      const n = result.succeeded.length;
      if (n > 0) toast({ message: `${n} lot${n === 1 ? "" : "s"} priced at ${n === 1 ? "its" : "their"} estimated value` });
    });
  }

  // Every lot still being prepared (#1893): missing photos are generated first and the lot turns Ready
  // once they are done; a lot that cannot be readied is named with its reason.
  function markLotsReady() {
    if (toReady.length === 0) return;
    setLotSkips([]);
    startTransition(async () => {
      const { markOffersReadyAction } = await import("@/app/actions/offers");
      const result = await markOffersReadyAction(toReady.map((o) => o.id));
      invalidateAll(collectionId);
      setLotSkips(result.skipped);
      const waiting = result.awaitingPhotos.length;
      const ready = result.succeeded.length - waiting;
      const parts = [
        ...(ready > 0 ? [`${ready} lot${ready === 1 ? "" : "s"} marked ready`] : []),
        ...(waiting > 0
          ? [`${waiting} ${waiting === 1 ? "turns" : "turn"} ready once ${waiting === 1 ? "its" : "their"} photos are done`]
          : []),
      ];
      if (parts.length > 0) toast({ message: parts.join(" · ") });
    });
  }

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
              onSelect: () => setLotState(lot.offerId, "preparing", `Lot ${lot.lotNo ?? lots.indexOf(lot) + 1} is back to Preparing`),
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
          {/* In any stage, as long as no lot has sold (#2060) — the dialog says so otherwise. */}
          <RowActionsMenu
            ariaLabel="Post actions"
            actions={[
              { key: "delete", label: "Delete post…", icon: "delete", danger: true, onSelect: () => setDialog({ kind: "deletePost" }) },
            ]}
          />
        </div>
        <p style={{ ...MUTED, margin: "0.25rem 0 0" }}>
          {lots.length > 1 ? `A Facebook post of ${lots.length} lots in ` : "A Facebook post of one offer, posted alone, in "}
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
              {outOfDateCount > 0 && (
                <p role="status" style={{ color: "var(--color-warning)", fontSize: "0.8125rem", margin: "0.5rem 0 0" }}>
                  {outOfDateCount === 1 ? "1 lot's text is" : `${outOfDateCount} lots' texts are`} out of date — the
                  templates now give other words.{" "}
                  <button
                    type="button"
                    style={STEP_LINK}
                    disabled={isPending}
                    onClick={() => {
                      setError(undefined);
                      setDialog({ kind: "regenerate", scope: "outOfDate" });
                    }}
                  >
                    Regenerate {outOfDateCount === 1 ? "it" : "them"}…
                  </button>
                </p>
              )}
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
                  {!lots.some((l) => isFacebookLotPosted(l.state)) && (
                    <PostPhotoSettingsButton collectionId={collectionId} postId={postId} disabled={isPending} />
                  )}
                  {lotTitles && (
                    <>
                      <DialogSecondaryButton
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          setError(undefined);
                          setDialog({ kind: "titleTemplate" });
                        }}
                      >
                        Title template for all lots…
                      </DialogSecondaryButton>
                      <DialogSecondaryButton
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          setError(undefined);
                          setDialog({ kind: "titleWords", mode: "add" });
                        }}
                      >
                        Add to titles…
                      </DialogSecondaryButton>
                      <DialogSecondaryButton
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          setError(undefined);
                          setDialog({ kind: "titleWords", mode: "remove" });
                        }}
                      >
                        Remove from titles…
                      </DialogSecondaryButton>
                    </>
                  )}
                  {lotTexts && (
                    <DialogSecondaryButton
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setError(undefined);
                        setDialog({ kind: "regenerate", scope: "all" });
                      }}
                    >
                      Regenerate lot texts…
                    </DialogSecondaryButton>
                  )}
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
                </div>
              </div>
              {notAdded && (
                <p role="status" style={{ color: "var(--color-warning)", fontSize: "0.8125rem", margin: "0.5rem 0 0" }}>
                  {notAdded}
                </p>
              )}
              {prepareRows && (
                <div
                  style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", margin: "0.75rem 0 0" }}
                >
                  <Tooltip
                    content={
                      estimable.length > 0
                        ? "Give the lots that have no price yet their estimated value — catalogue × the learned realisation ratio. Lots with a price keep it."
                        : "No lot is without a price and has an estimated value to take."
                    }
                  >
                    <DialogSecondaryButton
                      type="button"
                      disabled={isPending || estimable.length === 0}
                      onClick={applyEstimates}
                    >
                      Use estimated price{estimable.length > 0 ? ` (${estimable.length})` : ""}
                    </DialogSecondaryButton>
                  </Tooltip>
                  <Tooltip
                    content={
                      toCover.length > 0
                        ? "Go through the lots' photos not yet checked for symbols, lot after lot in one walk — covers carry on from photo to photo."
                        : toReview.length > 0
                          ? "Every photo is checked. Go through them all again, lot after lot — a Ready lot stays Ready and its photos are made again."
                          : "No lot has photos to check for symbols."
                    }
                  >
                    <DialogSecondaryButton
                      type="button"
                      disabled={isPending || coverWalkOffers.length === 0}
                      onClick={() =>
                        setCoverWalk({
                          kind: "post",
                          offers: coverWalkOffers.map((o) => ({ id: o.id, offerNo: o.offerNo })),
                          mode: toCover.length > 0 ? "unchecked" : "all",
                        })
                      }
                    >
                      Check covers{coverCount > 0 ? ` (${coverCount})` : ""}
                    </DialogSecondaryButton>
                  </Tooltip>
                  <Tooltip
                    content={
                      toReady.length > 0
                        ? "Mark every lot still being prepared ready. Missing or out-of-date photos are generated first, and the lot turns ready once they are done; a lot that cannot be readied is named below."
                        : "Every lot is ready."
                    }
                  >
                    <DialogSecondaryButton type="button" disabled={isPending || toReady.length === 0} onClick={markLotsReady}>
                      <Icon name="check" size="sm" /> Mark ready{toReady.length > 0 ? ` (${toReady.length})` : ""}
                    </DialogSecondaryButton>
                  </Tooltip>
                  <span style={MUTED}>Type each lot&apos;s price — Enter moves to the next.</span>
                </div>
              )}
              {lotSkips.length > 0 && (
                <div
                  role="status"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                    margin: "0.5rem 0 0",
                    color: "var(--color-warning)",
                    fontSize: "0.8125rem",
                  }}
                >
                  {lotSkips.map((skip, i) => (
                    <span key={`${skip.offerId}-${i}`}>
                      <strong style={{ fontWeight: 600 }}>{lotNoOf(skip.offerId)}</strong> {skip.message}
                    </span>
                  ))}
                </div>
              )}
              {reorderable && (
                <p style={{ ...MUTED, margin: "0.5rem 0 0" }}>
                  Drag a lot by its ⠿ to move it, or sort the post by{" "}
                  {FACEBOOK_LOT_SORTS.map((by, i) => (
                    <Fragment key={by}>
                      {i > 0 && (i === FACEBOOK_LOT_SORTS.length - 1 ? " or " : ", ")}
                      <button type="button" style={STEP_LINK} disabled={isPending} onClick={() => sortLots(by)}>
                        {FACEBOOK_LOT_SORT_LABEL[by]}
                      </button>
                    </Fragment>
                  ))}
                  .
                </p>
              )}
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
              <ol style={LOT_LIST} {...(drag?.containerProps ?? {})}>
                {lotsInView.map((lot, index) => {
                  const { photos, caption } = lotKit(lot);
                  return (
                    <Fragment key={lot.offerId}>
                      {showLineAt(drag, index) && <DropLine />}
                      <LotRow
                        lotNo={movedOrder ? index + 1 : (lot.lotNo ?? index + 1)}
                        drag={drag}
                        index={index}
                        rowRef={(el) => {
                          if (el) rowRefs.current.set(lot.offerId, el);
                          else rowRefs.current.delete(lot.offerId);
                        }}
                        collectionId={collectionId}
                        collectionSlug={collectionSlug}
                        lot={lot}
                        sales={screen.sales[lot.offerId] ?? []}
                        photos={photos}
                        caption={caption}
                        untranslated={translations?.language ? untranslatedOf(lot) : []}
                        language={translations?.language ?? null}
                        onTranslated={refreshTexts}
                        text={lotTexts?.[lot.offerId] ?? null}
                        actions={lotActions(lot)}
                        ticked={isTerminalState(lot.state) ? null : ticked.has(lot.offerId)}
                        onToggleTicked={() => toggleTicked(lot.offerId)}
                        prepare={prepareRows?.[lot.offerId] ?? null}
                        priceRef={(el) => {
                          if (el) priceInputs.current.set(lot.offerId, el);
                          else priceInputs.current.delete(lot.offerId);
                        }}
                        onPriceEnter={() => focusAfter(lot.offerId)}
                        onPriceSaved={(field, value) =>
                          void settlePostLotPrice(collectionId, postId, lot.offerId, field, value)
                        }
                        onPrepareChanged={() => void invalidateAll(collectionId)}
                        onCheckCovers={(mode) => {
                          const covers = prepareRows?.[lot.offerId]?.covers;
                          setCoverWalk({
                            kind: "lot",
                            offerId: lot.offerId,
                            mode,
                            includeOtherAreas: covers ? covers.photoCount === 0 : false,
                          });
                        }}
                      />
                    </Fragment>
                  );
                })}
                {showLineAt(drag, lotsInView.length) && <DropLine />}
              </ol>
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

      {dialog.kind === "regenerate" && lotTexts && (
        <RegenerateLotTextsDialog
          postNo={postNo}
          lots={lots}
          lotTexts={lotTexts}
          initialScope={dialog.scope}
          isPending={isPending}
          error={error}
          onCancel={close}
          onSubmit={regenerate}
        />
      )}

      {dialog.kind === "titleTemplate" && lotTitles && (
        <LotTitleTemplateDialog
          collectionId={collectionId}
          language={translations?.language ?? null}
          postNo={postNo}
          lots={lots}
          initialTemplate={lotTitles.template}
          handWritten={lotTitles.handWritten}
          isPending={isPending}
          error={error}
          onCancel={close}
          onSubmit={retitle}
        />
      )}

      {dialog.kind === "titleWords" && lotTitles && (
        <LotTitleWordsDialog
          postNo={postNo}
          lots={lots}
          mode={dialog.mode}
          isPending={isPending}
          error={error}
          onCancel={close}
          onSubmit={(words, edge) => changeTitleWords(dialog.mode, words, edge)}
        />
      )}

      {coverWalk?.kind === "lot" && (
        <OfferCoverWalk
          collectionId={collectionId}
          offerId={coverWalk.offerId}
          mode={coverWalk.mode}
          includeOtherAreas={coverWalk.includeOtherAreas}
          onClose={() => setCoverWalk(null)}
          onChanged={() => void invalidateAll(collectionId)}
        />
      )}
      {coverWalk?.kind === "post" && (
        <OffersCoverWalk
          collectionId={collectionId}
          offers={coverWalk.offers}
          mode={coverWalk.mode}
          onClose={() => setCoverWalk(null)}
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

/** Where a dragged lot lands (#1986) — a list item of its own, since the lots are an `<ol>`. */
function DropLine() {
  return (
    <li aria-hidden style={{ listStyle: "none" }}>
      <InsertionLine />
    </li>
  );
}

/** One lot of the post (#1863): its photos, what it is and where it stands, its caption, its `⋮`. */
function LotRow({
  lotNo,
  drag,
  index,
  rowRef,
  collectionId,
  collectionSlug,
  lot,
  sales,
  photos,
  caption,
  untranslated,
  language,
  onTranslated,
  text,
  actions,
  ticked,
  onToggleTicked,
  prepare,
  priceRef,
  onPriceEnter,
  onPriceSaved,
  onPrepareChanged,
  onCheckCovers,
}: {
  /** The lot's number in the order drawn — its own, or the one a move just gave it (#1986). */
  lotNo: number;
  /** The lots' drag-to-reorder, null once the post is up (#1986). */
  drag: DragList | null;
  index: number;
  rowRef: (el: HTMLLIElement | null) => void;
  collectionId: string;
  collectionSlug: string;
  lot: FacebookKitLot;
  sales: { id: string; saleNo: number }[];
  photos: React.ReactNode;
  caption: React.ReactNode | null;
  /** The names this lot's part of the post prints untranslated (#1889), each entered from here
   *  (#1980); empty when none. */
  untranslated: TitleFallback[];
  /** The post's language, the one `untranslated` is missing. */
  language: string | null;
  onTranslated: () => void;
  /** Where its title and description stand against their templates (#1983); null once the post is up. */
  text: OfferTextStatus | null;
  actions: RowAction[];
  /** Whether the lot is ticked to be sold with others (#2050); null when it can no longer be sold. */
  ticked: boolean | null;
  onToggleTicked: () => void;
  /** The lot as a Prepare row (#2031) while the post is not up — its price, title and readiness are then
   *  edited here; null once the post is up, or until the rows are read. */
  prepare: PrepareOffer | null;
  priceRef: (el: HTMLInputElement | null) => void;
  onPriceEnter: () => void;
  onPriceSaved: (field: "price" | "startingPrice", value: string | null) => void;
  /** The title or the covers changed — the lots' rows are read again. */
  onPrepareChanged: () => void;
  /** Opens the lot's covers walk: the photos not yet checked, or every one again (#2114). */
  onCheckCovers: (mode: "unchecked" | "all") => void;
}) {
  const price = facebookLotPrice(lot);
  const item = drag?.itemProps(index);
  const textMarks = text ? [text.outOfDate && "Out of date", text.handWritten && "Written by hand"].filter(Boolean) : [];
  return (
    <li
      {...item}
      ref={(el) => {
        rowRef(el);
        item?.ref(el);
      }}
      style={{ ...LOT_ROW, ...dragStyle(drag, index) }}
    >
      {/* The tick, to the row's top and bottom edges (#2082); a lot that can no longer be sold keeps the
          cell empty, so the photos stay in line. */}
      {ticked !== null ? (
        <CheckCell bleed={{ top: LOT_ROW_PAD, bottom: LOT_ROW_PAD }} style={SELECT_STRIP}>
          <input
            type="checkbox"
            checked={ticked}
            onChange={onToggleTicked}
            aria-label={`Tick lot ${lotNo}`}
            style={{ cursor: "pointer" }}
          />
        </CheckCell>
      ) : (
        <div aria-hidden style={SELECT_STRIP} />
      )}
      <div style={LOT_BODY}>
        {/* Captioned, the lot's one photo; as text, its upload set, wrapping within the row. */}
        <div style={{ flex: caption ? `0 0 ${PHOTO_SIZE}` : "0 1 auto", minWidth: PHOTO_SIZE }}>{photos}</div>
        <div style={{ flex: "1 1 16rem", minWidth: "16rem" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
              {drag && (
                <span
                  {...drag.handleProps(index)}
                  style={{ cursor: "grab", display: "inline-flex", verticalAlign: "middle", marginRight: "0.25rem" }}
                >
                  <DragGrip label="Drag to move this lot" />
                </span>
              )}
              <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>Lot {lotNo}</span>
              {!prepare && (
                <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.375rem", marginLeft: "0.5rem" }}>
                  <EntityNoChip entity="offer" no={lot.offerNo} prefix="o" />
                  <Link href={`/c/${collectionSlug}/offers/${lot.offerId}`} style={LINK}>
                    {lot.title}
                  </Link>
                </span>
              )}
            </p>
            <RowActionsMenu actions={actions} ariaLabel={`Lot ${lotNo} actions`} />
          </div>
          {/* While the post is not up (#2031): the title edited in place — the offer's number is the link
              then — the price table with the lot's own figure, and, while it is being prepared, what still
              stops it from being marked ready. */}
          {prepare && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", margin: "0.375rem 0 0" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.375rem", minWidth: 0 }}>
                <Link href={`/c/${collectionSlug}/offers/${lot.offerId}`} style={{ ...LINK, flexShrink: 0 }}>
                  <EntityNoChip entity="offer" no={lot.offerNo} prefix="o" />
                </Link>
                <PrepareTitleField offer={prepare} onChanged={onPrepareChanged} inputWidth="24rem" />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <PreparePriceField ref={priceRef} offer={prepare} onEnter={onPriceEnter} onSaved={onPriceSaved} />
              </div>
              {lot.state === "preparing" && (
                <PrepareReadiness offer={prepare} onCheckCovers={() => onCheckCovers("unchecked")} />
              )}
              {lot.state === "ready" && <ReadyLotPhotos offer={prepare} onCheckCovers={onCheckCovers} />}
            </div>
          )}
          <dl style={LOT_FACTS}>
            <dt style={MUTED}>Type</dt>
            <dd style={{ margin: 0 }}>{OFFER_LISTING_TYPE_LABEL[lot.listingType]}</dd>
            {!prepare && (
              <>
                <dt style={MUTED}>{price.label}</dt>
                <dd style={{ margin: 0 }}>
                  {price.amount ? (
                    <>
                      {price.amount} {lot.currency}
                    </>
                  ) : (
                    <span style={MUTED}>—</span>
                  )}
                </dd>
              </>
            )}
            <dt style={MUTED}>State</dt>
            <dd style={{ margin: 0 }}>
              <OfferStateChip state={lot.state} />
            </dd>
            <dt style={MUTED}>Link</dt>
            <dd style={{ margin: 0 }}>
              {lot.url ? (
                <>
                  <a href={lot.url} target="_blank" rel="noreferrer" style={LINK}>
                    link ↗
                  </a>
                  {lot.state === "pending" && <> <PendingLinkMark /></>}
                </>
              ) : (
                <span style={MUTED}>—</span>
              )}
            </dd>
            <dt style={MUTED}>Sale</dt>
            <dd style={{ margin: 0 }}>
              {sales.length > 0 ? (
                sales.map((sale, i) => (
                  <span key={sale.id}>
                    {i > 0 && ", "}
                    <Link href={`/c/${collectionSlug}/sales/${sale.id}`} style={LINK}>
                      Sale #{sale.saleNo}
                    </Link>
                  </span>
                ))
              ) : (
                <span style={MUTED}>—</span>
              )}
            </dd>
            {text && textMarks.length > 0 && (
              <>
                <dt style={MUTED}>Text</dt>
                <dd style={{ margin: 0, color: text.outOfDate ? "var(--color-warning)" : "var(--color-text-secondary)" }}>
                  {textMarks.join(" · ")}
                </dd>
              </>
            )}
            {language && untranslated.length > 0 && (
              <>
                <dt style={MUTED}>Untranslated</dt>
                <dd style={{ margin: 0, color: "var(--color-warning)" }}>
                  <TranslationGapLinks
                    collectionId={collectionId}
                    language={language}
                    gaps={untranslated}
                    withLanguage={false}
                    onSaved={onTranslated}
                  />
                </dd>
              </>
            )}
          </dl>
        </div>
        {caption && <div style={{ flex: "2 1 22rem", minWidth: "22rem" }}>{caption}</div>}
      </div>
    </li>
  );
}

/**
 * A Ready lot's photos on the post's screen (#2114), under its price while the post is not up: its
 * covers walked again — the photos not yet checked while there are any, every one otherwise — and,
 * while its photos are being made again, that *Publish…* waits for them. The lot stays Ready.
 */
function ReadyLotPhotos({
  offer,
  onCheckCovers,
}: {
  offer: PrepareOffer;
  onCheckCovers: (mode: "unchecked" | "all") => void;
}) {
  const generating = offer.readyBlockers.some(isPhotoRunBlocker);
  const { covers } = offer;
  const walkable = covers.needed && covers.photoCount + covers.otherCount > 0;
  if (!generating && !walkable) return null;
  return (
    <p style={{ ...MUTED, margin: 0, display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
      {walkable && (
        <Tooltip content="Change the covers on this lot's photos. It stays Ready, and its photos are made again.">
          <button
            type="button"
            onClick={() => onCheckCovers(covers.uncheckedCount > 0 ? "unchecked" : "all")}
            style={STEP_LINK}
          >
            {covers.uncheckedCount > 0 ? `Check covers (${covers.uncheckedCount})` : "Review every photo"}
          </button>
        </Tooltip>
      )}
      {generating && <span>Photos being generated — Publish waits for them.</span>}
    </p>
  );
}
