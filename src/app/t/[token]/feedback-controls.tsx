"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TradeFeedbackEntry } from "@/lib/trade-feedback";
import {
  tradeFeedbackRejectLabel,
  tradeFeedbackSideSummary,
  TRADE_FEEDBACK_NOTE_MAX,
} from "@/lib/trade-feedback-rules";
import type { TradeSide } from "@/lib/trade-rules";

// **The partner answering back** (#641), and seeing what they already answered (#667) — the client
// code on this page.
//
// #640 built it with no client bundle at all: the **list** is still one server render, every row in
// the HTML on arrival and the arrangement still links. What changed is that the page takes input,
// and input is given one line at a time — so the controls, and nothing else, are client code. A save
// is a save of one thing, the moment it is made, with no Send button at the bottom of two hundred
// rows to forget to press.
//
// What each control saves is its own; what they all read is **one state** (#667). The entries the
// server rendered go into `PartnerFeedbackProvider` and everything that draws them reads from there:
// the mark on the row, the words on it, and the count at the head of its side are the same fact
// drawn three times. That is the whole reason for a store on a page that otherwise has none — three
// places showing one answer, where a per-control state would leave the count to be corrected by a
// reload and the strike-through to appear one refresh after the tick that asked for it.
//
// The provider wraps the **server-rendered** list: the sections arrive as `children`, so nothing
// about the list becomes client code by being inside it.

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

interface PartnerFeedback {
  token: string;
  /** Whether this exchange still takes comments. When it does not, what was said still shows. */
  canLeave: boolean;
  /** What the partner has said, by line id. A line with nothing said has no entry. */
  byLine: Record<string, TradeFeedbackEntry>;
  /** Record what came back from a write. `null` is the partner having withdrawn what they said,
   *  which is a row deleted rather than an empty one kept. */
  put: (lineId: string, entry: TradeFeedbackEntry | null) => void;
}

const PartnerFeedbackContext = createContext<PartnerFeedback | null>(null);

function usePartnerFeedback(): PartnerFeedback {
  const value = useContext(PartnerFeedbackContext);
  // Every consumer here is rendered inside the provider by `page.tsx`; the throw is what says so to
  // the next person who moves one of them out.
  if (!value) throw new Error("Partner feedback is only available inside PartnerFeedbackProvider.");
  return value;
}

export function PartnerFeedbackProvider({
  token,
  canLeave,
  initial,
  children,
}: {
  token: string;
  canLeave: boolean;
  /** What the server rendered — so a reload shows every answered line marked, rather than an empty
   *  page that fills in once something is typed. */
  initial: Record<string, TradeFeedbackEntry>;
  children: ReactNode;
}) {
  const [byLine, setByLine] = useState(initial);
  const put = useCallback((lineId: string, entry: TradeFeedbackEntry | null) => {
    setByLine((previous) => {
      const next = { ...previous };
      if (entry) next[lineId] = entry;
      else delete next[lineId];
      return next;
    });
  }, []);
  const value = useMemo(
    () => ({ token, canLeave, byLine, put }),
    [token, canLeave, byLine, put]
  );
  return (
    <PartnerFeedbackContext.Provider value={value}>{children}</PartnerFeedbackContext.Provider>
  );
}

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

/** What was said, as text — the row's own record of it, and what a finished exchange leaves behind.
 *
 *  The words are **on the row** rather than only in the box that wrote them (#667): a note read
 *  through a one-line input is a note the partner has to click into to finish reading, on the one
 *  page in the app where nobody can search for it instead. */
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
    return <span className="ts-fb-state ts-fb-bad">{state.message}</span>;
  }
  return <span className="ts-fb-state">{state.kind === "saving" ? "Saving…" : "Saved"}</span>;
}

/**
 * The row itself, so that what the partner said can mark it (#667).
 *
 * A client wrapper around a **server-rendered** row: the stamp, its scans and its figures arrive as
 * `children` and stay server code. All this adds is the two attributes the stylesheet marks the row
 * by — a line with a remark on it, and a line struck out — which have to move the moment the tick
 * is made rather than at the next reload.
 */
export function ShareRow({ lineId, children }: { lineId: string; children: ReactNode }) {
  const { byLine } = usePartnerFeedback();
  const entry = byLine[lineId];
  return (
    <div
      className="ts-row"
      data-said={entry?.note ? "true" : undefined}
      data-rejected={entry?.rejected ? "true" : undefined}
    >
      {children}
    </div>
  );
}

/**
 * What this side is carrying, at its head (#667).
 *
 * Counted over the lines actually on this column, so the two sides answer for their own — and drawn
 * only when there is something to say, since *0 notes* is a sentence about nothing.
 */
export function SideRemarks({ side, lineIds }: { side: TradeSide; lineIds: string[] }) {
  const { byLine } = usePartnerFeedback();
  let notes = 0;
  let rejected = 0;
  for (const lineId of lineIds) {
    const entry = byLine[lineId];
    if (!entry) continue;
    if (entry.note) notes += 1;
    if (entry.rejected) rejected += 1;
  }
  const summary = tradeFeedbackSideSummary(side, { notes, rejected });
  if (!summary) return null;
  return <p className="ts-side-said">{summary}</p>;
}

/**
 * One line's feedback: the mark, and the words.
 *
 * The mark saves the moment it is ticked; the note saves when the field is left, because saving on
 * every keystroke would be a request per letter and a debounce is a promise about a page that may be
 * closed mid-sentence. Leaving the field is the moment the partner is done with that line.
 *
 * An answered line settles back into **what was said**, with the editor a click away (#667). A row
 * carrying a box of text is a row that reads as a form; a row carrying a sentence reads as a row
 * that has been dealt with, which on a list of two hundred is the difference between finding the
 * four lines that were and re-reading all of them.
 */
export function LineFeedback({ lineId, side }: { lineId: string; side: TradeSide }) {
  const { token, canLeave, byLine, put } = usePartnerFeedback();
  const entry = byLine[lineId] ?? null;
  const note = entry?.note ?? "";
  const rejected = entry?.rejected ?? false;

  // What is being typed, while it is being typed. Everything else about this line lives in the
  // provider; a draft belongs to the field it is in and to nothing else.
  const [draft, setDraft] = useState(note);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  async function save(nextNote: string, nextRejected: boolean, { collapse }: { collapse: boolean }) {
    setState({ kind: "saving" });
    // Shown struck out before the write comes back: a tick that took a moment to take effect reads
    // as a tick that did not register, and the partner ticks it again. What the row draws is the
    // mark and the words; the rest of the entry is carried over rather than invented, and the
    // server's own copy replaces all of it a moment later.
    put(lineId, {
      note: nextNote.trim() || null,
      rejected: nextRejected,
      updatedAt: entry?.updatedAt ?? "",
      resolution: entry?.resolution ?? null,
    });
    try {
      const saved = await postFeedback(token, lineId, nextNote, nextRejected);
      put(lineId, saved);
      setDraft(saved?.note ?? "");
      setState({ kind: "saved" });
      if (collapse) setEditing(false);
    } catch (error) {
      // Back to what the server last said, so the row does not keep a mark the exchange never took.
      put(lineId, entry);
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "That could not be saved.",
      });
    }
  }

  if (!canLeave) return <Said note={note} rejected={rejected} side={side} />;

  if ((note || rejected) && !editing) {
    return (
      <div className="ts-fb">
        <Said note={note} rejected={rejected} side={side} />
        <button
          type="button"
          className="ts-fb-edit"
          onClick={() => {
            setDraft(note);
            setEditing(true);
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="ts-fb">
      <label className="ts-fb-toggle">
        <input
          type="checkbox"
          checked={rejected}
          // The tick keeps the editor open: ticking a line and then saying why is one thought, and
          // a box that closed itself under the words about to be typed would be the wrong half of
          // the answer taken away.
          onChange={(e) => {
            setEditing(true);
            void save(draft, e.target.checked, { collapse: false });
          }}
        />
        {tradeFeedbackRejectLabel(side)}
      </label>
      <input
        className="ts-fb-input"
        type="text"
        value={draft}
        maxLength={TRADE_FEEDBACK_NOTE_MAX}
        placeholder="Add a note"
        aria-label="Note about this line"
        onChange={(e) => setDraft(e.target.value)}
        // Nothing is sent while the words are still being typed, and nothing is sent that has not
        // changed — a partner tabbing down a list must not write a row per line they passed over.
        onBlur={() => {
          if (draft.trim() !== note.trim()) void save(draft, rejected, { collapse: true });
          else if (note || rejected) setEditing(false);
        }}
      />
      <StateNote state={state} />
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
  initial,
  closedMessage,
  collectorName,
}: {
  initial: TradeFeedbackEntry | null;
  closedMessage: string | null;
  collectorName: string;
}) {
  const { token, canLeave } = usePartnerFeedback();
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

  if (!canLeave) {
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
      <p className="ts-note">
        Tick a line you do not want, or add a note to it — {collectorName} sees everything you leave
        here, and nothing you write changes the list itself. Use the box below for anything about the
        exchange as a whole.
      </p>
      <textarea
        className="ts-fb-textarea"
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
    </section>
  );
}
