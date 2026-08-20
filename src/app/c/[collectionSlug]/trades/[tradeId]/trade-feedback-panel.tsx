"use client";

import { useState } from "react";
import { Icon } from "@/app/icons";
import { resolveTradeFeedbackAction } from "@/app/actions/trades";
import type { TradeFeedbackItem, TradeFeedbackRead } from "@/lib/trade-feedback";
import {
  tradeFeedbackActionLabels,
  tradeFeedbackRejectSentence,
} from "@/lib/trade-feedback-rules";

// **The collector's end of the partner's answers** (#641; ADR-0039 §10).
//
// An inbox on the trade, and deliberately an inbox rather than marks scattered down the two columns:
// what a collector does with feedback is work through it, and eight remarks spread over four section
// cards is eight things to go and find. It sits under the balance and the reservation notice for the
// reason both of those sit there — it is something to read *before* deciding the trade is settled,
// not a refusal to meet by pressing a button.
//
// **Accepting a rejection is the only thing here that touches the list**, and it is the collector's
// act: the partner asking for a line to come off does not take it off. Everything else records what
// was decided, which is what empties the inbox — and *Partner has responded* is derived from the
// inbox being non-empty, never from a status somebody has to maintain (ADR-0039 §6).
//
// **Handled items stay, behind a disclosure.** A dismissed note is still what the partner said, and a
// collector who half-remembers a remark should find it where they left it rather than reopening the
// link to read their own trade from the outside.

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

const MARK: React.CSSProperties = {
  display: "inline-block",
  fontSize: "0.6875rem",
  fontWeight: 600,
  padding: "0 0.35rem",
  borderRadius: "0.25rem",
  border: "1px solid var(--color-border-strong)",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

export function TradeFeedbackPanel({
  feedback,
  isPending,
  onRun,
}: {
  feedback: TradeFeedbackRead | undefined;
  isPending: boolean;
  onRun: (
    action: () => Promise<{ status: "success" } | { status: "error"; message: string }>
  ) => void;
}) {
  const [showHandled, setShowHandled] = useState(false);

  if (!feedback || feedback.items.length === 0) return null;

  const open = feedback.items.filter((item) => item.resolvedAt === null);
  const handled = feedback.items.filter((item) => item.resolvedAt !== null);

  return (
    <div
      style={{
        marginTop: "0.75rem",
        padding: "0.625rem 0.75rem",
        borderRadius: "0.5rem",
        border: `1px solid var(--color-${open.length > 0 ? "accent" : "border"})`,
        background: "var(--color-bg-page)",
        display: "grid",
        gap: "0.625rem",
      }}
    >
      <p style={{ ...NOTE, fontWeight: 600 }}>
        <Icon name="feedback" size="sm" />{" "}
        {open.length > 0
          ? `Your partner has responded — ${open.length} ${open.length === 1 ? "thing" : "things"} to look at`
          : "Your partner has responded"}
      </p>

      {open.map((item) => (
        <FeedbackRow key={item.id} item={item} isPending={isPending} onRun={onRun} />
      ))}

      {handled.length > 0 && (
        <div>
          <button type="button" style={LINK_BUTTON} onClick={() => setShowHandled((v) => !v)}>
            <Icon name={showHandled ? "collapse" : "expand"} size="sm" />
            {showHandled ? "Hide" : "Show"} {handled.length} handled
          </button>
          {showHandled && (
            <div style={{ display: "grid", gap: "0.625rem", marginTop: "0.625rem" }}>
              {handled.map((item) => (
                <FeedbackRow key={item.id} item={item} isPending={isPending} onRun={onRun} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One thing the partner said.
 *
 * Named by the line's **catalogue number**, which is how the valuation gate and the reservation
 * refusal name a line too — so an item here and the row it is about say the same string, and the
 * collector reads one list of lines rather than three vocabularies for the same thing. The note
 * about the whole exchange has no line and says so.
 */
function FeedbackRow({
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
  const labels = tradeFeedbackActionLabels(item.rejected);
  const resolved = item.resolvedAt !== null;

  return (
    <div style={{ display: "grid", gap: "0.2rem", opacity: resolved ? 0.65 : 1 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem", flexWrap: "wrap" }}>
        {item.rejected && <span style={MARK}>Rejected</span>}
        <span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
          {item.lineLabel ?? "About the whole exchange"}
        </span>
        {item.sectionName && (
          <span style={MUTED}>
            {item.sectionName}
            {item.side ? ` · ${item.side === "give" ? "what you send" : "what you receive"}` : ""}
          </span>
        )}
      </div>

      {item.rejected && item.side && (
        <p style={{ ...NOTE, color: "var(--color-text-secondary)" }}>
          {tradeFeedbackRejectSentence(item.side)}
        </p>
      )}
      {item.note && <p style={{ ...NOTE, fontStyle: "italic" }}>“{item.note}”</p>}

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        {resolved ? (
          <span style={MUTED}>
            {item.resolution === "applied" ? labels.accept : labels.dismiss} ·{" "}
            {new Date(item.resolvedAt as string).toLocaleDateString()}
          </span>
        ) : (
          <>
            <button
              type="button"
              style={{ ...LINK_BUTTON, cursor: isPending ? "default" : "pointer" }}
              disabled={isPending}
              onClick={() => onRun(() => resolveTradeFeedbackAction(item.id, "accept"))}
            >
              <Icon name="check" size="sm" /> {labels.accept}
            </button>
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
          </>
        )}
      </div>
    </div>
  );
}
