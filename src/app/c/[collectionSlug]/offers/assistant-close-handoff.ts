"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The page half of the **Colnect close handoff** (#729): how "close this listing on Colnect" crosses
// from an offer's own screen into the Assistant, and how the outcome comes back.
//
// The export handoff's contract again (#690) — the page writes the task into a hidden node as JSON,
// the extension answers with `data-*` attributes on that same node — on a node of its own, because
// the listing node on the same screen already carries this offer's listing report.
//
// **The extension closes; this screen withdraws.** What lands on the node is only whether Colnect
// confirmed the close, and the offer's state is changed here, by the same `setOfferStateAction` the
// Withdraw confirmation calls — #407's rule, the extension reports and the instance decides.
//
// Mirrored by hand in `extension/src/core/colnect-close-handoff.ts` — separate builds, no import path
// between them.

/** The element the extension looks for. Part of the contract. */
export const CLOSE_ELEMENT_ID = "stamporama-assistant-colnect-close";

const STATE_ATTRIBUTE = "data-close-state";
const REQUEST_ATTRIBUTE = "data-close-request";
const MESSAGE_ATTRIBUTE = "data-close-message";

/** How long a close may go unanswered before the page stops waiting. */
const CLOSE_TIMEOUT_MS = 60_000;

/**
 * How far a close has got — the extension's own vocabulary, mirrored.
 *
 * `closed` is Colnect's `OK` and nothing else; `error` means nothing was closed that the Assistant
 * knows of, and the offer is left exactly as it was.
 */
export type CloseHandoffState = "running" | "closed" | "error";

export interface CloseTask {
  offerId: string;
  collectionId: string;
  /** `OfferDetail.colnectSaleId` (#696). */
  saleId: string;
  label: string;
}

export interface CloseHandoff {
  requestId: string;
  /** The JSON the element carries. */
  payload: string;
  offerId: string;
  state: CloseHandoffState;
  message: string | null;
}

function isCloseState(state: string | null): state is CloseHandoffState {
  return state === "running" || state === "closed" || state === "error";
}

/**
 * Drive one close at a time.
 *
 * `nodeRef` belongs on the element the caller renders; the observer is installed on it per request.
 */
export function useAssistantClose() {
  const [handoff, setHandoff] = useState<CloseHandoff | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const requestId = handoff?.requestId ?? null;

  useEffect(() => {
    const el = nodeRef.current;
    if (!el || !requestId) return;
    const read = () => {
      // An answer states which close it answers, so a leftover attribute on a reused node is never
      // read as this one's outcome.
      if (el.getAttribute(REQUEST_ATTRIBUTE) !== requestId) return;
      const state = el.getAttribute(STATE_ATTRIBUTE);
      if (!isCloseState(state)) return;
      const message = el.getAttribute(MESSAGE_ATTRIBUTE);
      setHandoff((current) =>
        current?.requestId === requestId ? { ...current, state, message } : current
      );
    };
    const observer = new MutationObserver(read);
    observer.observe(el, {
      attributes: true,
      attributeFilter: [STATE_ATTRIBUTE, REQUEST_ATTRIBUTE, MESSAGE_ATTRIBUTE],
    });
    read(); // the extension may have been faster than this effect
    return () => observer.disconnect();
  }, [requestId]);

  // A close nobody answers is an Assistant that does not know this handoff — a build older than #729 —
  // or one that has stopped. A spinner that never ends tells the collector nothing, so it ends here,
  // after the longest a Colnect tab is ever waited for (`colnect-tab.ts`) and then some.
  const running = handoff?.state === "running";
  useEffect(() => {
    if (!requestId || !running) return;
    const timer = setTimeout(() => {
      setHandoff((current) =>
        current?.requestId === requestId && current.state === "running"
          ? {
              ...current,
              state: "error",
              message:
                "The Assistant did not answer. Check that it is up to date, then check the listing on Colnect before trying again.",
            }
          : current
      );
    }, CLOSE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [requestId, running]);

  /** Ask for one close. A fresh request id per press, which is what a retry is. */
  const start = useCallback((task: CloseTask) => {
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `close-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    setHandoff({
      requestId,
      payload: JSON.stringify({ v: 1, requestId, task }),
      offerId: task.offerId,
      state: "running",
      message: null,
    });
  }, []);

  const dismiss = useCallback(() => setHandoff(null), []);

  return { handoff, nodeRef, start, dismiss };
}
