"use client";

import { useState } from "react";
import type { TradeFeedbackEntry } from "@/lib/trade-feedback";
import {
  tradeFeedbackRejectLabel,
  TRADE_FEEDBACK_NOTE_MAX,
} from "@/lib/trade-feedback-rules";
import type { TradeSide } from "@/lib/trade-rules";

// **The partner answering back** (#641) — and the partner's page's first and only client code.
//
// #640 built this page with no client bundle at all, because its second job is to be printed and a
// list that prints what has been scrolled to is not a list. That still holds for the **list**: every
// row is in the HTML on arrival and the arrangement is still links. What has changed is that the
// page now takes input, and input is typed one line at a time — so the controls, and nothing else,
// are client code. A save is a save of one thing, the moment it is made, with no Send button at the
// bottom of two hundred rows to forget to press.
//
// Each control owns its own state and its own request. There is no page-wide store and no refresh
// after a save: what came back from the write is what the control then shows, so two lines saving at
// once cannot overwrite each other's words.
//
// On paper the controls disappear and what was said stays — a partner printing their annotated copy
// gets the annotations, not a page of empty boxes.

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

async function postFeedback(
  token: string,
  lineId: string | null,
  note: string,
  rejected: boolean
): Promise<TradeFeedbackEntry | null> {
  const res = await fetch(`/api/t/${encodeURIComponent(token)}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lineId, note, rejected }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "That could not be saved.");
  return data.entry ?? null;
}

/** What was said, as text. The read-only rendering, and the printed one. */
function Said({ note, rejected, side }: { note: string; rejected: boolean; side?: TradeSide }) {
  if (!note && !rejected) return null;
  return (
    <span className="ts-fb-said">
      {rejected && side && <span className="ts-fb-mark">{tradeFeedbackRejectLabel(side)}</span>}
      {note && <span className="ts-fb-quote">{note}</span>}
    </span>
  );
}

function StateNote({ state }: { state: SaveState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "error") {
    return <span className="ts-fb-state ts-fb-bad ts-print-hide">{state.message}</span>;
  }
  return (
    <span className="ts-fb-state ts-print-hide">
      {state.kind === "saving" ? "Saving…" : "Saved"}
    </span>
  );
}

/**
 * One line's feedback: the mark, and the words.
 *
 * The mark saves the moment it is ticked; the note saves when the field is left, because saving on
 * every keystroke would be a request per letter and a debounce is a promise about a page that may be
 * closed mid-sentence. Leaving the field is the moment the partner is done with that line.
 */
export function LineFeedback({
  token,
  lineId,
  side,
  initial,
  disabled,
}: {
  token: string;
  lineId: string;
  side: TradeSide;
  /** What this partner already said about this line, from the server render. */
  initial: TradeFeedbackEntry | null;
  /** The exchange no longer takes comments. What was said is still shown — it is the record of the
   *  negotiation, and hiding it once a trade closes would lose the reason half the lines look the
   *  way they do. */
  disabled: boolean;
}) {
  const [note, setNote] = useState(initial?.note ?? "");
  const [saved, setSaved] = useState(initial?.note ?? "");
  const [rejected, setRejected] = useState(initial?.rejected ?? false);
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  async function save(nextNote: string, nextRejected: boolean) {
    setState({ kind: "saving" });
    try {
      const entry = await postFeedback(token, lineId, nextNote, nextRejected);
      setNote(entry?.note ?? "");
      setSaved(entry?.note ?? "");
      setRejected(entry?.rejected ?? false);
      setState({ kind: "saved" });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "That could not be saved.",
      });
    }
  }

  if (disabled) return <Said note={note} rejected={rejected} side={side} />;

  return (
    <div className="ts-fb">
      <label className="ts-fb-toggle ts-print-hide">
        <input
          type="checkbox"
          checked={rejected}
          onChange={(e) => {
            setRejected(e.target.checked);
            void save(note, e.target.checked);
          }}
        />
        {tradeFeedbackRejectLabel(side)}
      </label>
      <input
        className="ts-fb-input ts-print-hide"
        type="text"
        value={note}
        maxLength={TRADE_FEEDBACK_NOTE_MAX}
        placeholder="Add a note"
        aria-label="Note about this line"
        onChange={(e) => setNote(e.target.value)}
        // Nothing is sent while the words are still being typed, and nothing is sent that has not
        // changed — a partner tabbing down a list must not write a row per line they passed over.
        onBlur={() => {
          if (note.trim() !== saved.trim()) void save(note, rejected);
        }}
      />
      <StateNote state={state} />
      <span className="ts-print-only">
        <Said note={note} rejected={rejected} side={side} />
      </span>
    </div>
  );
}

/**
 * The note about the whole exchange.
 *
 * Its own box at the foot of the list rather than a line's, because the things a partner says here
 * are about the deal — *can we add something mint?*, *I can post on Friday* — and hanging them off
 * whichever line happened to be last would file them where nobody would look for them.
 */
export function TradeNoteFeedback({
  token,
  initial,
  disabled,
  closedMessage,
  collectorName,
}: {
  token: string;
  initial: TradeFeedbackEntry | null;
  disabled: boolean;
  closedMessage: string | null;
  collectorName: string;
}) {
  const [note, setNote] = useState(initial?.note ?? "");
  const [saved, setSaved] = useState(initial?.note ?? "");
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  async function save(next: string) {
    setState({ kind: "saving" });
    try {
      const entry = await postFeedback(token, null, next, false);
      setNote(entry?.note ?? "");
      setSaved(entry?.note ?? "");
      setState({ kind: "saved" });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "That could not be saved.",
      });
    }
  }

  if (disabled) {
    return (
      <section className="ts-fb-box">
        <h2 className="ts-fb-heading">Your comments</h2>
        {closedMessage && <p className="ts-note">{closedMessage}</p>}
        {note && <p className="ts-fb-quote">{note}</p>}
      </section>
    );
  }

  return (
    <section className="ts-fb-box">
      <h2 className="ts-fb-heading">Your comments</h2>
      <p className="ts-note ts-print-hide">
        Tick a line you do not want, or add a note to it — {collectorName} sees everything you leave
        here, and nothing you write changes the list itself. Use the box below for anything about the
        exchange as a whole.
      </p>
      <textarea
        className="ts-fb-textarea ts-print-hide"
        rows={3}
        value={note}
        maxLength={TRADE_FEEDBACK_NOTE_MAX}
        placeholder="A note about the whole exchange"
        aria-label="Note about the whole exchange"
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note.trim() !== saved.trim()) void save(note);
        }}
      />
      <StateNote state={state} />
      {note && <p className="ts-fb-quote ts-print-only">{note}</p>}
    </section>
  );
}
