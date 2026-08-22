"use client";

import { useState } from "react";
import type { TradeShareChoiceLine } from "@/lib/trade-proposals";
import {
  tradeProposalPrompt,
  TRADE_PROPOSAL_CLEAR_HINT,
  TRADE_PROPOSAL_CURRENT_LABEL,
  TRADE_PROPOSAL_PICKED_LABEL,
} from "@/lib/trade-proposal-rules";
import { SharePhotos } from "./share-photos";

// **Which of these copies would you like?** (#658) — the partner's half, and the second thing on this
// page that is client code (#641's controls being the first).
//
// It is drawn only where there is a **choice**: a give line with at least one alternative beside the
// copy it names. A line with a single candidate is drawn exactly as #640 draws it, because nothing
// should gain a control that has one option.
//
// **The pictures are the control's whole point.** Deciding between two copies of the same stamp in
// the same condition means looking at the perforation, the cancel and the gum, so each option is its
// scans — at the size #666 gave them, enlarging on hover and opening full size on click. The radio
// sits beside the pictures rather than around them: a picture that picked the copy when all the
// reader wanted was a closer look would be a picker that answers before it is asked.
//
// **What it saves is a request, not a change.** The write lands in `TradeLine.proposedItemId` and
// moves nothing — not a figure, not the packing list, not what the collector promised — until they
// accept it on their own screen. The copy already chosen is the first option, so picking it again is
// how the request is taken back; there is no separate clear to disagree with the group.

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

async function postProposal(
  token: string,
  lineId: string,
  itemId: string | null
): Promise<string | null> {
  const res = await fetch(`/api/t/${encodeURIComponent(token)}/proposal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lineId, itemId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "That could not be saved.");
  return data.proposedItemId ?? null;
}

export function LineCopyChoice({
  token,
  choice,
}: {
  token: string;
  choice: TradeShareChoiceLine;
}) {
  const current = choice.options.find((option) => option.current) ?? null;
  const standing = choice.options.find((option) => option.proposed) ?? null;
  // What is picked right now. Starts on the partner's own standing request where there is one, and
  // on the collector's copy otherwise — the two are never the same thing, which is why the badges
  // name them apart.
  const [picked, setPicked] = useState<string | null>(
    standing?.itemId ?? current?.itemId ?? null
  );
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  // A request left standing on a list that has since been settled. Said once, on the row, because the
  // alternative is a partner who goes on thinking a swap is coming.
  if (choice.options.length === 0) {
    return choice.unansweredNote ? (
      <p className="ts-choice-closed">{choice.unansweredNote}</p>
    ) : null;
  }

  async function save(itemId: string) {
    const previous = picked;
    // Moved before the write comes back: a pick that waited reads as a pick that did not register,
    // and the partner presses it again.
    setPicked(itemId);
    setState({ kind: "saving" });
    try {
      const saved = await postProposal(token, choice.lineId, itemId);
      setPicked(saved ?? current?.itemId ?? null);
      setState({ kind: "saved" });
    } catch (error) {
      // Back to what the server last said, so the row does not keep a request the exchange never
      // took.
      setPicked(previous);
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "That could not be saved.",
      });
    }
  }

  return (
    <div className="ts-choice">
      <p className="ts-choice-prompt">
        {tradeProposalPrompt(choice.options.length)}
        <span className="ts-choice-hint">
          {choice.open ? TRADE_PROPOSAL_CLEAR_HINT : choice.closedMessage}
        </span>
      </p>

      <div className="ts-choice-opts">
        {choice.options.map((option) => {
          const isPicked = picked === option.itemId;
          return (
            <div
              key={option.itemId}
              className="ts-choice-opt"
              data-picked={isPicked && !option.current ? "true" : undefined}
              data-current={option.current ? "true" : undefined}
            >
              <div className="ts-choice-pics">
                <SharePhotos token={token} photoIds={option.photoIds} />
                {option.photoIds.length === 0 && (
                  // Said rather than left as a gap: a copy with no scan is a copy the partner cannot
                  // judge, and knowing that is itself worth knowing.
                  <span className="ts-choice-nopic">No scan</span>
                )}
              </div>
              <label className="ts-choice-pick">
                <input
                  type="radio"
                  name={`ts-choice-${choice.lineId}`}
                  checked={isPicked}
                  disabled={!choice.open || state.kind === "saving"}
                  onChange={() => void save(option.itemId)}
                />
                {option.label}
              </label>
              {option.current && (
                <span className="ts-choice-badge">{TRADE_PROPOSAL_CURRENT_LABEL}</span>
              )}
              {isPicked && !option.current && (
                <span className="ts-choice-badge" data-tone="asked">
                  {TRADE_PROPOSAL_PICKED_LABEL}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {state.kind !== "idle" && (
        <span className={state.kind === "error" ? "ts-fb-state ts-fb-bad" : "ts-fb-state"}>
          {state.kind === "error"
            ? state.message
            : state.kind === "saving"
              ? "Saving…"
              : "Saved"}
        </span>
      )}
    </div>
  );
}
