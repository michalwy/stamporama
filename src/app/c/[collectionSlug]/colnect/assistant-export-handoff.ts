"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The page half of the **Colnect export handoff** (#690): how "fetch this list from Colnect and load
// it" crosses from the report screen into the Assistant, and how the outcome comes back.
//
// It is the apply handoff again on a fifth element (#689) — the page writes the task into a hidden
// node as JSON, the extension answers with `data-*` attributes on that same node — and it is a
// separate element for the reason that one was: two answers on one node would overwrite each other,
// and a refresh is routinely asked for while a run is still going.
//
// **The file does not come back through here.** A Wish export is tens of megabytes and this screen
// has no use for the bytes; what it wants refreshed is the *snapshot*. So the extension posts the
// file to this instance itself, over its own bearer token, and it is imported through the exact path
// a hand-picked file takes (#685). What lands on the node is a sentence and three counts.
//
// Mirrored by hand in `extension/src/core/colnect-export-handoff.ts` — separate builds, no import
// path between them.

/** The element the extension looks for. Part of the contract. */
export const EXPORT_ELEMENT_ID = "stamporama-assistant-colnect-export";

const STATE_ATTRIBUTE = "data-export-state";
const REQUEST_ATTRIBUTE = "data-export-request";
const MESSAGE_ATTRIBUTE = "data-export-message";
const REPORT_ATTRIBUTE = "data-export-report";

/**
 * How far a refresh has got — the extension's own vocabulary, mirrored.
 *
 * `error` means **nothing was replaced**: the import is one transaction and every failure stops
 * before it, so the report goes on comparing against the export it already had.
 */
export type ExportHandoffState = "running" | "importing" | "done" | "error";

/** What the import made of the file — the instance's own counts, passed back through the extension
 *  so both routes into a snapshot report the same numbers. */
export interface ExportHandoffReport {
  rowsWritten: number;
  rowsOnList: number;
  rowsWithoutId: number;
}

export interface ExportHandoff {
  requestId: string;
  /** The JSON the element carries. */
  payload: string;
  /** Which list this refresh is of, so the strip can name it before the extension answers. */
  label: string;
  state: ExportHandoffState;
  message: string | null;
  report: ExportHandoffReport | null;
}

function isExportState(state: string | null): state is ExportHandoffState {
  return state === "running" || state === "importing" || state === "done" || state === "error";
}

function parseReport(raw: string | null): ExportHandoffReport | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<ExportHandoffReport>;
    if (typeof data?.rowsWritten !== "number") return null;
    return {
      rowsWritten: data.rowsWritten,
      rowsOnList: data.rowsOnList ?? 0,
      rowsWithoutId: data.rowsWithoutId ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Drive one refresh at a time.
 *
 * One at a time because the extension enforces the same thing: two refreshes would be two builds of
 * the same account's lists on Colnect's server, and the second would only be waiting on the first.
 *
 * `nodeRef` belongs on the element the caller renders; the observer is installed on it per request.
 */
export function useAssistantExport() {
  const [handoff, setHandoff] = useState<ExportHandoff | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const requestId = handoff?.requestId ?? null;

  useEffect(() => {
    const el = nodeRef.current;
    if (!el || !requestId) return;
    const read = () => {
      // An answer states which refresh it answers, so a leftover attribute on a reused node is never
      // read as this one's outcome.
      if (el.getAttribute(REQUEST_ATTRIBUTE) !== requestId) return;
      const state = el.getAttribute(STATE_ATTRIBUTE);
      if (!isExportState(state)) return;
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

  /** Ask for one list. */
  const start = useCallback((task: { collectionId: string; lt: number; label: string }) => {
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `export-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    setHandoff({
      requestId,
      payload: JSON.stringify({ v: 1, requestId, task }),
      label: task.label,
      state: "running",
      message: null,
      report: null,
    });
  }, []);

  const dismiss = useCallback(() => setHandoff(null), []);

  return { handoff, nodeRef, start, dismiss };
}
