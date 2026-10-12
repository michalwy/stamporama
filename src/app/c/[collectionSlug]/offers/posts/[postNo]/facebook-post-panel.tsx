"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FACEBOOK_POST_STAGE_LABEL,
  facebookPostLink,
  facebookPostMoves,
  facebookPostStage,
} from "@/lib/facebook-post-rules";
import type { FacebookKitLot } from "@/lib/facebook-auctions";
import { isAuctionListing, manualTransitions, OFFER_LISTING_TYPE_LABEL } from "@/lib/offer-rules";
import { ConfirmDialog, DialogSecondaryButton } from "@/app/dialog-shell";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { InlineText } from "@/app/c/[collectionSlug]/shared/inline-text";
import { useToast } from "@/app/toast-provider";
import { ActivateOfferDialog, type PublishTarget } from "../../activate-offer-dialog";
import { OfferStateChip, PendingLinkMark } from "../../offer-badges";
import { SellOfferFlowDialog } from "../../sell-offer-flow-dialog";
import { useFacebookPostScreen, useInvalidateOffers } from "../../use-offers-query";
import { FacebookPostKit, PHOTO_SIZE } from "../../[offerId]/facebook-post-kit";
import { AddLotsDialog } from "./add-lots-dialog";

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

/** What a lot is offered at, as the row reads it: an auction's recorded bid, else its starting price;
 *  a quick buy's asking price. */
function lotPrice(lot: FacebookKitLot): { label: string; amount: string | null } {
  if (!isAuctionListing(lot.listingType)) return { label: "Price", amount: lot.price };
  if (lot.price !== "0.00") return { label: "Bid", amount: lot.price };
  return { label: "Start", amount: lot.startingPrice };
}

type Dialog =
  | { kind: "none" }
  | { kind: "publish"; target: PublishTarget; approving: boolean }
  | { kind: "reject" }
  | { kind: "withdrawPost" }
  | { kind: "withdrawLot"; lot: FacebookKitLot }
  | { kind: "takeOut"; lot: FacebookKitLot }
  | { kind: "addLots" }
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
  const [isPending, startTransition] = useTransition();

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

  const { kit, postNo, title } = screen;
  const lots = kit.lots;
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
              {notAdded && (
                <p role="status" style={{ color: "var(--color-warning)", fontSize: "0.8125rem", margin: "0.5rem 0 0" }}>
                  {notAdded}
                </p>
              )}
              <ol style={LOT_LIST}>
                {lots.map((lot) => {
                  const { photos, caption } = lotKit(lot);
                  return (
                    <LotRow
                      key={lot.offerId}
                      collectionSlug={collectionSlug}
                      lot={lot}
                      sales={screen.sales[lot.offerId] ?? []}
                      photos={photos}
                      caption={caption}
                      actions={lotActions(lot)}
                    />
                  );
                })}
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

/** One lot of the post (#1863): its photos, what it is and where it stands, its caption, its `⋮`. */
function LotRow({
  collectionSlug,
  lot,
  sales,
  photos,
  caption,
  actions,
}: {
  collectionSlug: string;
  lot: FacebookKitLot;
  sales: { id: string; saleNo: number }[];
  photos: React.ReactNode;
  caption: React.ReactNode | null;
  actions: RowAction[];
}) {
  const price = lotPrice(lot);
  return (
    <li style={LOT_ROW}>
      {/* Captioned, the lot's one photo; as text, its upload set, wrapping within the row. */}
      <div style={{ flex: caption ? `0 0 ${PHOTO_SIZE}` : "0 1 auto", minWidth: PHOTO_SIZE }}>{photos}</div>
      <div style={{ flex: "1 1 16rem", minWidth: "16rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>Lot {lot.lotNo}</span>
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.375rem", marginLeft: "0.5rem" }}>
              <EntityNoChip entity="offer" no={lot.offerNo} prefix="o" />
              <Link href={`/c/${collectionSlug}/offers/${lot.offerId}`} style={LINK}>
                {lot.title}
              </Link>
            </span>
          </p>
          <RowActionsMenu actions={actions} ariaLabel={`Lot ${lot.lotNo} actions`} />
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
        </dl>
      </div>
      {caption && <div style={{ flex: "2 1 22rem", minWidth: "22rem" }}>{caption}</div>}
    </li>
  );
}
