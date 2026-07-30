"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ListingBlocker } from "@/lib/listing-preconditions";

// The page half of the **listing handoff** (#407, part of #155): how an offer crosses from
// Stamporama into the Assistant, and how the outcome comes back.
//
// It lives beside `activate-offer-dialog.tsx` rather than under `listing/` for the same reason that
// one did (#399/#414): the bulk workspace and an offer's own screen both hand a listing over, and a
// step offered on one surface only is the step that gets silently skipped on the other.
//
// It is the registration contract again (#252), on a second element: the page writes the listing kit
// (#405) into a hidden node as JSON, the extension reads it and answers by setting `data-*`
// attributes on that same node. The page keeps owning the node — React re-renders it — so text in and
// attributes out is the only direction of travel that survives.
//
// Mirrored by hand in `extension/src/core/listing-handoff.ts`, exactly as the registration payload is:
// the two are separate builds with no import path between them.

/** The element the extension looks for. Part of the contract. */
export const LISTING_ELEMENT_ID = "stamporama-assistant-listing";

/**
 * Set on `<html>` by the Assistant's content script, holding its version — the only way this page
 * can know the extension is installed **and** scripting this instance's origin. Its absence is why
 * **List via Assistant** is offered disabled rather than as a button that silently does nothing.
 */
const PRESENT_ATTRIBUTE = "data-stamporama-assistant";

const STATE_ATTRIBUTE = "data-listing-state";
const REQUEST_ATTRIBUTE = "data-listing-request";
const MESSAGE_ATTRIBUTE = "data-listing-message";
const REPORT_ATTRIBUTE = "data-listing-report";

/** One value the Assistant put into the platform's form, named for the collector and not for the DOM. */
export interface AssistantFilledField {
  field: string;
  value: string;
}

/** One value it could not fill, and why. A skip is a report and not a failure: the rest of the form
 *  is still filled, and the collector finishes it in front of the platform's own page. */
export interface AssistantSkippedField {
  field: string;
  reason: string;
}

export interface AssistantReport {
  moduleId: string;
  moduleName: string;
  formUrl: string;
  filled: AssistantFilledField[];
  skipped: AssistantSkippedField[];
  /** The listing's own URL on the platform (#412), once the sale has been submitted — what the offer
   *  goes live carrying. Absent before that: there is no entry yet to have one. */
  listedUrl?: string;
}

/**
 * How far one handoff has got.
 *
 * `loading` is ours — fetching the kit — and everything after it is the extension's. They are one
 * sequence rather than two states because the collector asked one question, and "which side of the
 * wire is it on" is not an answer to it.
 *
 * The last three are #412's, and they arrive **after** the collector has submitted the form the
 * Assistant filled — which may be minutes later, and is the step that finally makes the listing exist:
 *
 *   • `listed` — the sale was posted and the entry's URL was read. Ours again: the offer is being
 *     published with it.
 *   • `activated` — that publication succeeded. The offer is live, carrying the platform's own URL,
 *     with nothing typed by hand.
 *   • `unread` — the sale was posted and the URL could not be read. Nothing failed; the offer is
 *     simply activated here, where a blank URL has always been an accepted answer.
 */
export type AssistantHandoffState =
  | "loading"
  | "running"
  | "filled"
  | "listed"
  | "activated"
  | "unread"
  | "error";

export interface AssistantHandoff {
  offerId: string;
  requestId: string;
  /** The JSON the element carries, or null while the kit is still being fetched. */
  payload: string | null;
  state: AssistantHandoffState;
  message: string | null;
  report: AssistantReport | null;
}

/** The states the **extension** writes onto the node. `loading`, `activated` and the publication's
 *  own error are ours and never arrive from there. */
function isExtensionState(
  state: string | null
): state is "running" | "filled" | "listed" | "unread" | "error" {
  return (
    state === "running" ||
    state === "filled" ||
    state === "listed" ||
    state === "unread" ||
    state === "error"
  );
}

/** The report as it now stands: whatever the latest answer carries, over what the fill already said.
 *  The fill reports the fields, the post-Save answer reports the URL, and the strip shows both. */
function mergeReport(
  current: AssistantReport | null,
  incoming: AssistantReport | null
): AssistantReport | null {
  if (!incoming) return current;
  if (!current) return incoming;
  return {
    ...incoming,
    filled: incoming.filled.length > 0 ? incoming.filled : current.filled,
    skipped: incoming.skipped.length > 0 ? incoming.skipped : current.skipped,
  };
}

/**
 * Whether the Assistant is here, as a subscription rather than a read: the content script runs at
 * `document_idle`, so a render on mount is routinely too early. `useSyncExternalStore` with a null
 * server snapshot is the house rule for anything the server cannot know (#325's pattern) — reading
 * the attribute during render would make the pre-hydration output disagree with the server's.
 */
export function useAssistantPresence(): string | null {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [PRESENT_ATTRIBUTE],
      });
      return () => observer.disconnect();
    },
    () => document.documentElement.getAttribute(PRESENT_ATTRIBUTE),
    () => null
  );
}

/**
 * Drive one handoff at a time: fetch the offer's listing kit, hand it over, and follow the outcome.
 *
 * One at a time because the extension opens a marketplace tab and puts it in front — two in flight
 * would be two forms fighting over the same window, and the collector is working through the batch
 * one listing at a time anyway.
 *
 * `nodeRef` belongs on the element the caller renders; the observer is installed on it per request,
 * so a new handoff is watched on the node it actually wrote.
 */
export function useAssistantHandoff(
  collectionId: string,
  options: {
    /** The offer went live off the back of its own listing (#412) — the caller's cue to refresh what
     *  it shows, exactly as it does after its own Publish. */
    onActivated?: (offerId: string) => void;
  } = {}
) {
  const [handoff, setHandoff] = useState<AssistantHandoff | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const requestId = handoff?.payload ? handoff.requestId : null;
  const onActivated = options.onActivated;

  useEffect(() => {
    const el = nodeRef.current;
    if (!el || !requestId) return;
    const read = () => {
      // An answer states which handoff it answers, so a leftover attribute on a reused node is
      // never read as this request's outcome.
      if (el.getAttribute(REQUEST_ATTRIBUTE) !== requestId) return;
      const state = el.getAttribute(STATE_ATTRIBUTE);
      if (!isExtensionState(state)) return;
      const raw = el.getAttribute(REPORT_ATTRIBUTE);
      let report: AssistantReport | null = null;
      if (raw) {
        try {
          report = JSON.parse(raw) as AssistantReport;
        } catch {
          report = null; // the message still says how it went
        }
      }
      setHandoff((current) => {
        if (!current || current.requestId !== requestId) return current;
        return {
          ...current,
          state,
          message: el.getAttribute(MESSAGE_ATTRIBUTE),
          // What was filled and skipped is reported once, at fill time; the answer that comes back
          // after Save (#412) carries only the listing's URL, so the fill's own detail is kept rather
          // than replaced with the empty lists that answer necessarily has.
          report: mergeReport(current.report, report),
        };
      });
    };
    const observer = new MutationObserver(read);
    observer.observe(el, {
      attributes: true,
      attributeFilter: [STATE_ATTRIBUTE, REQUEST_ATTRIBUTE, MESSAGE_ATTRIBUTE, REPORT_ATTRIBUTE],
    });
    read(); // the extension may have been faster than this effect
    return () => observer.disconnect();
  }, [requestId]);

  /**
   * Go live off the listing the Assistant just captured (#412).
   *
   * This is the same `publishOfferAction` the card's own Publish calls, with the URL filled in for
   * the collector instead of pasted by them — which is the whole point of the capture: it is the field
   * that goes stale first when it is left to be typed. Publishing here rather than in the extension
   * keeps the rule the handoff has had from the start (#407): the extension reports, the instance
   * decides.
   *
   * Guarded by the request id, so the answer being written twice — a re-render of the node, a second
   * navigation on the platform's side — publishes once. When no page is following the answer at all,
   * the extension posts it to the instance instead, and that endpoint is idempotent for this very
   * reason.
   */
  const published = useRef<string | null>(null);
  useEffect(() => {
    if (!handoff || handoff.state !== "listed") return;
    const url = handoff.report?.listedUrl;
    if (!url || published.current === handoff.requestId) return;
    published.current = handoff.requestId;

    const { offerId, requestId } = handoff;
    void (async () => {
      const { publishOfferAction } = await import("@/app/actions/offers");
      const result = await publishOfferAction(offerId, url);
      setHandoff((current) => {
        if (current?.requestId !== requestId) return current;
        return result.status === "success"
          ? {
              ...current,
              state: "activated",
              message: `Posted on ${current.report?.moduleName ?? "the platform"} and activated here, with the listing's URL.`,
            }
          : {
              ...current,
              state: "error",
              // The listing exists; only the record does not. Saying which is which is the whole
              // message, since the collector's next act is on this screen and not on the platform.
              message: `The listing was posted, but this offer could not be activated: ${result.message ?? "unknown error"}`,
            };
      });
      if (result.status === "success") onActivated?.(offerId);
    })();
  }, [handoff, onActivated]);

  const dismiss = useCallback(() => setHandoff(null), []);

  /**
   * Hand `offerId` over. The kit is fetched here rather than written into the page ahead of time:
   * it is a payload per offer, it is only wanted when the collector actually asks, and its refusal
   * (#405's 409) is the one place a precondition that changed since the batch was read shows up.
   */
  const start = useCallback(
    async (offerId: string) => {
      const requestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Date.now());
      setHandoff({
        offerId,
        requestId,
        payload: null,
        state: "loading",
        message: "Preparing the listing…",
        report: null,
      });

      const fail = (message: string) =>
        setHandoff((current) =>
          current?.requestId === requestId ? { ...current, state: "error", message } : current
        );

      let res: Response;
      try {
        res = await fetch(`/api/collections/${collectionId}/offers/${offerId}/listing-kit`);
      } catch {
        fail("Could not load this offer's listing.");
        return;
      }
      if (res.status === 409) {
        // The preconditions are evaluated twice — once for the row, once here — and this is the
        // reading that counts, so what it refuses on is what gets said.
        const body = (await res.json().catch(() => ({}))) as { blockers?: ListingBlocker[] };
        fail(
          body.blockers?.length
            ? `The Assistant cannot post this offer: ${body.blockers.map((b) => b.message).join(" ")}`
            : "The Assistant cannot post this offer yet."
        );
        return;
      }
      if (!res.ok) {
        fail("Could not load this offer's listing.");
        return;
      }

      const task = await res.json();
      setHandoff((current) =>
        current?.requestId === requestId
          ? {
              ...current,
              payload: JSON.stringify({ v: 1, requestId, task }),
              // Handed over, and now the extension's to answer. Said as its own step so a browser
              // where the script never picks the node up does not sit on "Preparing…" for ever.
              state: "running",
              message: "Handed to the Assistant…",
            }
          : current
      );
    },
    [collectionId]
  );

  return { handoff, start, dismiss, nodeRef };
}
