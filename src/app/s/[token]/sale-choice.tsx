"use client";

import { useState } from "react";
import type { SaleShareLineView } from "@/lib/sale-share-choice";
import {
  SALE_CHOICE_HINT,
  SALE_CHOICE_PICKED_LABEL,
  saleChoicePrompt,
} from "@/lib/sale-share-rules";
import { SharePhotos } from "@/app/share/share-photos";

// **Which of these copies would you like?** (#699) — the buyer's half, and the only client code on
// this page.
//
// **The pictures are the control's whole point.** The three copies of a quantity listing are the
// same thing only as far as the listing was concerned: the centring, a corner perf, the exact shade
// differ, and none of that can be read out of words. So each option is its scans — enlarging on
// hover and opening full size on click (#666) — with the radio beside them rather than around them,
// because a picture that picked the copy when all the reader wanted was a closer look would be a
// picker that answers before it is asked.
//
// **What it saves is the swap itself**, unlike the trade page's proposal (#658): the copies move and
// the line stops being pending the moment this lands. The buyer may change it until the parcel is
// packed, which is what the hint under the question says, and the seller can override it afterwards
// — the parcel is still theirs to pack.
//
// **Nothing is picked until the buyer picks.** While nobody has chosen, the line names a set an
// automatic pick took (#697), and pre-selecting that one would present it as a decision the buyer
// had already taken part in.

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

async function postChoice(token: string, lineId: string, offerSetId: string): Promise<string> {
  const res = await fetch(`/api/s/${encodeURIComponent(token)}/choice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lineId, offerSetId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "That could not be saved.");
  return data.offerSetId as string;
}

export function LineSetChoice({
  token,
  line,
  open,
  closedMessage,
}: {
  token: string;
  line: SaleShareLineView;
  open: boolean;
  closedMessage: string | null;
}) {
  const answered = line.options.find((option) => option.chosen) ?? null;
  const [picked, setPicked] = useState<string | null>(answered?.offerSetId ?? null);
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  async function save(offerSetId: string) {
    const previous = picked;
    // Moved before the write comes back: a pick that waited reads as a pick that did not register,
    // and the buyer presses it again.
    setPicked(offerSetId);
    setState({ kind: "saving" });
    try {
      const saved = await postChoice(token, line.lineId, offerSetId);
      setPicked(saved);
      setState({ kind: "saved" });
    } catch (error) {
      // Back to what the server last said, so the page does not keep a choice the order never took.
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
        {saleChoicePrompt(line.options.length)}
        <span className="ts-choice-hint">{open ? SALE_CHOICE_HINT : closedMessage}</span>
      </p>

      <div className="ts-choice-opts">
        {line.options.map((option) => {
          const isPicked = picked === option.offerSetId;
          return (
            <div
              key={option.offerSetId}
              className="ts-choice-opt"
              data-picked={isPicked ? "true" : undefined}
            >
              <div className="ts-choice-pics">
                <SharePhotos
                  base={`/api/s/${encodeURIComponent(token)}/photos`}
                  photoIds={option.photoIds}
                />
                {option.photoIds.length === 0 && (
                  // Said rather than left as a gap: a copy with no scan is a copy the buyer cannot
                  // judge, and knowing that is itself worth knowing.
                  <span className="ts-choice-nopic">No scan</span>
                )}
              </div>
              <label className="ts-choice-pick">
                <input
                  type="radio"
                  name={`ss-choice-${line.lineId}`}
                  checked={isPicked}
                  disabled={!open || state.kind === "saving"}
                  onChange={() => void save(option.offerSetId)}
                />
                {option.label}
              </label>
              {isPicked && (
                <span className="ts-choice-badge ss-answered">{SALE_CHOICE_PICKED_LABEL}</span>
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
