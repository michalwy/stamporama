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
} from "@/lib/facebook-post-rules";
import type { FacebookKitLot } from "@/lib/facebook-auctions";
import { languageLabel } from "@/lib/languages";
import type { OfferTextStatus } from "@/lib/offers";
import type { TitleFallback } from "@/lib/offer-title-template";
import { manualTransitions, OFFER_LISTING_TYPE_LABEL } from "@/lib/offer-rules";
import { ConfirmDialog, DialogSecondaryButton } from "@/app/dialog-shell";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { InlineText } from "@/app/c/[collectionSlug]/shared/inline-text";
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
import { OfferStateChip, PendingLinkMark } from "../../offer-badges";
import { SellOfferFlowDialog } from "../../sell-offer-flow-dialog";
import { useFacebookPostScreen, useInvalidateOffers } from "../../use-offers-query";
import { FacebookPostKit, PHOTO_SIZE } from "../../[offerId]/facebook-post-kit";
import { AddLotsDialog } from "./add-lots-dialog";
import { RegenerateLotTextsDialog, type RegenerateScope } from "./regenerate-lot-texts-dialog";

// A multi-lot Facebook post's own screen (#1842): the one place every offer in the post is seen with
// its state, and the post is managed as one. Until it existed the post was seen from any lot's
// Facebook card, which repeated the whole post on every lot.
//
// - **The post's title** (#1862), in its heading beside its number, edited in place — what tells the
//   post apart from the others running at once. A post made before titles is named by number until it
//   is given one, and its heading offers to name it.
// - **The post's moves**, made as one — submit for approval, approve, reject, activate, withdraw (#1778,
//   #1779) — through the same actions the offer screen uses, asked of a lot: the server takes the whole
//   post with it, so the buttons are offered only where `facebookPostMoves` says the server would.
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
// - **The lots' order** (#1986), while the post is not up: a row is dragged by its grip to a new place,
//   or the whole post sorted by catalogue number or price from the lots' heading. The lot numbers are
//   the order, so the text, the captions and the photos' download follow; the rows show the new order
//   at once and the server's answer replaces it.

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

const LOT_ROW: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-start",
  gap: "0.75rem 1.25rem",
  padding: "0.875rem 0",
  borderBottom: "1px solid var(--color-border)",
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
  | { kind: "withdrawPost" }
  | { kind: "withdrawLot"; lot: FacebookKitLot }
  | { kind: "takeOut"; lot: FacebookKitLot }
  | { kind: "addLots" }
  | { kind: "regenerate"; scope: RegenerateScope }
  | { kind: "sell"; lot: FacebookKitLot };

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
  const { invalidateAll } = useInvalidateOffers();
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

  const serverLots = screen?.kit.lots ?? [];
  const lots = movedOrder
    ? movedOrder.flatMap((id) => serverLots.find((l) => l.offerId === id) ?? [])
    : serverLots;
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

  if (isLoading) return <p style={MUTED}>Loading…</p>;
  if (isError || !screen) {
    // A post left with one lot is dissolved, and its address goes with it.
    return (
      <p style={MUTED}>
        This post no longer exists — a post left with one lot is dissolved, and that offer is posted alone.{" "}
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
          : `Post #${postNo} is up — all ${lots.length} lots active`
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

  const outOfDateCount = lotTexts ? lots.filter((l) => lotTexts[l.offerId]?.outOfDate).length : 0;

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

  function setLotState(offerId: string, next: "ready" | "withdrawn", done: string) {
    run(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      return setOfferStateAction(offerId, next);
    }, done);
  }

  function takeOut(lot: FacebookKitLot) {
    // Taking out one of two lots dissolves the post (ADR-0061 §2): the screen has nothing left to show,
    // so it goes to the offer that is now posted alone.
    const remaining = lots.length === 2 ? lots.find((l) => l.offerId !== lot.offerId) : undefined;
    run(
      async () => {
        const { removeFacebookLotAction } = await import("@/app/actions/facebook");
        return removeFacebookLotAction(lot.offerId);
      },
      remaining
        ? `Offer #${lot.offerNo} taken out — post #${postNo} is dissolved and offer #${remaining.offerNo} is posted alone`
        : `Offer #${lot.offerNo} taken out of post #${postNo}`,
      remaining ? () => router.push(`/c/${collectionSlug}/offers/${remaining.offerId}`) : undefined
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

  function lotActions(lot: FacebookKitLot): RowAction[] {
    const terminal = lot.state === "sold" || lot.state === "withdrawn";
    return [
      { key: "open", label: "Open offer", icon: "externalLink", href: `/c/${collectionSlug}/offers/${lot.offerId}` },
      ...(!terminal
        ? [{ key: "sell", label: "Sell", icon: "sell", onSelect: () => setDialog({ kind: "sell", lot }) } as RowAction]
        : []),
      // Withdrawing one lot is the lot's own once the post is up (#1779); a pending post is withdrawn
      // whole, from the post's own moves.
      ...(lot.state !== "pending" && !moves.takeOut && manualTransitions(lot.state).includes("withdrawn")
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

  const anyMove = moves.activate || moves.approve || moves.reject || moves.withdraw;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <header>
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
        <p style={{ ...MUTED, margin: "0.25rem 0 0" }}>
          A Facebook post of {lots.length} lots in{" "}
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
        {anyMove ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {/* One door (#1847): live or waiting for the group's approval is chosen in the dialog. */}
            {moves.activate && (
              <DialogSecondaryButton
                type="button"
                disabled={isPending}
                onClick={() => setDialog({ kind: "publish", target: "active", approving: false })}
              >
                Publish…
              </DialogSecondaryButton>
            )}
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
          </div>
        ) : (
          <p style={{ ...MUTED, margin: 0 }}>
            {moves.waiting.length > 0
              ? `Every lot must be Ready before the post goes up: ${moves.waiting.map((n) => `lot ${n}`).join(", ")}.`
              : stage === "up"
                ? "The post is up. Each lot is sold or withdrawn on its own, from its row's ⋮."
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
                <div style={{ display: "flex", gap: "0.5rem" }}>
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
              <ol style={LOT_LIST} {...(drag?.containerProps ?? {})}>
                {lots.map((lot, index) => {
                  const { photos, caption } = lotKit(lot);
                  return (
                    <Fragment key={lot.offerId}>
                      {showLineAt(drag, index) && <DropLine />}
                      <LotRow
                        lotNo={index + 1}
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
                      />
                    </Fragment>
                  );
                })}
                {showLineAt(drag, lots.length) && <DropLine />}
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
          title={`Withdraw lot ${dialog.lot.lotNo}`}
          message="This lot is no longer for sale; the post and its other lots stay up. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
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
          title={`Take lot ${dialog.lot.lotNo} out of the post`}
          message={
            lots.length === 2
              ? "The post is left with one lot, so it is dissolved: both offers are then posted alone. The offers themselves are untouched."
              : "The lots after it move up one. The offer itself is untouched and is then posted alone."
          }
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
          nextLotNo={Math.max(0, ...lots.map((l) => l.lotNo ?? 0)) + 1}
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

      {dialog.kind === "sell" && (
        <SellOfferFlowDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          baseCurrency={baseCurrency}
          today={today}
          offer={{
            id: dialog.lot.offerId,
            name: null,
            label: dialog.lot.title,
            platformId: screen.platform.id,
            platformName: screen.platform.name,
            price: dialog.lot.price,
            currency: dialog.lot.currency,
            facebookGroupId: kit.group.id,
          }}
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
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.375rem", marginLeft: "0.5rem" }}>
              <EntityNoChip entity="offer" no={lot.offerNo} prefix="o" />
              <Link href={`/c/${collectionSlug}/offers/${lot.offerId}`} style={LINK}>
                {lot.title}
              </Link>
            </span>
          </p>
          <RowActionsMenu actions={actions} ariaLabel={`Lot ${lotNo} actions`} />
        </div>
        <dl style={LOT_FACTS}>
          <dt style={MUTED}>Type</dt>
          <dd style={{ margin: 0 }}>{OFFER_LISTING_TYPE_LABEL[lot.listingType]}</dd>
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
    </li>
  );
}
