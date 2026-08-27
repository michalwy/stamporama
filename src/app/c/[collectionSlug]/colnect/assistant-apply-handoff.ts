"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The page half of the **Colnect apply handoff** (#689): how "carry this list difference out on
// Colnect" crosses from the report screen into the Assistant, and how the run's progress comes back.
//
// It is the listing and match handoffs again on a fourth element (#407/#423) — the page writes the
// worklist into a hidden node as JSON, the extension answers with `data-*` attributes on that same
// node — and it is the same contract for the same reason: React owns the node, so text in and
// attributes out is the only direction of travel that survives a re-render.
//
// What is different is the far end. Those two prepare something for the collector to finish; this
// one **writes to their Colnect account** (ADR-0042), for as long as an hour and a half, at a
// deliberately slow pace. So the answer is not one report but a stream of them, and a run outlives
// this screen: what has landed is recorded on the server as it lands, and closing the tab loses the
// progress bar rather than the run.
//
// Since #704 an addition also carries the quantity and the grades this side holds, which is why an
// item is more than a Colnect id and a direction.
//
// Mirrored by hand in `extension/src/core/colnect-apply-handoff.ts` — separate builds, no import
// path between them.

/** The element the extension looks for. Part of the contract. */
export const APPLY_ELEMENT_ID = "stamporama-assistant-colnect-apply";

const STATE_ATTRIBUTE = "data-apply-state";
const REQUEST_ATTRIBUTE = "data-apply-request";
const MESSAGE_ATTRIBUTE = "data-apply-message";
const REPORT_ATTRIBUTE = "data-apply-report";

/**
 * Whether the Assistant is installed **and scripting this origin** — the attribute its instance
 * content script stamps on `<html>`. Without it, *Apply on Colnect* would be a button that silently
 * does nothing, and on a browser with no extension the attribute simply never appears.
 */
export const ASSISTANT_PRESENT_ATTRIBUTE = "data-stamporama-assistant";

/**
 * How far a run has got — the extension's own vocabulary, mirrored.
 *
 * `paused` is deliberately not `error`: Colnect asking for a slower pace, or a laptop closing, costs
 * the run nothing. The worklist and the cursor are written down and the run continues from there.
 */
export type ApplyHandoffState = "running" | "applying" | "paused" | "done" | "error";

/** The numbers behind a state, for the progress the screen draws. */
export interface ApplyHandoffReport {
  total: number;
  applied: number;
  /** Colnect answered `410` — the catalogue item changed underneath. Skipped, not retried. */
  changed: number;
  failed: number;
}

export interface ApplyHandoff {
  requestId: string;
  /** The JSON the element carries. */
  payload: string;
  state: ApplyHandoffState;
  message: string | null;
  report: ApplyHandoffReport | null;
}

function isApplyState(state: string | null): state is ApplyHandoffState {
  return (
    state === "running" ||
    state === "applying" ||
    state === "paused" ||
    state === "done" ||
    state === "error"
  );
}

function parseReport(raw: string | null): ApplyHandoffReport | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<ApplyHandoffReport>;
    if (typeof data?.total !== "number") return null;
    return {
      total: data.total,
      applied: data.applied ?? 0,
      changed: data.changed ?? 0,
      failed: data.failed ?? 0,
    };
  } catch {
    return null;
  }
}

/** Whether the Assistant is here. Read once on mount and then watched, because the extension stamps
 *  the attribute as its content script loads, which may be after this screen renders. */
export function useAssistantPresent(): boolean {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    const read = () =>
      setPresent(document.documentElement.hasAttribute(ASSISTANT_PRESENT_ATTRIBUTE));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [ASSISTANT_PRESENT_ATTRIBUTE],
    });
    return () => observer.disconnect();
  }, []);
  return present;
}

/**
 * Drive one Colnect run at a time.
 *
 * One at a time because the extension enforces the same thing and for a better reason than tidiness:
 * two runs would be two paces against one Colnect account, and the rate that was measured safe is a
 * rate for the account rather than for a run.
 *
 * `nodeRef` belongs on the element the caller renders; the observer is installed on it per request.
 */
export function useAssistantApply() {
  const [handoff, setHandoff] = useState<ApplyHandoff | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const requestId = handoff?.requestId ?? null;

  useEffect(() => {
    const el = nodeRef.current;
    if (!el || !requestId) return;
    const read = () => {
      // An answer states which run it answers, so a leftover attribute on a reused node is never
      // read as this one's progress.
      if (el.getAttribute(REQUEST_ATTRIBUTE) !== requestId) return;
      const state = el.getAttribute(STATE_ATTRIBUTE);
      if (!isApplyState(state)) return;
      const message = el.getAttribute(MESSAGE_ATTRIBUTE);
      const report = parseReport(el.getAttribute(REPORT_ATTRIBUTE));
      setHandoff((current) =>
        current?.requestId === requestId ? { ...current, state, message, report } : current
      );
    };
    const observer = new MutationObserver(read);
    observer.observe(el, {
      attributes: true,
      attributeFilter: [STATE_ATTRIBUTE, REQUEST_ATTRIBUTE, MESSAGE_ATTRIBUTE, REPORT_ATTRIBUTE],
    });
    read(); // the extension may have been faster than this effect
    return () => observer.disconnect();
  }, [requestId]);

  /** Hand one worklist over. */
  const start = useCallback(
    (task: {
      collectionId: string;
      lt: number;
      label: string;
      items: {
        colnectId: string;
        direction: "+" | "-";
        kind: string;
        /** What this side holds, a row per grade (#704) — Colnect's own condition ids. */
        rows?: { cond: number; qty: number }[];
        /** A count to state where no grade can be, against whatever grade Colnect's entry carries. */
        ungraded?: number;
      }[];
    }) => {
      const requestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `apply-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      setHandoff({
        requestId,
        payload: JSON.stringify({ v: 1, requestId, task }),
        state: "running",
        message: null,
        report: { total: task.items.length, applied: 0, changed: 0, failed: 0 },
      });
    },
    []
  );

  const dismiss = useCallback(() => setHandoff(null), []);

  return { handoff, nodeRef, start, dismiss };
}
