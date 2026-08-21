"use client";

import { useState, useTransition, type FormEvent } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { setTradeLineFulfillmentAction } from "@/app/actions/trades";
import {
  TRADE_FULFILLMENTS,
  TRADE_FULFILLMENT_NOTE_MAX,
  tradeFulfillmentLabel,
  tradeFulfillmentSentence,
  type TradeFulfillment,
} from "@/lib/trade-realisation-rules";
import type { TradeSide } from "@/lib/trade-rules";
import { useInvalidateTradeDetail } from "./use-trade-detail-query";

// **What actually became of this line** (#642; ADR-0039 §11).
//
// The dialog is deliberately the whole of the writing surface for realisation, and it writes exactly
// two columns. It does **not** offer to change the quantity, the key or the figure: the agreement is
// what both sides shook hands on and the partner is holding a copy of it, so recording that reality
// diverged from it is a second layer rather than an edit to the first. That distinction is the issue,
// and a dialog that let a collector "correct" an agreed line here would erase it.
//
// **Four verdicts, worded per side.** One flag underneath and two words on top, the shape
// `tradeFeedbackRejectLabel` already gave the partner's rejection: of the collector's own material
// *I withdrew it*, of the partner's *Partner withdrew it*. Both struck-off verdicts are offered on
// both sides, because a parcel that arrives two short is as ordinary going out as coming in.
//
// **The note travels with the verdict**, always both. It is why a line was struck off, so leaving one
// behind while the verdict went back to *no verdict yet* would be an explanation of something nobody
// is claiming any more — the writer clears it, and the field goes with it here.

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const HINT: React.CSSProperties = {
  margin: "0.375rem 0 0",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.5,
};

const CHOICE: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "0.5rem",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  cursor: "pointer",
};

const CHOICE_ON: React.CSSProperties = {
  ...CHOICE,
  borderColor: "var(--color-accent-border, var(--color-border-strong))",
  background: "var(--color-accent-soft, var(--color-bg-page))",
};

/** What the dialog is opened about — enough to name the line and word the verdicts for its column. */
export interface TradeFulfillmentSubject {
  lineId: string;
  side: TradeSide;
  /** How the row reads it: the catalogue number and condition on the give side, the stamp on the
   *  receive side. The row already has the words; the dialog does not go and derive them again. */
  label: string;
  fulfillment: TradeFulfillment;
  note: string | null;
}

export function TradeFulfillmentDialog({
  collectionId,
  subject,
  onClose,
}: {
  collectionId: string;
  subject: TradeFulfillmentSubject;
  onClose: () => void;
}) {
  const { invalidateTrade } = useInvalidateTradeDetail();
  const [fulfillment, setFulfillment] = useState<TradeFulfillment>(subject.fulfillment);
  const [note, setNote] = useState(subject.note ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    startTransition(async () => {
      const result = await setTradeLineFulfillmentAction(subject.lineId, fulfillment, note);
      if (result.status === "success") {
        // The whole `trades` key: a verdict moves the realised balance, the shortfall against the
        // agreement, whether the trade can be closed, and — for a withdrawal — whether the copy is
        // free to be listed again.
        invalidateTrade(collectionId);
        onClose();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <DialogShell title={`What happened — ${subject.label}`} onClose={onClose} maxWidth="32rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <div
                role="radiogroup"
                aria-label="What became of this line"
                style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
              >
                {TRADE_FULFILLMENTS.map((option) => (
                  <label
                    key={option}
                    style={fulfillment === option ? CHOICE_ON : CHOICE}
                  >
                    <input
                      type="radio"
                      name="fulfillment"
                      value={option}
                      checked={fulfillment === option}
                      disabled={isPending}
                      onChange={() => setFulfillment(option)}
                      style={{ marginTop: "0.2rem" }}
                    />
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: "0.875rem",
                          fontWeight: 500,
                          color: "var(--color-text-primary)",
                        }}
                      >
                        {tradeFulfillmentLabel(option, subject.side)}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: "0.8125rem",
                          color: "var(--color-text-muted)",
                          lineHeight: 1.4,
                        }}
                      >
                        {tradeFulfillmentSentence(option, subject.side)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p style={HINT}>
                What was agreed does not change: the quantity, the key and both frozen figures stay
                exactly as your partner has them. What moves is the realised balance under the terms,
                and the difference between the two is yours to take up or let go.
              </p>
            </div>

            <div>
              <LabelWithError htmlFor="trade-fulfillment-note">Why (optional)</LabelWithError>
              <textarea
                id="trade-fulfillment-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={TRADE_FULFILLMENT_NOTE_MAX}
                disabled={isPending || fulfillment === "pending"}
                placeholder="Gum toned, kept it back"
                style={INPUT_STYLE}
              />
              <p style={HINT}>
                For your own memory of the parcel. Taking the verdict back clears it — a reason with
                nothing to explain reads as a verdict and is none.
              </p>
            </div>
          </div>
        </DialogBody>

        <DialogActions
          actionLabel={isPending ? "Recording…" : "Record it"}
          disabled={isPending}
          cancelDisabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}
