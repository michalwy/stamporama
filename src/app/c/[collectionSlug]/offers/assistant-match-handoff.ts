"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The page half of the **match handoff**: how "find this stamp on the marketplace and let me match
// it" crosses from an offer's screen into the Assistant, and how the answer comes back.
//
// It is the listing handoff (#407) again on a third element, for the step *before* a listing: posting
// on Colnect needs every stamp to carry an item-ID, and recording a missing one meant leaving the
// offer, searching by hand, pressing the toolbar icon, matching, and reloading this screen. The
// search is one this instance already knows how to build (#423); what it cannot do is open a window
// the extension owns, which is exactly and only what it hands over.
//
// Two nodes rather than a second task type on the listing one: an offer being prepared is matched
// *and* listed, and an answer to one must not overwrite the answer to the other.
//
// Mirrored by hand in `extension/src/core/match-handoff.ts` — separate builds, no import path.

/** The element the extension looks for. Part of the contract. */
export const MATCH_ELEMENT_ID = "stamporama-assistant-match";

const STATE_ATTRIBUTE = "data-match-state";
const REQUEST_ATTRIBUTE = "data-match-request";
const MESSAGE_ATTRIBUTE = "data-match-message";

/**
 * Changed on `<html>` by the extension every time a match is written to this instance — from this
 * screen's own handoff or from the collector matching a Colnect page with the toolbar icon. A
 * doorbell rather than a message: the value only differs from the last one, and what a page does
 * with it is re-read its own data.
 */
const MATCHED_ATTRIBUTE = "data-stamporama-assistant-matched";

/**
 * How far one handoff has got. It stops at `opened`: what happens in the match window is the
 * collector's own work, and it comes back on the doorbell — a match may well be written for a stamp
 * this handoff never named.
 */
export type MatchHandoffState = "running" | "opened" | "error";

export interface MatchHandoff {
  requestId: string;
  /** What the collector pressed Link on, for the strip's own message. */
  label: string | null;
  /** The JSON the element carries. */
  payload: string;
  state: MatchHandoffState;
  message: string | null;
}

function isMatchState(state: string | null): state is MatchHandoffState {
  return state === "running" || state === "opened" || state === "error";
}

/**
 * Ring the caller whenever the Assistant reports a match written to this instance.
 *
 * Deliberately not tied to a request: a match confirmed in that window may be for any stamp the page
 * it was opened on holds, and re-reading an offer is cheap. It fires for matching started from the
 * toolbar icon too — the case a handoff-scoped signal could never cover, and the one the collector
 * hits when they wander off to a Colnect page of their own.
 */
export function useAssistantMatchSignal(onMatched: () => void): void {
  // The callback is read through a ref so the observer is installed once: it is a subscription to
  // something outside React, and re-subscribing on every render of the caller would be noise.
  const latest = useRef(onMatched);
  useEffect(() => {
    latest.current = onMatched;
  }, [onMatched]);

  useEffect(() => {
    // Only a *change* is a ring. The attribute may already be on the page from a match made an hour
    // ago, and the value itself says nothing — it exists to differ from the last one.
    const observer = new MutationObserver(() => latest.current());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [MATCHED_ATTRIBUTE],
    });
    return () => observer.disconnect();
  }, []);
}

/**
 * Drive one match handoff at a time.
 *
 * One at a time for the reason the listing handoff is: the extension opens a tab and puts its own
 * window in front of it, and two in flight would be two searches fighting over one window. It is
 * also what **Link all** needs — the walk is the page handing over the next missing stamp when the
 * previous one lands, and a queue only makes sense against a single window.
 *
 * `nodeRef` belongs on the element the caller renders; the observer is installed on it per request.
 */
export function useAssistantMatch() {
  const [handoff, setHandoff] = useState<MatchHandoff | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const requestId = handoff?.requestId ?? null;

  useEffect(() => {
    const el = nodeRef.current;
    if (!el || !requestId) return;
    const read = () => {
      // An answer states which handoff it answers, so a leftover attribute on a reused node is never
      // read as this request's outcome.
      if (el.getAttribute(REQUEST_ATTRIBUTE) !== requestId) return;
      const state = el.getAttribute(STATE_ATTRIBUTE);
      if (!isMatchState(state)) return;
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

  /** Hand one search over. `label` is only ever printed back at the collector. */
  const start = useCallback((url: string, label: string | null) => {
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `match-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    setHandoff({
      requestId,
      label,
      payload: JSON.stringify({ v: 1, requestId, task: { url, ...(label ? { label } : {}) } }),
      state: "running",
      message: null,
    });
  }, []);

  const dismiss = useCallback(() => setHandoff(null), []);

  return { handoff, nodeRef, start, dismiss };
}
