"use client";

import { useState } from "react";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { resolveTradeFeedbackAction } from "@/app/actions/trades";
import type { TradeFeedbackItem, TradeFeedbackRead } from "@/lib/trade-feedback";
import type { TradeReservationRead } from "@/lib/trade-reservations";
import type { TradeIntakeRead } from "@/lib/trade-intake";
import type { TradeProposalRead } from "@/lib/trade-proposals";
import { tradeFeedbackActionLabels } from "@/lib/trade-feedback-rules";
import {
  countTradeAttention,
  describeTradeAttention,
  firstTradeAttention,
  tradeAttentionSelector,
} from "@/lib/trade-line-signals";

// **What is left above the columns** (#662), which is what has no row to hang on.
//
// #641 gathered the partner's answers into an inbox here and #639 put the reservation collision
// beside it. Both are now marks on the lines they are about (`trade-line-signal-marks.tsx`), for the
// reason those panels turned out to fail on: a banner that says something about eight lines is eight
// lines to go and find in four section cards, while the row is where the collector is already
// looking. What survives up here is only what is genuinely about the **trade**:
//
//  - **The partner's note about the whole exchange.** There is no line to put it on — that is what
//    makes it different in kind rather than merely bigger — and it is the sentence that frames every
//    line remark below it.
//  - **A count of what is still unhandled, and a way into it.** Not a list: a list is what moved
//    down. The count keeps #639's other argument intact — the refusal on **Agree** is met while the
//    list is being read rather than by pressing the button — and *Go to the first* saves the hunt
//    that a count on its own would start.
//
// The counts are by **kind**, because the three are resolved in three different places: a listing is
// withdrawn, a remark is answered, a departure is written off (#642). And the strip is absent
// entirely when there is nothing to say: one that draws an empty reassurance on every trade is one a
// collector stops reading.

const NOTE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  color: "var(--color-text-primary)",
};

const MUTED: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

const LINK_BUTTON: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: 0,
  border: "none",
  background: "none",
  color: "var(--color-accent)",
  fontSize: "0.75rem",
  cursor: "pointer",
};

function noticeStyle(token: "error" | "warning" | "accent"): React.CSSProperties {
  return {
    padding: "0.625rem 0.75rem",
    borderRadius: "0.5rem",
    border: `1px solid var(--color-${token}-border)`,
    background: `var(--color-${token}-soft)`,
    display: "grid",
    gap: "0.375rem",
  };
}

export function TradeSignalsSummary({
  feedback,
  reservation,
  intake,
  proposals,
  isPending,
  onRun,
}: {
  feedback: TradeFeedbackRead | undefined;
  reservation: TradeReservationRead | undefined;
  /** The intake read (#644) — only its substitutions are about a line, and only those are counted
   *  here. Where the incoming material *is* belongs to the panel above, not to a count of what still
   *  wants looking at. */
  intake: TradeIntakeRead | undefined;
  /** The partner's copy requests (#658) — counted here for the reason a remark is: it is the partner
   *  talking, nobody else is going to answer it, and the strip's whole job is to say how many such
   *  things there are before the collector goes looking for them. */
  proposals: TradeProposalRead | undefined;
  isPending: boolean;
  onRun: (
    action: () => Promise<{ status: "success" } | { status: "error"; message: string }>
  ) => void;
}) {
  const [missed, setMissed] = useState(false);
  const sources = { feedback, reservation, intake, proposals };
  const counts = countTradeAttention(sources);
  const summary = describeTradeAttention(counts);
  // The whole-exchange note, open or handled. At most one exists — a partial unique index says so.
  const tradeNote = feedback?.items.find((item) => item.lineId === null) ?? null;

  if (!summary && !tradeNote) return null;

  // A collision blocks the agreement, so the strip takes its colour: error while something stands in
  // the way, warning while a promise rests on a copy that has gone, accent while it is only a
  // conversation.
  const tone =
    counts.listed > 0 ? "error" : counts.remarks + counts.proposed > 0 ? "accent" : "warning";

  return (
    <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
      {tradeNote && <TradeNote item={tradeNote} isPending={isPending} onRun={onRun} />}

      {summary && (
        <div style={noticeStyle(tone)}>
          <p style={NOTE}>
            <Icon name={counts.listed > 0 ? "warning" : "feedback"} size="sm" />{" "}
            {/* *Things*, not *lines*: a line can carry a remark and a collision at once, and the
                two are counted from two reads that share no key — so a figure claiming to count rows
                would be a figure that is one too many exactly when both are true. */}
            <strong>
              {counts.total} {counts.total === 1 ? "thing" : "things"} to look at
            </strong>{" "}
            — {summary}.{" "}
            <span style={MUTED}>Each is marked on its own row, with what to do in the row menu.</span>
          </p>
          <div>
            <button
              type="button"
              style={LINK_BUTTON}
              onClick={() => {
                const target = firstTradeAttention(sources);
                const el = target
                  ? document.querySelector(tradeAttentionSelector(target))
                  : null;
                if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
                setMissed(!el);
              }}
            >
              <Icon name="open" size="sm" /> Go to the first
            </button>
            {/* A row narrowed away by a column's own filters, or still below the pages fetched so
                far, is not there to go to. Saying so beats scrolling somewhere arbitrary and
                leaving the collector to work out that they have arrived nowhere. */}
            {missed && (
              <p style={{ ...MUTED, margin: "0.25rem 0 0" }}>
                That line is not on screen — it may be filtered out of its column, or further down
                one that has not loaded yet.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The partner's note about the whole exchange.
 *
 * It keeps its two buttons rather than a row menu, because it has no row: this *is* its surface, and
 * a `⋮` on a paragraph would be a menu on a notice. Handled, it stays and goes quiet — the same
 * bargain a handled remark on a line makes.
 */
function TradeNote({
  item,
  isPending,
  onRun,
}: {
  item: TradeFeedbackItem;
  isPending: boolean;
  onRun: (
    action: () => Promise<{ status: "success" } | { status: "error"; message: string }>
  ) => void;
}) {
  const labels = tradeFeedbackActionLabels(false);
  const resolved = item.resolvedAt !== null;

  return (
    <div
      style={{
        padding: "0.625rem 0.75rem",
        borderRadius: "0.5rem",
        border: `1px solid var(--color-${resolved ? "border" : "accent"})`,
        background: "var(--color-bg-page)",
        display: "grid",
        gap: "0.375rem",
        opacity: resolved ? 0.7 : 1,
      }}
    >
      <p style={{ ...NOTE, fontWeight: 600 }}>
        <Icon name="feedback" size="sm" /> Your partner said, about the whole exchange
      </p>
      <p style={{ ...NOTE, fontStyle: "italic" }}>“{item.note}”</p>
      {resolved ? (
        <span style={MUTED}>
          {item.resolution === "applied" ? labels.accept : labels.dismiss} ·{" "}
          {new Date(item.resolvedAt as string).toLocaleDateString()}
        </span>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <Tooltip content="Marks it dealt with. Nothing on the list changes.">
            <button
              type="button"
              style={{ ...LINK_BUTTON, cursor: isPending ? "default" : "pointer" }}
              disabled={isPending}
              onClick={() => onRun(() => resolveTradeFeedbackAction(item.id, "accept"))}
            >
              <Icon name="check" size="sm" /> {labels.accept}
            </button>
          </Tooltip>
          <button
            type="button"
            style={{
              ...LINK_BUTTON,
              color: "var(--color-text-muted)",
              cursor: isPending ? "default" : "pointer",
            }}
            disabled={isPending}
            onClick={() => onRun(() => resolveTradeFeedbackAction(item.id, "dismiss"))}
          >
            {labels.dismiss}
          </button>
        </div>
      )}
    </div>
  );
}
