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
import { useToast } from "@/app/toast-provider";
import { ActivateOfferDialog, type PublishTarget } from "../../activate-offer-dialog";
import { OfferStateChip, PendingLinkMark } from "../../offer-badges";
import { SellOfferFlowDialog } from "../../sell-offer-flow-dialog";
import { useFacebookPostScreen, useInvalidateOffers } from "../../use-offers-query";
import { FacebookPostKit } from "../../[offerId]/facebook-post-kit";

// A multi-lot Facebook post's own screen (#1842): the one place every offer in the post is seen with
// its state, and the post is managed as one. Until it existed the post was seen from any lot's
// Facebook card, which repeated the whole post on every lot.
//
// - **The lots**, in lot order: the lot number, the offer (linking to it), its type, its price — an
//   auction's current bid once one is recorded, else its starting price — its state, its listing link,
//   and its sale once sold. Each lot's own actions stay the offer's (*Sell*, withdrawing one lot of a
//   post that is up) and are reached from its row's `⋮`, as is *Take this lot out of the post* while
//   the post is not up.
// - **The post's moves**, made as one — submit for approval, approve, reject, activate, withdraw (#1778,
//   #1779) — through the same actions the offer screen uses, asked of a lot: the server takes the whole
//   post with it, so the buttons are offered only where `facebookPostMoves` says the server would.
// - **The kit**: the layout, the post's text, the captions where the post is captioned (#1841), and the
//   photos.

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

const TH: React.CSSProperties = {
  ...MUTED,
  fontWeight: 600,
  textAlign: "left",
  padding: "0.375rem 0.5rem",
  borderBottom: "1px solid var(--color-border)",
  whiteSpace: "nowrap",
};

const TD: React.CSSProperties = {
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  padding: "0.5rem",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "middle",
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

  const { kit, postNo } = screen;
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

  const anyMove = moves.activate || moves.submit || moves.approve || moves.reject || moves.withdraw;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "64rem" }}>
      <header>
        <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Post #{postNo}
        </h2>
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
            {moves.activate && (
              <DialogSecondaryButton
                type="button"
                disabled={isPending}
                onClick={() => setDialog({ kind: "publish", target: "active", approving: false })}
              >
                Activate…
              </DialogSecondaryButton>
            )}
            {moves.submit && (
              <DialogSecondaryButton
                type="button"
                disabled={isPending}
                onClick={() => setDialog({ kind: "publish", target: "pending", approving: false })}
              >
                Submit for approval…
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

      {/* The lots, in lot order. */}
      <section style={CARD} aria-label="Lots">
        <h3 style={CARD_TITLE}>Lots</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={TH}>Lot</th>
              <th style={TH}>Offer</th>
              <th style={TH}>Type</th>
              <th style={TH}>Price</th>
              <th style={TH}>State</th>
              <th style={TH}>Link</th>
              <th style={TH}>Sale</th>
              <th style={TH} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => {
              const price = lotPrice(lot);
              const sales = screen.sales[lot.offerId] ?? [];
              return (
                <tr key={lot.offerId}>
                  <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>{lot.lotNo}</td>
                  <td style={TD}>
                    <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.375rem" }}>
                      <EntityNoChip entity="offer" no={lot.offerNo} prefix="o" />
                      <Link href={`/c/${collectionSlug}/offers/${lot.offerId}`} style={LINK}>
                        {lot.title}
                      </Link>
                    </span>
                  </td>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>{OFFER_LISTING_TYPE_LABEL[lot.listingType]}</td>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>
                    {price.amount ? (
                      <>
                        <span style={MUTED}>{price.label}</span> {price.amount} {lot.currency}
                      </>
                    ) : (
                      <span style={MUTED}>—</span>
                    )}
                  </td>
                  <td style={TD}>
                    <OfferStateChip state={lot.state} />
                  </td>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>
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
                  </td>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>
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
                  </td>
                  <td style={{ ...TD, textAlign: "right" }}>
                    <RowActionsMenu actions={lotActions(lot)} ariaLabel={`Lot ${lot.lotNo} actions`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* The kit: the layout, the post's text and captions, the photos. */}
      <section style={CARD} aria-label="Post kit">
        <h3 style={CARD_TITLE}>Post kit</h3>
        <FacebookPostKit
          collectionSlug={collectionSlug}
          kit={kit}
          selfOfferId={null}
          onChanged={() => invalidateAll(collectionId)}
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
