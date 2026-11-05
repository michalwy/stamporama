"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The page half of the **Colnect market handoff** (#2454): how "read what Colnect's market asks for
// this offer's stamps" crosses from the offer's screen into the Assistant, and how the read comes back.
//
// The close handoff's contract again (#729) — the page writes the task into a hidden node as JSON, the
// extension answers with `data-*` attributes on that same node — on a node of its own. One attribute
// more: `data-market-result` carries the read itself, which this screen then records through
// `recordColnectMarketReadAction`. **The extension reads; the instance records** (#407's rule).
//
// Mirrored by hand in `extension/src/core/colnect-market-handoff.ts` — separate builds, no import path
// between them.

/** The element the extension looks for. Part of the contract. */
export const MARKET_ELEMENT_ID = "stamporama-assistant-colnect-market";

const STATE_ATTRIBUTE = "data-market-state";
const REQUEST_ATTRIBUTE = "data-market-request";
const MESSAGE_ATTRIBUTE = "data-market-message";
const RESULT_ATTRIBUTE = "data-market-result";

/** How long a read may go unanswered before the page stops waiting: a Colnect tab may take thirty
 *  seconds to open (`colnect-tab.ts`), and a read is a second a page after that. */
const MARKET_TIMEOUT_MS = 120_000;

/** How far a read has got — the extension's own vocabulary, mirrored. `done` carries the read. */
export type MarketHandoffState = "running" | "done" | "error";

export interface MarketTask {
  offerId: string;
  collectionId: string;
  items: { colnectId: string; label: string }[];
}

export interface MarketHandoff {
  requestId: string;
  /** The JSON the element carries. */
  payload: string;
  state: MarketHandoffState;
  message: string | null;
  /** The read, parsed off `data-market-result`, once the state is `done`. */
  result: unknown;
}

function isMarketState(state: string | null): state is MarketHandoffState {
  return state === "running" || state === "done" || state === "error";
}

/**
 * Drive one read at a time. `nodeRef` belongs on the element the caller renders; the observer is
 * installed on it per request.
 */
export function useAssistantMarket() {
  const [handoff, setHandoff] = useState<MarketHandoff | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const requestId = handoff?.requestId ?? null;

  useEffect(() => {
    const el = nodeRef.current;
    if (!el || !requestId) return;
    const read = () => {
      // An answer states which read it answers, so a leftover attribute on a reused node is never
      // taken for this one's.
      if (el.getAttribute(REQUEST_ATTRIBUTE) !== requestId) return;
      const state = el.getAttribute(STATE_ATTRIBUTE);
      if (!isMarketState(state)) return;
      const message = el.getAttribute(MESSAGE_ATTRIBUTE);
      let result: unknown = null;
      if (state === "done") {
        try {
          result = JSON.parse(el.getAttribute(RESULT_ATTRIBUTE) ?? "null");
        } catch {
          result = null;
        }
      }
      setHandoff((current) =>
        current?.requestId === requestId && current.state === "running"
          ? { ...current, state, message, result }
          : current
      );
    };
    const observer = new MutationObserver(read);
    observer.observe(el, {
      attributes: true,
      attributeFilter: [STATE_ATTRIBUTE, REQUEST_ATTRIBUTE, MESSAGE_ATTRIBUTE, RESULT_ATTRIBUTE],
    });
    read(); // the extension may have been faster than this effect
    return () => observer.disconnect();
  }, [requestId]);

  // A read nobody answers is an Assistant older than #2454, which ignores the node, or one that has
  // stopped. It ends here rather than spinning.
  const running = handoff?.state === "running";
  useEffect(() => {
    if (!requestId || !running) return;
    const timer = setTimeout(() => {
      setHandoff((current) =>
        current?.requestId === requestId && current.state === "running"
          ? {
              ...current,
              state: "error",
              message: "The Assistant did not answer. Check that it is up to date, then try again.",
            }
          : current
      );
    }, MARKET_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [requestId, running]);

  /** Ask for one read. A fresh request id per press, which is what a refresh is. */
  const start = useCallback((task: MarketTask) => {
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `market-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    setHandoff({
      requestId,
      payload: JSON.stringify({ v: 1, requestId, task }),
      state: "running",
      message: null,
      result: null,
    });
  }, []);

  const dismiss = useCallback(() => setHandoff(null), []);

  return { handoff, nodeRef, start, dismiss };
}
