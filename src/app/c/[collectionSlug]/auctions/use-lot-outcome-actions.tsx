"use client";

import { useState, useTransition, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  ConfirmDialog,
  DialogActions,
  DialogBody,
  DialogShell,
} from "@/app/dialog-shell";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import type { RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import {
  isTerminalLotStatus,
  type AuctionLotOutcome,
  type AuctionLotStatus,
} from "@/lib/auction-rules";
import { lotOutcome } from "@/lib/auction-lot";
import { formatInstant } from "./auction-format";

// **Closing a lot** (#354, rewritten for ADR-0021 §4) — the fork at the end of §7.
//
// A `{ actions, dialog }` row-action hook, the shape the codebase uses whenever a menu entry opens
// a dialog: the menu closes on select, so the dialog has to live at the row level to survive it.
// `AuctionLotRow` calls this once, which is what gives the flat watchlist and the sale's own cards
// the same entries without either screen knowing about the flow.
//
// There used to be four entries here, one per outcome, and the collector picked the one that had
// happened. There are now three, because won/lost/observed are not things to pick: they follow from
// what the lot fetched against what was placed on it. Closing a lot is **confirming its figures**,
// and the outcome is read back out of them — which is why *Mark as won* is gone and no menu can
// file a lot as won that the money says was outbid.
//
// Two questions survive, and only because arithmetic cannot answer either. What it went for, since
// nothing may be inferred from the last observed bid; and, at exactly equal figures, who bid first.

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const NOTE: React.CSSProperties = {
  margin: "0.5rem 0 0",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  color: "var(--color-text-muted)",
};

/** The tie question is boxed because it is the one thing on this form that is *asked* rather than
 * explained — everything else in the dialog is the figures talking back. */
const TIE_BOX: React.CSSProperties = {
  marginTop: "0.75rem",
  padding: "0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-page)",
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
};

const TIE_CHOICE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

/** What the hook needs of a lot — satisfied structurally by both the watchlist row and the sale
 * screen's detail row, so neither has to be named here. */
export interface OutcomeLot {
  id: string;
  status: AuctionLotStatus;
  /** How it went, as derived — what the dialog explains back to the collector. */
  outcome: AuctionLotOutcome;
  currency: string;
  currentBid: string | null;
  /** The collector's own maximum. Its **absence** is what makes closing without a price legitimate:
   * a lot nobody bid on is an observation, not a loss. */
  myBid: string | null;
  finalPrice: string | null;
  endsAt: string;
  /** Transcribed into a purchase (#28): its figures live there now, so nothing here may move it. */
  settled: boolean;
}

type OutcomeDialog =
  | { kind: "none" }
  | { kind: "close" }
  | { kind: "cancelled" }
  | { kind: "reopen" };

/** The tie question's two answers, as radio values — `null` is "not answered yet", which the server
 * refuses on a tie rather than guessing. */
type TieAnswer = boolean | null;

/**
 * The lot's lifecycle entries for a `RowActionsMenu`, plus the dialog they open.
 *
 * *Close the lot* asks one question — what it went for — and never pre-fills it from the last bid:
 * that figure is a lower bound on the result, and offering it as the answer is how a guess ends up
 * stored as an observation. The dialog then **says back** what the figures make of it, because the
 * outcome is derived and the collector should see the conclusion before committing to it, not after.
 *
 * Blank is refused when a bid was placed. That combination used to be filed as "lost with no
 * figure", and it is retired: with the outcome derived there is no honest reading of it. The honest
 * answers are to leave the lot open until the result is known, or — if the bid was never really
 * placed — to clear it, which files the lot as **observed**.
 *
 * The tie question appears only at exactly equal figures, where the arithmetic genuinely cannot
 * decide and only the collector knows who bid first.
 *
 * *Mark as cancelled* is confirmed: it states what "cancelled" means here, which is not obvious
 * from the word alone, and it clears any price already recorded. *Back to open* asks only when
 * there is a `finalPrice` to throw away — undoing a cancellation destroys nothing, and a
 * confirmation for it would be a dialog that can only be answered one way.
 */
export function useLotOutcomeActions(
  lot: OutcomeLot,
  onChanged: () => void
): { actions: RowAction[]; dialog: React.ReactNode } {
  const [dialog, setDialog] = useState<OutcomeDialog>({ kind: "none" });
  const [finalPrice, setFinalPrice] = useState("");
  const [wonTie, setWonTie] = useState<TieAnswer>(null);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const terminal = isTerminalLotStatus(lot.status);
  const settledHint = lot.settled
    ? "Settled into a purchase — edit the purchase instead"
    : undefined;

  // The same arithmetic the row's chip and the server both run, over what is currently typed — so
  // the dialog's preview cannot promise an outcome the save then disagrees with.
  const previewOutcome = lotOutcome({
    status: "closed",
    myBid: lot.myBid,
    finalPrice: finalPrice.trim() || null,
    wonTie,
  });
  const isTie =
    lot.myBid !== null &&
    finalPrice.trim() !== "" &&
    Number(finalPrice) === Number(lot.myBid);

  function close() {
    if (isPending) return;
    setDialog({ kind: "none" });
    setError(undefined);
  }

  function record(status: "closed" | "cancelled" | "open", price = "", tie: TieAnswer = null) {
    setError(undefined);
    startTransition(async () => {
      const { setAuctionLotStatusAction } = await import("@/app/actions/auctions");
      const result = await setAuctionLotStatusAction(lot.id, status, price, tie);
      if (result.status === "success") {
        setDialog({ kind: "none" });
        onChanged();
      } else {
        setError(result.message);
      }
    });
  }

  const actions: RowAction[] = [
    {
      key: "close",
      label: lot.status === "closed" ? "Edit the final price" : "Close the lot",
      icon: "◆",
      disabled: lot.settled,
      hint: settledHint,
      onSelect: () => {
        // Only a price already confirmed on this lot seeds the field. The last observed bid does
        // not: it is a lower bound, and pre-filling it is how a guess becomes a datapoint.
        setFinalPrice(lot.finalPrice ?? "");
        setWonTie(lot.status === "closed" && lot.outcome === "won" ? true : null);
        setError(undefined);
        setDialog({ kind: "close" });
      },
    },
    // The outcome chip is right there on the row, so an entry it already answers is hidden rather
    // than shown greyed out — the exception to #273 the copies list makes for its offer action.
    ...(lot.status === "cancelled"
      ? []
      : [
          {
            key: "cancelled",
            label: "Mark as cancelled",
            icon: "⊘",
            disabled: lot.settled,
            hint: settledHint,
            onSelect: () => {
              setError(undefined);
              setDialog({ kind: "cancelled" });
            },
          } as RowAction,
        ]),
    ...(terminal
      ? [
          {
            key: "reopen",
            label: "Back to open",
            icon: "↺",
            disabled: lot.settled,
            hint: settledHint,
            onSelect: () => {
              setError(undefined);
              // Only a confirmed result is worth asking about; there is nothing to lose in undoing
              // a cancellation.
              if (lot.finalPrice !== null) setDialog({ kind: "reopen" });
              else record("open");
            },
          } as RowAction,
        ]
      : []),
  ];

  // Portaled to <body>, and not optional. The row this menu belongs to is drawn at `opacity: 0.6`
  // once its lot has ended — which is every lot a result is ever recorded on — and an opacity
  // below 1 makes the row its own stacking context. A `position: fixed` dialog inside one is
  // ranked *within the row*, so the panel's z-index stopped competing with the sticky toolbar and
  // the app header and they painted straight over it. The same escape the line dialog takes out of
  // a transform-centred panel.
  const dialogNode =
    typeof document === "undefined" || dialog.kind === "none" ? null : (
      <>
        {dialog.kind === "close" && (
          <DialogShell title="Close the lot" onClose={close}>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                record("closed", finalPrice, isTie ? wonTie : null);
              }}
              style={{ display: "contents" }}
            >
              <DialogBody>
                <label
                  htmlFor="lot-final-price"
                  style={{
                    display: "block",
                    marginBottom: "0.375rem",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    color: "var(--color-text-secondary)",
                  }}
                >
                  What it went for ({lot.currency})
                </label>
                <NumericInput
                  id="lot-final-price"
                  data-autofocus-select
                  value={finalPrice}
                  onChange={(e) => setFinalPrice(e.currentTarget.value)}
                  placeholder="0.00"
                  style={INPUT_STYLE}
                />
                <p style={NOTE}>
                  The hammer price, before the seller&rsquo;s premium — the same figure a bid is
                  entered as. Recorded against this lot&rsquo;s contents and its closing date (
                  {formatInstant(lot.endsAt)}), with the exchange rate of that moment frozen with
                  it.
                </p>

                {/* The tie: the one thing the money cannot say, asked only where it arises. */}
                {isTie && (
                  <div style={TIE_BOX}>
                    <p style={{ ...NOTE, margin: 0, color: "var(--color-text-primary)" }}>
                      It went for exactly your own maximum of {lot.myBid} {lot.currency}. Whoever
                      bid that amount first won it, and the figures cannot say which of you that
                      was.
                    </p>
                    <label style={TIE_CHOICE}>
                      <input
                        type="radio"
                        name="lot-won-tie"
                        checked={wonTie === true}
                        onChange={() => setWonTie(true)}
                      />
                      I won it
                    </label>
                    <label style={TIE_CHOICE}>
                      <input
                        type="radio"
                        name="lot-won-tie"
                        checked={wonTie === false}
                        onChange={() => setWonTie(false)}
                      />
                      Somebody else got it
                    </label>
                  </div>
                )}

                {/* What the figures make of it, before it is saved rather than after. */}
                <p style={NOTE}>
                  {lot.myBid === null ? (
                    <>
                      You have no bid recorded on this lot, so closing it files the price as one you
                      only <strong>watched</strong> — a datapoint for valuing this material, and
                      nothing you owe anything on.
                    </>
                  ) : finalPrice.trim() === "" ? (
                    <>
                      You bid {lot.myBid} {lot.currency} on this lot, so a price is needed to close
                      it. If you never really placed that bid, clear it on the row first and this
                      becomes a lot you only watched. If you simply never saw the result, leave the
                      lot open — nothing here will be guessed from the last bid anyone recorded.
                    </>
                  ) : isTie && wonTie === null ? (
                    <>Answer the question above and this lot will be filed accordingly.</>
                  ) : previewOutcome === "won" ? (
                    <>
                      This is <strong>below</strong> your maximum of {lot.myBid} {lot.currency}, so
                      the lot will be filed as <strong>won</strong> and becomes payable in this
                      parcel. The premium and the shipping are the sale&rsquo;s and are added there,
                      once for the whole parcel — you pay when the seller invoices it, and that is
                      what turns the parcel into a purchase.
                    </>
                  ) : (
                    <>
                      This is <strong>above</strong> your maximum of {lot.myBid} {lot.currency}, so
                      the lot will be filed as <strong>lost</strong> — nothing to pay, and the price
                      is kept as a datapoint.
                    </>
                  )}
                </p>
              </DialogBody>
              <DialogActions
                actionLabel={isPending ? "Saving…" : "Close the lot"}
                disabled={isPending}
                cancelDisabled={isPending}
                error={error}
                onCancel={close}
              />
            </form>
          </DialogShell>
        )}

        {dialog.kind === "cancelled" && (
          <ConfirmDialog
            title="Mark as cancelled"
            message="For a listing withdrawn by the seller, or ended without a sale. It carries no price datapoint, so anything recorded as a final price is cleared. The lot stays on the list and can be put back to open."
            actionLabel="Mark as cancelled"
            pendingLabel="Saving…"
            variant="primary"
            isPending={isPending}
            error={error}
            onClose={close}
            onConfirm={() => record("cancelled")}
          />
        )}

        {dialog.kind === "reopen" && (
          <ConfirmDialog
            title="Back to open"
            message={
              lot.outcome === "won"
                ? `This lot went for ${lot.finalPrice} ${lot.currency}, below your own maximum, so it is filed as won. Putting it back in play discards that price and the exchange rate frozen with it, and takes the lot back out of what the parcel will cost.`
                : `This lot is recorded as having gone for ${lot.finalPrice} ${lot.currency}. Putting it back in play discards that result and the exchange rate frozen with it.`
            }
            actionLabel="Discard the result"
            pendingLabel="Saving…"
            variant="destructive"
            isPending={isPending}
            error={error}
            onClose={close}
            onConfirm={() => record("open")}
          />
        )}
      </>
    );

  return {
    actions,
    dialog: dialogNode && createPortal(dialogNode, document.body),
  };
}
