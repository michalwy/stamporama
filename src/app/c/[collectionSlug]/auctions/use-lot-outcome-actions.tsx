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
import { isTerminalLotStatus, type AuctionLotStatus } from "@/lib/auction-rules";
import { formatInstant } from "./auction-format";

// **Recording what became of a lot** (#354) — the losing half of ADR-0021 §7.
//
// A `{ actions, dialog }` row-action hook, the shape the codebase uses whenever a menu entry opens
// a dialog: the menu closes on select, so the dialog has to live at the row level to survive it.
// `AuctionLotRow` calls this once, which is what gives the flat watchlist and the sale's own cards
// the same three entries without either screen knowing about the outcome flow.
//
// All four outcomes are recorded here, winning included (#354) — settlement (#28) operates on *a
// sale holding won lots*, so without it the sale could never reach the state that action reads. It
// stops at the status and the price paid: the parcel becomes a purchase as a whole, once, from the
// sale's own screen.

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

/** What the hook needs of a lot — satisfied structurally by both the watchlist row and the sale
 * screen's detail row, so neither has to be named here. */
export interface OutcomeLot {
  id: string;
  status: AuctionLotStatus;
  currency: string;
  currentBid: string | null;
  finalPrice: string | null;
  endsAt: string;
  /** Transcribed into a purchase (#28): its figures live there now, so nothing here may move it. */
  settled: boolean;
}

type OutcomeDialog =
  | { kind: "none" }
  /** The two priced outcomes share one form — the same field, asked about differently. */
  | { kind: "price"; status: "lost" | "won" }
  | { kind: "cancelled" }
  | { kind: "reopen" };

/** What the priced dialog says, per outcome. The two are one form and two questions: *what did it
 * go for* is an observation that may honestly be missing, *what did you pay* is a fact the
 * collector holds and the figure settlement is priced from. */
const PRICED: Record<
  "lost" | "won",
  { title: string; action: string; field: string; menu: string; edit: string; icon: string }
> = {
  lost: {
    title: "Mark as lost",
    action: "Mark as lost",
    field: "What it went for",
    menu: "Mark as lost",
    edit: "Edit final price",
    icon: "▽",
  },
  won: {
    title: "Mark as won",
    action: "Mark as won",
    field: "What you paid",
    menu: "Mark as won",
    edit: "Edit price paid",
    icon: "★",
  },
};

/**
 * The lot's outcome entries for a `RowActionsMenu`, plus the dialog they open.
 *
 * *Mark as lost* and *Mark as won* both ask for a price, and neither pre-fills it from the last
 * bid: that figure is a lower bound on the result, and offering it as the answer is how a guess
 * ends up stored as an observation. Blank is a real answer when losing — the lot went away before
 * the result was seen — and refused when winning, where the figure is what settlement (#28) prices
 * the purchase line from.
 *
 * Winning stops at the status and the price. It does **not** create a purchase: the parcel is
 * settled as a whole, once, when the seller has invoiced it (#28), and this is what puts a sale
 * into the state that action operates on.
 *
 * *Mark as cancelled* is confirmed: it states what "cancelled" means here, which is not obvious
 * from the word alone, and it clears any price already recorded. *Back to watching* asks only when
 * there is a `finalPrice` to throw away — undoing a cancellation destroys nothing, and a
 * confirmation for it would be a dialog that can only be answered one way.
 */
export function useLotOutcomeActions(
  lot: OutcomeLot,
  onChanged: () => void
): { actions: RowAction[]; dialog: React.ReactNode } {
  const [dialog, setDialog] = useState<OutcomeDialog>({ kind: "none" });
  const [finalPrice, setFinalPrice] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const terminal = isTerminalLotStatus(lot.status);
  const settledHint = lot.settled
    ? "Settled into a purchase — edit the purchase instead"
    : undefined;

  function close() {
    if (isPending) return;
    setDialog({ kind: "none" });
    setError(undefined);
  }

  function record(status: "lost" | "won" | "cancelled" | "watching", price = "") {
    setError(undefined);
    startTransition(async () => {
      const { setAuctionLotOutcomeAction } = await import("@/app/actions/auctions");
      const result = await setAuctionLotOutcomeAction(lot.id, status, price);
      if (result.status === "success") {
        setDialog({ kind: "none" });
        onChanged();
      } else {
        setError(result.message);
      }
    });
  }

  /** One entry per priced outcome. When the lot already carries that outcome the same door reopens
   * for correcting the figure, which is the usual reason to come back to a filed lot at all. */
  function pricedAction(status: "lost" | "won"): RowAction {
    const copy = PRICED[status];
    return {
      key: status,
      label: lot.status === status ? copy.edit : copy.menu,
      icon: copy.icon,
      disabled: lot.settled,
      hint: settledHint,
      onSelect: () => {
        // Only the lot's *own* recorded price seeds the field: reading it while re-filing a lot
        // from won to lost would carry what you paid into what somebody else paid.
        setFinalPrice(lot.status === status ? (lot.finalPrice ?? "") : "");
        setError(undefined);
        setDialog({ kind: "price", status });
      },
    };
  }

  const actions: RowAction[] = [
    // Won first: it is the outcome with something still to do after it (settlement, #28), while a
    // lost lot is filed and finished.
    pricedAction("won"),
    pricedAction("lost"),
    // The status chip is right there on the row, so an entry it already answers is hidden rather
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
            label: "Back to watching",
            icon: "↺",
            disabled: lot.settled,
            hint: settledHint,
            onSelect: () => {
              setError(undefined);
              // Only a recorded result is worth asking about; there is nothing to lose in undoing
              // a cancellation.
              if (lot.finalPrice !== null) setDialog({ kind: "reopen" });
              else record("watching");
            },
          } as RowAction,
        ]
      : []),
  ];

  // Portaled to <body>, and not optional. The row this menu belongs to is drawn at `opacity: 0.6`
  // once its lot has ended — which is every lot an outcome is ever recorded on — and an opacity
  // below 1 makes the row its own stacking context. A `position: fixed` dialog inside one is
  // ranked *within the row*, so the panel's z-index stopped competing with the sticky toolbar and
  // the app header and they painted straight over it. The same escape the line dialog takes out of
  // a transform-centred panel.
  const dialogNode =
    typeof document === "undefined" || dialog.kind === "none" ? null : (
      <>
        {dialog.kind === "price" && (
          <DialogShell title={PRICED[dialog.status].title} onClose={close}>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                record(dialog.status, finalPrice);
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
                  {PRICED[dialog.status].field} ({lot.currency})
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
                {dialog.status === "lost" ? (
                  <p style={NOTE}>
                    <strong>Leave it blank</strong> if you never saw the result. That records the
                    loss without inventing a price
                    {lot.currentBid !== null
                      ? ` — the last bid you recorded was ${lot.currentBid} ${lot.currency}, which is only what it had reached by then.`
                      : "."}
                  </p>
                ) : (
                  <p style={NOTE}>
                    The premium and the shipping are the sale&rsquo;s and are added there, once for
                    the whole parcel. This records the win only — you pay for the parcel as a whole
                    when the seller invoices it, and that is what turns it into a purchase.
                  </p>
                )}
              </DialogBody>
              <DialogActions
                actionLabel={isPending ? "Saving…" : PRICED[dialog.status].action}
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
            message="For a listing withdrawn by the seller, or ended without a sale. It carries no price datapoint, so anything recorded as a final price is cleared. The lot stays on the list and can be put back to watching."
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
            title="Back to watching"
            message={
              lot.status === "won"
                ? `This lot is recorded as won for ${lot.finalPrice} ${lot.currency}. Putting it back on the watchlist discards that price and the exchange rate frozen with it, and takes the lot back out of what the parcel will cost.`
                : `This lot is recorded as having gone for ${lot.finalPrice} ${lot.currency}. Putting it back on the watchlist discards that result and the exchange rate frozen with it.`
            }
            actionLabel="Discard the result"
            pendingLabel="Saving…"
            variant="destructive"
            isPending={isPending}
            error={error}
            onClose={close}
            onConfirm={() => record("watching")}
          />
        )}
      </>
    );

  return {
    actions,
    dialog: dialogNode && createPortal(dialogNode, document.body),
  };
}
