"use client";

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { resolveTradeFeedbackAction, type TradeActionState } from "@/app/actions/trades";
import type { TradeLineSignals } from "@/lib/trade-line-signals";
import {
  tradeFeedbackActionLabels,
  tradeFeedbackRejectLabel,
  tradeFeedbackRejectSentence,
} from "@/lib/trade-feedback-rules";
import {
  TRADE_FULFILLMENT_TONE,
  tradeFulfillmentLabel,
  tradeFulfillmentSentence,
} from "@/lib/trade-realisation-rules";
import type { DepartedReason } from "@/lib/trade-reservation-rules";
import type { TradeSide } from "@/lib/trade-rules";
import { Icon } from "@/app/icons";

// **A signal about a line, drawn on the line** (#662).
//
// This is the reversal of #641's inbox and #639's notice, and the argument is the row: a banner that
// says something about eight lines is eight lines to go and find in four section cards, while the
// row is where the collector is already looking and the only place where *this one* needs no
// explaining. What is left above the columns is what has no row — the partner's note about the whole
// exchange, and a count with a jump (`trade-signals-summary.tsx`).
//
// The marks are **chips in the row's own chip vocabulary**, not a second surface: the same shapes
// and the same tones the copy row already says *Sold*, *No longer held* and *Promised* in, with the
// detail in the shared `Tooltip`. Both sides draw the same component, so a rejection reads the same
// on a copy row and on a receive row — one thing said once.
//
// **The action goes in the row's `⋮`**, never beside the chip. Accepting a rejection, keeping the
// line, marking a remark done: they are row actions, and the app has one place for those.
//
// A **handled** remark stays, muted. It is still what the partner said, and a collector who
// half-remembers one should find it where they left it rather than reopening the link to read their
// own trade from the outside — #641's disclosure, re-homed onto the line it was about.
//
// #642's verdict joins them here rather than getting a surface of its own, and for the same argument:
// *this line did not go in the parcel* is a fact about one row, and the row is where it belongs. It
// is drawn only once somebody has answered — every line of a freshly agreed trade is pending, and a
// mark on all of them would be a mark that says nothing.

const CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.2rem",
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

function toneChip(token: "error" | "warning" | "accent"): React.CSSProperties {
  return {
    ...CHIP,
    color: `var(--color-${token})`,
    borderColor: `var(--color-${token}-border)`,
    background: `var(--color-${token}-soft)`,
  };
}

/** The three ways a promised copy can already be gone (#639, widened by #644). A table rather than
 *  a chain of ternaries: each departure is a different thing to have happened, and the word, the
 *  icon and the sentence have to agree about which one it was. */
const DEPARTED_LABEL: Record<DepartedReason, string> = {
  sold: "Sold elsewhere",
  traded: "Traded away",
  disposed: "No longer held",
};

const DEPARTED_ICON: Record<DepartedReason, "sell" | "trades" | "disposed"> = {
  sold: "sell",
  traded: "trades",
  disposed: "disposed",
};

const DEPARTED_HINT: Record<DepartedReason, string> = {
  sold: "This copy has since sold elsewhere, so the promise no longer rests on anything.",
  traded: "This copy has since gone to another partner in a closed trade, so the promise no longer rests on anything.",
  disposed: "This copy is no longer held, so the promise no longer rests on anything.",
};

const HANDLED_CHIP: React.CSSProperties = {
  ...CHIP,
  color: "var(--color-text-muted)",
  fontStyle: "italic",
};

/** Muted but not italic — the italic is #641's *this was said and dealt with*, and a line that simply
 *  went in the parcel is not a quotation of anybody. */
const QUIET_CHIP: React.CSSProperties = {
  ...CHIP,
  color: "var(--color-text-muted)",
};

/** What the partner said, in one hover. The mark itself carries the verdict; this carries the words
 *  and, where it has been dealt with, what was decided and when. */
function feedbackHint(signals: TradeLineSignals, side: TradeSide): string {
  const item = signals.feedback!;
  const parts: string[] = [];
  if (item.rejected) parts.push(tradeFeedbackRejectSentence(side));
  if (item.note) parts.push(`“${item.note}”`);
  if (item.resolvedAt) {
    const labels = tradeFeedbackActionLabels(item.rejected);
    parts.push(
      `${item.resolution === "applied" ? labels.accept : labels.dismiss} · ${new Date(
        item.resolvedAt
      ).toLocaleDateString()}`
    );
  } else {
    parts.push("Deal with it from this row's menu.");
  }
  return parts.join(" ");
}

/**
 * The marks for one line, drawn at the end of the row's last chip line — where the copy row already
 * puts *Sold*, *No longer held* and *Promised*, so a signal lands among the row's other states
 * rather than beside them.
 */
export function TradeLineSignalMarks({
  signals,
  side,
}: {
  signals: TradeLineSignals;
  /** Which column the row is in. The partner's rejection is **one flag with two words on top** —
   *  of the collector's material they say *not wanted*, of their own *cannot send* — and one label
   *  would be wrong on one side of every list. */
  side: TradeSide;
}) {
  const { feedback, listed, departed, realisation, substituted } = signals;
  return (
    <>
      {/* **What became of this line** (#642). A struck-off line warns — it is the difference between
          the plan and the parcel, and what the realised balance under the terms is missing. A
          fulfilled one is muted: the ordinary outcome has nothing to announce, and a row of ticks
          down a finished trade is a row nobody reads. Nothing at all while it is `pending`, which is
          what the index already guarantees. */}
      {realisation && (
        <Tooltip
          content={
            tradeFulfillmentSentence(realisation.fulfillment, side) +
            (realisation.note ? ` “${realisation.note}”` : "")
          }
        >
          <span
            style={
              TRADE_FULFILLMENT_TONE[realisation.fulfillment] === "warning"
                ? toneChip("warning")
                : QUIET_CHIP
            }
          >
            <Icon
              name={
                realisation.fulfillment === "withdrawn"
                  ? "withdraw"
                  : realisation.fulfillment === "missing"
                    ? "parcel"
                    : "check"
              }
              size="sm"
            />{" "}
            {tradeFulfillmentLabel(realisation.fulfillment, side)}
          </span>
        </Tooltip>
      )}

      {/* **The collision, on the copy it is about** (#639). It blocks: promising a partner a stamp a
          stranger can buy in the next minute is a promise that cannot be kept, so it draws in error
          and names the listing — what resolves it is pausing or withdrawing that one. Getting there
          is a row action, in the menu with the others. */}
      {listed.map((copy) => (
        <Tooltip
          key={copy.offer.offerId}
          content={`Live on ${copy.offer.platformName} as offer #${copy.offer.offerNo} (${copy.offer.label}). Withdraw or pause the listing before agreeing this trade.`}
        >
          <span style={toneChip("error")}>
            <Icon name="sell" size="sm" /> Listed · #{copy.offer.offerNo}
          </span>
        </Tooltip>
      ))}

      {/* **The departure warns and never blocks.** The copy is already gone; refusing to record the
          agreement would not bring it back, and what resolves it is a withdrawal (#642). Sold is
          told apart from no-longer-held because the two are answered in different places. */}
      {departed && (
        <Tooltip content={DEPARTED_HINT[departed.reason]}>
          <span style={toneChip("warning")}>
            <Icon name={DEPARTED_ICON[departed.reason]} size="sm" />{" "}
            {DEPARTED_LABEL[departed.reason]}
          </span>
        </Tooltip>
      )}

      {/* Came as something else (#642, shipped with #644). Derived from the line and the copy the
          scan tile became, never stored: it is the two disagreeing, and a column saying so would be
          a third version of the same fact that goes stale the first time a copy is reassigned to
          another variant. Shown for confirmation rather than as a fault — a partner substituting a
          near-enough piece is ordinary, and the collector either meant it or has a copy filed wrong. */}
      {substituted && (
        <Tooltip
          content={`This line asked for ${substituted.promisedLabel} and what arrived was identified as ${substituted.arrivedLabel}. Either the partner sent something else, or the copy is filed under the wrong stamp.`}
        >
          <span style={toneChip("accent")}>
            <Icon name="variant" size="sm" /> Came as {substituted.arrivedLabel}
          </span>
        </Tooltip>
      )}

      {feedback && (
        <Tooltip content={feedbackHint(signals, side)}>
          <span
            style={
              feedback.resolvedAt
                ? HANDLED_CHIP
                : feedback.rejected
                  ? toneChip("warning")
                  : toneChip("accent")
            }
          >
            <Icon name="feedback" size="sm" />{" "}
            {feedback.rejected ? tradeFeedbackRejectLabel(side) : "Partner note"}
          </span>
        </Tooltip>
      )}
    </>
  );
}

/**
 * What the row's `⋮` offers about its signals.
 *
 * Entries and not buttons, because row actions have one home (`RowActionsMenu`) and a cluster beside
 * a chip is the thing that home exists to prevent. They are offered **whatever the lock** — a locked
 * list still takes a decision about what the partner asked for, and accepting a rejection while the
 * trade is `agreed` is refused by name, by the server, with the step that would unfreeze it.
 *
 * Recording what happened (#642) is the same kind of entry for the same reason, and its window is the
 * mirror image of the lock's: it is offered **only** while the trade is agreed, because before then
 * nothing has happened and after `closed` it is history.
 */
export function tradeLineSignalActions({
  signals,
  collectionSlug,
  isPending,
  canRecordRealisation,
  onRecordRealisation,
  onRun,
}: {
  signals: TradeLineSignals;
  collectionSlug: string;
  isPending: boolean;
  /** The trade is `agreed`, which is the one status a verdict may be written in. A fact about the
   *  trade rather than about this row, which is why it arrives beside the signals rather than in
   *  them. */
  canRecordRealisation: boolean;
  onRecordRealisation: () => void;
  onRun: (action: () => Promise<TradeActionState>) => void;
}): RowAction[] {
  const actions: RowAction[] = [];

  // First, because it is the thing a collector opens an agreed trade to do: the parcels have been
  // packed and opened, and what is left is to say what was in them.
  if (canRecordRealisation) {
    actions.push({
      key: "realisation",
      label: signals.realisation ? "Change what happened…" : "Record what happened…",
      icon: "parcel",
      hint: "Sent, arrived, withdrawn or never arrived. What you agreed is not changed by it.",
      disabled: isPending,
      onSelect: onRecordRealisation,
    });
  }

  // The listing, as an address rather than a navigation (#557): what a collector does about a
  // collision is open the offer and pause it, and an entry that is a real link opens in a tab.
  for (const copy of signals.listed) {
    actions.push({
      key: `offer-${copy.offer.offerId}`,
      label: `Open offer #${copy.offer.offerNo}`,
      icon: "sell",
      hint: `Live on ${copy.offer.platformName} — this is what blocks agreeing the trade.`,
      href: `/c/${collectionSlug}/offers/${copy.offer.offerId}`,
    });
  }

  const feedback = signals.feedback;
  if (feedback && feedback.resolvedAt === null) {
    const labels = tradeFeedbackActionLabels(feedback.rejected);
    actions.push(
      {
        key: "feedback-accept",
        label: labels.accept,
        icon: feedback.rejected ? "delete" : "check",
        // Accepting a rejection is the one thing here that touches the list, and it deletes a line.
        danger: feedback.rejected,
        disabled: isPending,
        hint: feedback.rejected
          ? "The partner asked for this line to come off."
          : undefined,
        onSelect: () => onRun(() => resolveTradeFeedbackAction(feedback.id, "accept")),
      },
      {
        key: "feedback-dismiss",
        label: labels.dismiss,
        icon: "reject",
        disabled: isPending,
        onSelect: () => onRun(() => resolveTradeFeedbackAction(feedback.id, "dismiss")),
      }
    );
  }

  return actions;
}

/** The row's own entries, then what its signals offer, set apart by a rule — but only where there
 *  is something above to be set apart from. A locked list offers the signal entries alone, and a
 *  divider over the first of them would be a rule under nothing. */
export function withTradeLineSignalActions(
  base: RowAction[],
  signalActions: RowAction[]
): RowAction[] {
  if (signalActions.length === 0) return base;
  const [first, ...rest] = signalActions;
  return [...base, { ...first, separatorBefore: base.length > 0 }, ...rest];
}
