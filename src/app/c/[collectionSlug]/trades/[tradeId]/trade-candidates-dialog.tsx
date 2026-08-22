"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogFooter,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { ItemListItem } from "@/lib/items";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import type { AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  dismissTradeCopyProposalAction,
  setTradeCopyBlockAction,
  setTradeGiveLineItemAction,
} from "@/app/actions/trades";
import {
  TRADE_CANDIDATE_OFFER_HINT,
  TRADE_CANDIDATE_SEND_HINT,
  TRADE_CANDIDATE_SENDING_HINT,
} from "@/lib/trade-candidate-rules";
import {
  tradeProposalActionLabels,
  tradeProposalBanner,
  tradeProposalLapsedBanner,
  TRADE_PROPOSAL_CHIP_LABEL,
} from "@/lib/trade-proposal-rules";
import { Icon } from "@/app/icons";
import { useTradeLineCandidates, useInvalidateTradeDetail } from "./use-trade-detail-query";

// **Which of my copies could go instead of this one** (#657).
//
// The give side of a trade names a concrete copy, but a collection holding four of the same stamp in
// the same condition has not really decided *which* of them travels — and the partner is the one who
// should decide it (#658). This is the collector's half of that: the set the partner will be offered,
// and the control over what is in it.
//
// The copies are drawn with `InventoryItemRow`, the row every other screen draws a copy with, because
// the question being asked here is the question the Copies list exists for — which of these do I want
// to send. Thumbnail, copy number, where it is filed and what it cost are exactly what answers it.
//
// **Everything eligible is offered by default and the collector removes.** So the control is a tick
// that starts on, not one that starts off: the ordinary case is a collector who never opens this
// dialog at all and whose duplicates are all interchangeable, which is what it means for the pool to
// be derived. Unticking writes one row (`TradeCopyBlock`); ticking deletes it.
//
// **Since #658 this is the one screen the whole question is answered on**, and that is a correction
// rather than an addition. The first cut spread it over three: a chip on the row naming `Copy #128`,
// two entries behind the row's `⋮` to accept or decline, and this list — which showed every copy and
// not which one had been asked for. A collector could get all the way to *accept* without once seeing
// the piece they were agreeing to send. So the row's chip opens this, the request is stated at the
// **head** of the list with its two answers, the copy it names carries a mark, and the list itself
// carries **both** controls: a radio saying *this is the one that goes* and the tick saying *this one
// may be asked for*. Two questions, two controls, one screen, every copy with its picture.
//
// **The copy being sent has no tick**, only the selected radio. It is the promise, and holding back
// the thing you are promising is not a state — the server refuses it by name, and the pool never
// offers it, since `committedItemIds` keeps every copy already on the trade out.

const HINT: React.CSSProperties = {
  padding: "0.75rem 1rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)",
};

const GROUP_HEADING: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  padding: "0.3rem 0.75rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-secondary)",
  borderTop: "1px solid var(--color-border)",
  borderBottom: "1px solid var(--color-border)",
  background: "var(--color-bg-page)",
};

const EMPTY: React.CSSProperties = {
  padding: "2rem 1.5rem",
  textAlign: "center",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

/**
 * Both controls, stacked and **worded**.
 *
 * The first cut of this used a bare radio over a bare checkbox in the Copies list's 2.5rem selection
 * strip. Neither said what it did — two unlabelled boxes on a row of duplicates is a puzzle, not a
 * control — and at a checkbox's own size they were hard to hit besides. So each is a button with a
 * word on it, wide enough to be a target: *Send* and *Offered*, which is what the two questions
 * actually are. A column rather than a row because they are read in the order they are decided.
 */
const STRIP: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: "0.3rem",
  width: "7.5rem",
  flexShrink: 0,
  padding: "0.5rem 0.5rem 0.5rem 0.75rem",
};

const SMALL_BUTTON: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.25rem",
  width: "100%",
  padding: "0.3rem 0.4rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "0.75rem",
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** The copy that is going. A statement rather than a control — there is nothing to press, and a
 *  pressed-looking button on the one row that is already the answer is the thing that made the radio
 *  confusing. */
const SENDING_PILL: React.CSSProperties = {
  ...SMALL_BUTTON,
  cursor: "default",
  fontWeight: 600,
  color: "var(--color-success)",
  borderColor: "var(--color-success-border)",
  background: "var(--color-success-soft)",
};

/** Offered, and held back. The off state is drawn as an off state — muted, dashed — rather than as
 *  an unticked box, which said nothing about which of the two things it was. */
const OFFERED_ON: React.CSSProperties = { ...SMALL_BUTTON };
const OFFERED_OFF: React.CSSProperties = {
  ...SMALL_BUTTON,
  color: "var(--color-text-muted)",
  borderStyle: "dashed",
  background: "transparent",
};

/** The row the partner asked for, marked as a **row** and not only as a chip on it: the collector is
 *  comparing pictures down a column, and what they need first is which picture is the one in
 *  question. A rule down the edge, the shape the partner's own page marks an answered line with —
 *  the tint itself is the copy row's own `highlight`, since the row paints its own background and a
 *  colour behind it would only ever reach the strip. */
const ASKED_ROW: React.CSSProperties = {
  boxShadow: "inset 0.1875rem 0 0 0 var(--color-accent)",
  background: "var(--color-accent-soft)",
};

/** The request, at the head of the list rather than on the row it names. Two reasons: it is the one
 *  thing on this screen that is waiting on an answer, and the answer is *no* as often as it is
 *  *yes* — a decline that lived only as the absence of a click would be a decline nobody could make. */
const BANNER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  flexWrap: "wrap",
  padding: "0.75rem 1rem",
  borderBottom: "1px solid var(--color-accent-border)",
  background: "var(--color-accent-soft)",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
};

const BANNER_BUTTON: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
  padding: "0.3rem 0.65rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
  fontWeight: 500,
  cursor: "pointer",
};

const ASKED_CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.2rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-accent-border)",
  background: "var(--color-accent-soft)",
  color: "var(--color-accent)",
  whiteSpace: "nowrap",
};

export function TradeCandidatesDialog({
  collectionId,
  tradeId,
  lineId,
  areas,
  locations,
  baseCurrency,
  vendorMaps,
  onClose,
}: {
  collectionId: string;
  tradeId: string;
  lineId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  vendorMaps: AreaVendorMaps;
  onClose: () => void;
}) {
  const { data, isLoading } = useTradeLineCandidates(collectionId, tradeId, lineId);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const { invalidateTrade } = useInvalidateTradeDetail();

  /** Every write on this dialog goes through here: run it, refresh the whole `trades` key, and name
   *  the refusal. The row's own chip counts this pool and states this request, so a screen that
   *  refreshed only the dialog would be the screen disagreeing with the thing that opened it. */
  function run(action: () => Promise<{ status: "success" } | { status: "error"; message: string }>) {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      invalidateTrade(collectionId);
    });
  }

  /** One tick. The write is idempotent in both directions, so this is a plain call rather than a
   *  read-modify-write over a list the other tab may also be looking at. */
  function toggleOffered(itemId: string, blocked: boolean) {
    run(() => setTradeCopyBlockAction(tradeId, itemId, blocked));
  }

  /** The other control: which copy actually goes. Granting the partner's request is this same write
   *  — see `setTradeGiveLineItem` — so there is one path and not an accept beside a swap. */
  function send(itemId: string) {
    run(() => setTradeGiveLineItemAction(lineId, itemId));
  }

  function row(copy: ItemListItem, isLast: boolean, strip: React.ReactNode) {
    const asked = copy.id === data?.proposedItemId;
    return (
      <div
        key={copy.id}
        style={{ display: "flex", alignItems: "stretch", ...(asked ? ASKED_ROW : {}) }}
      >
        {strip}
        <div style={{ flex: 1, minWidth: 0 }}>
          <InventoryItemRow
            collectionId={collectionId}
            item={copy}
            areas={areas}
            locations={locations}
            baseCurrency={baseCurrency}
            primaryVendorId={
              copy.areaId ? (vendorMaps.primaryVendorByArea.get(copy.areaId) ?? null) : null
            }
            vendorMap={vendorMaps.vendorMapFor(copy.areaId, copy.issueId)}
            isLast={isLast}
            readOnly
            showCostBasis
            highlight={asked}
            highlightTone="accent"
            // The request, **on the copy it is about** (#662's rule holding inside a dialog too).
            // The banner above says what to do; this says which picture it is about, which is the
            // whole reason the decision was moved onto this screen.
            trailingChips={
              asked ? (
                <span style={ASKED_CHIP}>
                  <Icon name="feedback" size="sm" /> {TRADE_PROPOSAL_CHIP_LABEL}
                </span>
              ) : undefined
            }
          />
        </div>
      </div>
    );
  }

  if (typeof document === "undefined") return null;

  const candidates = data?.candidates ?? [];
  const editable = data?.editable ?? false;
  // The copy asked for, where it is still one of the alternatives. It may not be — a candidate can
  // be sold or promised elsewhere while the request sits there — and the banner is drawn either way,
  // because the request is still standing and still has to be answered.
  const askedFor = data?.proposedItemId
    ? (candidates.find((c) => c.copy.id === data.proposedItemId)?.copy ?? null)
    : null;
  const askedLabel = data?.proposedLabel ?? null;

  return createPortal(
    <DialogShell
      title="Alternatives on this line"
      onClose={onClose}
      maxWidth="min(96vw, 80rem)"
      height="min(90vh, 55rem)"
    >
      {/* **The request, and its two answers, at the head of the list it is about** (#658). Above
          the hint rather than below it: the collector opened this screen because a row said their
          partner had asked for something, and the first thing on it should be that. Granting it is
          the same write *Send this* below makes, which is why the button names the copy and nothing
          here calls itself "accept". */}
      {askedLabel && (
        <div style={BANNER}>
          <Icon name="feedback" size="sm" />
          <span style={{ flex: 1, minWidth: "16rem" }}>
            {askedFor ? tradeProposalBanner(askedLabel) : tradeProposalLapsedBanner(askedLabel)}
          </span>
          {editable && askedFor && (
            <button
              type="button"
              style={BANNER_BUTTON}
              disabled={isPending}
              onClick={() => send(askedFor.id)}
            >
              <Icon name="check" size="sm" /> {tradeProposalActionLabels(askedLabel).accept}
            </button>
          )}
          {/* Offered whatever the lock: a locked list still takes a decision about what the partner
              asked for, and dropping a request changes nothing that was agreed. */}
          <button
            type="button"
            style={BANNER_BUTTON}
            disabled={isPending}
            onClick={() => run(() => dismissTradeCopyProposalAction(lineId))}
          >
            <Icon name="reject" size="sm" /> {tradeProposalActionLabels(askedLabel).dismiss}
          </button>
        </div>
      )}

      <p style={HINT}>
        {data?.closedReason ??
          "Every copy below answers this line exactly — same stamp, condition, certificate and " +
            "format — so sending any of them changes no figure on this trade. Send this makes a " +
            "copy the one this line promises; Offered decides whether your partner is shown it " +
            "at all. A copy held back stays yours and stays available to every other trade."}
      </p>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {isLoading ? (
          <p style={EMPTY}>Loading copies…</p>
        ) : (
          <>
            {data?.promised && (
              <>
                <div style={GROUP_HEADING}>
                  <Icon name="trades" size="sm" /> Sending
                </div>
                {row(
                  data.promised,
                  candidates.length === 0,
                  <span style={STRIP}>
                    {/* A statement, and nothing beside it: this copy is the promise, and holding
                        back the thing you are promising is not a state the pool can be in. */}
                    <Tooltip content={TRADE_CANDIDATE_SENDING_HINT}>
                      <span style={SENDING_PILL}>
                        <Icon name="check" size="sm" /> Sending
                      </span>
                    </Tooltip>
                  </span>
                )}
              </>
            )}

            {candidates.length === 0 ? (
              <p style={EMPTY}>
                {data?.closedReason
                  ? "The alternatives to this line are settled."
                  : "No other copy of yours answers this line exactly. A copy differing in " +
                    "certificate or format is a different line, not an alternative — and one that " +
                    "is sold, gone, not yet in hand or promised to another trade is never offered."}
              </p>
            ) : (
              <>
                <div style={GROUP_HEADING}>
                  <Icon name="duplicate" size="sm" /> Alternatives ({candidates.length})
                </div>
                {candidates.map(({ copy, blocked }, i) =>
                  row(
                    copy,
                    i === candidates.length - 1,
                    <span style={STRIP}>
                      {/* **Which one goes.** One click, from the screen where the scans are — which
                          is the whole correction #658 made to its own first cut. */}
                      <Tooltip content={TRADE_CANDIDATE_SEND_HINT}>
                        <button
                          type="button"
                          style={SMALL_BUTTON}
                          disabled={!editable || isPending}
                          onClick={() => send(copy.id)}
                          aria-label={`Send copy #${copy.itemNo} instead`}
                        >
                          <Icon name="trades" size="sm" /> Send this
                        </button>
                      </Tooltip>
                      {/* **Whether the partner may ask for it.** Starts on: everything eligible is
                          offered by default and the collector removes. The word flips with the
                          state, because *what it is* reads where *what pressing it would do* has to
                          be worked out. */}
                      <Tooltip content={TRADE_CANDIDATE_OFFER_HINT}>
                        <button
                          type="button"
                          style={blocked ? OFFERED_OFF : OFFERED_ON}
                          disabled={!editable || isPending}
                          onClick={() => toggleOffered(copy.id, !blocked)}
                          aria-pressed={!blocked}
                          aria-label={`Offer copy #${copy.itemNo} to the partner`}
                        >
                          <Icon name={blocked ? "excluded" : "check"} size="sm" />{" "}
                          {blocked ? "Held back" : "Offered"}
                        </button>
                      </Tooltip>
                    </span>
                  )
                )}
              </>
            )}
          </>
        )}
      </div>

      <DialogFooter>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            Swapping stays inside this list, so no figure on the trade moves. Held back here, and
            here only — the copy stays available to every other trade.
          </span>
          <ErrorBubble>{error}</ErrorBubble>
          <DialogSecondaryButton onClick={onClose} disabled={isPending}>
            Done
          </DialogSecondaryButton>
        </div>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
