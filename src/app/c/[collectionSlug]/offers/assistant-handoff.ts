"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ListingBlocker } from "@/lib/listing-preconditions";
import { evaluatePhotoReadiness } from "@/lib/offer-photo-readiness";
import type { OfferPhotoPlanView } from "./use-offers-query";

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
 * `generating` and `loading` are ours — rendering the listing photos (#727), then fetching the kit —
 * and everything after them is the extension's. They are one sequence rather than two states because
 * the collector asked one question, and "which side of the wire is it on" is not an answer to it.
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
 *   • `updated` — an edit of a live listing was saved (#462). The end of that road: the offer was
 *     Active before the run and is Active after it, so there is nothing here to publish.
 */
export type AssistantHandoffState =
  | "generating"
  | "loading"
  | "running"
  | "filled"
  | "listed"
  | "activated"
  | "unread"
  | "updated"
  | "error";

/** Which act a handoff is (#462), mirroring the kit's own `mode`. */
export type AssistantHandoffMode = "create" | "update";

/** One copy of the handed-over listing that stands under a **variant** rather than under the stamp
 *  the collector picked (#616) — an unknown-variant umbrella listed under its cheapest variant. Read
 *  off the kit as it is handed over, not out of the extension's answer: it is the instance's own
 *  derivation and the form is filled identically either way, so there is nothing for the extension to
 *  report about it. */
export interface AssistantListedVariant {
  /** The copy, by the number it is named by. */
  label: string;
  /** The variant the listing went under, with its vendor prefix. */
  variant: string;
}

export interface AssistantHandoff {
  offerId: string;
  requestId: string;
  /** What was handed over — posting a listing, or correcting the one already live. */
  mode: AssistantHandoffMode;
  /** The JSON the element carries, or null while the kit is still being fetched. */
  payload: string | null;
  state: AssistantHandoffState;
  message: string | null;
  report: AssistantReport | null;
  /** What the kit resolved to a variant (#616), deduplicated, in listing order. Empty for almost
   *  every listing. */
  variants: AssistantListedVariant[];
  /** What this run's own **photo generation** (#727) could not draw, one line each. Reported and not
   *  refused, exactly as the extension's field skips are: a set with no reverse scan still lists,
   *  with one collage fewer, and the collector is the one who decides whether to go and scan it.
   *  Empty on every handoff that found the photos already current, which is almost all of them. */
  notes: string[];
}

/** The states the **extension** writes onto the node. `loading`, `activated` and the publication's
 *  own error are ours and never arrive from there. */
function isExtensionState(
  state: string | null
): state is "running" | "filled" | "listed" | "unread" | "updated" | "error" {
  return (
    state === "running" ||
    state === "filled" ||
    state === "listed" ||
    state === "unread" ||
    state === "updated" ||
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

// ── The photo step (#727) ────────────────────────────────────────────────────
//
// An offer whose listing photos do not exist yet is not a reason to withhold the handoff: generating
// them is a button press on another card and then a wait, which is exactly the sort of errand a
// posting session should not be interrupted by. So the handoff **does it**, in front of the kit
// fetch, and the collector's one click still means one thing — put this offer on the marketplace.
//
// What "not ready" means is deliberately not re-decided here: `evaluatePhotoReadiness` is the same
// pure rule the ready gate is refused by (#311/#418), asked over the plan the Photos card reads. That
// is what makes the sequence safe for a **Preparing** offer (#554), whose `preparing → ready` the
// server refuses on those very blockers — by the time the transition is asked for, the thing it would
// have refused is gone.
//
// So a plan that is merely **out of date** is re-rendered too, and not only a missing one. The kit
// itself still treats `outOfDate` as a signal and never as a refusal (#405) — stored images are
// truthful pictures of these stamps, and an offer already live must not become unlistable because it
// gained a set — but that is about what may be *served*, not about what a collector who has just
// asked for this listing to be posted should get: the run is going to attach pictures of the offer as
// it was, of a composition it no longer has. One rule for both also keeps the button honest, since it
// is the ready gate's photo half that stops disabling it.

/** The Photos card's own polling cadence, and a cap on how long the strip will sit on a run. Past it
 *  the handoff stops rather than waits: the run carries on in the worker, the card follows it, and a
 *  strip spinning for ever is the one outcome that tells the collector nothing. */
const PHOTO_POLL_MS = 2000;
const PHOTO_POLL_ATTEMPTS = 90;

async function fetchPhotoPlan(
  collectionId: string,
  offerId: string
): Promise<OfferPhotoPlanView | null> {
  try {
    const res = await fetch(`/api/collections/${collectionId}/offers/${offerId}/photos`);
    if (!res.ok) return null;
    return (await res.json()) as OfferPhotoPlanView;
  } catch {
    return null;
  }
}

/** The ready gate's photo half, asked over the panel's plan. `plan.imageCount` and not the state's
 *  own `plannedCount`, which is what the **last run** planned: the question is what a Generate right
 *  now would produce, which is the plan as it currently stands. */
function photoBlockers(plan: OfferPhotoPlanView) {
  return evaluatePhotoReadiness({
    status: plan.status,
    outOfDate: plan.outOfDate,
    storedCount: plan.images.length,
    plannedCount: plan.plan.imageCount,
  });
}

/** The images this offer would actually hand to the platform — the kit's own filter (`publish` and
 *  within the photo limit), so "did the run produce anything to upload" is answered on the set that
 *  is uploaded. */
function uploadableCount(plan: OfferPhotoPlanView): number {
  return plan.images.filter((image) => image.publish && !image.overLimit).length;
}

/** Wait for a queued or running job to settle, or null once the cap is reached. */
async function awaitPhotoRun(
  collectionId: string,
  offerId: string
): Promise<OfferPhotoPlanView | null> {
  for (let attempt = 0; attempt < PHOTO_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, PHOTO_POLL_MS));
    const plan = await fetchPhotoPlan(collectionId, offerId);
    if (!plan) continue; // a lost poll is not a lost run; the next one asks again
    if (plan.status !== "queued" && plan.status !== "running") return plan;
  }
  return null;
}

/**
 * What the run could not draw (#314), one line per group — the Photos card's own sentences, without
 * the copy labels, which is where they are named and acted on.
 *
 * A **report and not a refusal**, on the rule the whole handoff follows (#408): a set of eight whose
 * back collage is missing over one unscanned reverse still lists, with one picture fewer, and going
 * to scan it is the collector's decision to make in front of the form.
 */
function photoNotes(plan: OfferPhotoPlanView): string[] {
  return plan.plan.skipped.map((group) => {
    const sets = group.setLabels.join(", ") || "this group";
    const copies = `${group.copyCount} ${group.copyCount === 1 ? "copy" : "copies"}`;
    if (group.side === "paired") {
      return group.missingCopyLabels.length === group.copyCount
        ? `No image for ${sets} — none of its ${copies} has a scan.`
        : `${group.missingCopyLabels.length} of ${copies} are missing from the paired image for ${sets} — no scan on either side.`;
    }
    return `No ${group.side} image for ${sets} — ${group.missingCopyLabels.length} of ${copies} have no ${group.side} scan.`;
  });
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
    /** A live listing was updated in place (#462) and its "changed since listed" flag cleared
     *  (#542) — the same cue, for the run that changes the record without changing its state. */
    onUpdated?: (offerId: string) => void;
    /** The handoff generated this offer's listing photos on its way to the form (#727) — the same
     *  cue again, for the surface drawing the Photos card that has just changed under it. */
    onPhotosGenerated?: (offerId: string) => void;
  } = {}
) {
  const [handoff, setHandoff] = useState<AssistantHandoff | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const requestId = handoff?.payload ? handoff.requestId : null;
  const onActivated = options.onActivated;
  const onUpdated = options.onUpdated;
  const onPhotosGenerated = options.onPhotosGenerated;

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
  /**
   * The other half of the same rule (#542): a saved **update** is the live listing and this record
   * agreeing again, so it clears the "changed since listed" flag.
   *
   * #462 said an update writes nothing, and that was right while there was nothing to write — the
   * offer was Active before the run and is Active after it. What there is to write now is the one
   * fact the run establishes: the entry on the platform has just been reloaded from this offer. It
   * goes through the instance and not the extension, on the rule the handoff has had from the start
   * (#407) — the extension reports, the instance decides.
   *
   * Guarded by the request id like the publish below, so an answer written twice clears once; the
   * action is idempotent anyway, and an offer carrying no flag is left alone rather than refused.
   *
   * Where no page is following the answer at all, nothing clears the flag and the offer keeps it.
   * That is the safe way round: a flag that outlives its fix costs one click on **Mark listing up to
   * date**, where one cleared by a run that never happened costs a listing nobody goes back to.
   */
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!handoff || handoff.state !== "updated") return;
    if (synced.current === handoff.requestId) return;
    synced.current = handoff.requestId;
    const { offerId } = handoff;
    void (async () => {
      const { markOfferListingSyncedAction } = await import("@/app/actions/offers");
      await markOfferListingSyncedAction(offerId);
      onUpdated?.(offerId);
    })();
  }, [handoff, onUpdated]);

  const published = useRef<string | null>(null);
  useEffect(() => {
    // `listed` is the only state that publishes, and an update never reaches it (#462): its answer is
    // `updated`, which is the end of the road — the offer went Active when it was first listed.
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
   *
   * `mode` picks which act is asked for (#462) and is the *only* difference between the two: the
   * endpoint answers the same shape either way, and the extension takes it from there. An update's
   * own refusals — not Active, no listing URL, a module that cannot edit — arrive as that same 409.
   *
   * Two steps run in front of the fetch, in this order and for the same reason — the collector asked
   * one question and every part of the answer is this run's own work:
   *
   *   1. the **photos** (#727), where the plan is not current. See the block above.
   *   2. `prepare`, the caller's own step on the way to the form — the offer's screen marking a
   *      **Preparing** offer ready (#554). It goes *after* the photos because that transition is
   *      refused on exactly the blockers step 1 clears, and it returns its refusal as a message
   *      rather than throwing, so a state the server would not take stops the run in its own words
   *      instead of leaving the Assistant to refuse it a second time in different ones.
   */
  const start = useCallback(
    async (
      offerId: string,
      mode: AssistantHandoffMode = "create",
      prepare?: () => Promise<string | null>
    ) => {
      const requestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Date.now());
      setHandoff({
        offerId,
        requestId,
        mode,
        payload: null,
        state: "loading",
        message: mode === "update" ? "Preparing the update…" : "Preparing the listing…",
        report: null,
        variants: [],
        notes: [],
      });

      const fail = (message: string) =>
        setHandoff((current) =>
          current?.requestId === requestId ? { ...current, state: "error", message } : current
        );

      // ── 1. The photos ──────────────────────────────────────────────────────
      const asFound = await fetchPhotoPlan(collectionId, offerId);
      if (!asFound) {
        fail("Could not check this offer's listing photos.");
        return;
      }
      let plan = asFound;
      let notes: string[] = [];
      if (photoBlockers(plan).length > 0) {
        const alreadyRunning = plan.status === "queued" || plan.status === "running";
        setHandoff((current) =>
          current?.requestId === requestId
            ? {
                ...current,
                state: "generating",
                message: alreadyRunning
                  ? "Waiting for this offer's listing photos…"
                  : "Generating this offer's listing photos…",
              }
            : current
        );
        // A run already in flight is waited on rather than stacked — enqueueing again is a no-op
        // anyway, and asking for one is how a strip ends up reporting a run it did not start.
        if (!alreadyRunning) {
          const { generateOfferPhotosAction } = await import("@/app/actions/offers");
          const queued = await generateOfferPhotosAction(offerId);
          if (queued.status === "error") {
            fail(`The listing photos could not be generated: ${queued.message}`);
            return;
          }
        }
        const settled = await awaitPhotoRun(collectionId, offerId);
        if (!settled) {
          fail(
            "The listing photos are still being generated. The Photos card follows the run — try again once it has finished."
          );
          return;
        }
        plan = settled;
        onPhotosGenerated?.(offerId);
        if (plan.status === "failed") {
          fail(`The listing photos could not be generated: ${plan.error ?? "the run failed."}`);
          return;
        }
        // A run that drew nothing to upload stops the handoff (#727): the form would be filled and
        // the pictures — the thing a buyer decides on — would simply be absent, which is not a
        // listing anybody meant to post. What was skipped is what says why.
        if (uploadableCount(plan) === 0) {
          const why = photoNotes(plan);
          fail(
            `The photo run produced no pictures to upload.${why.length > 0 ? ` ${why.join(" ")}` : ""} Fix it on the Photos card and try again.`
          );
          return;
        }
        // The same question the step opened with, asked of what the run left behind. It should be
        // empty by now; if it is not, the reason is stated rather than handed over anyway.
        const left = photoBlockers(plan);
        if (left.length > 0) {
          fail(`The listing photos are still not ready. ${left.map((b) => b.message).join(" ")}`);
          return;
        }
        notes = photoNotes(plan);
        setHandoff((current) =>
          current?.requestId === requestId
            ? {
                ...current,
                state: "loading",
                notes,
                message: mode === "update" ? "Preparing the update…" : "Preparing the listing…",
              }
            : current
        );
      }

      // ── 2. The caller's own step ───────────────────────────────────────────
      if (prepare) {
        const refusal = await prepare();
        if (refusal) {
          fail(refusal);
          return;
        }
      }

      let res: Response;
      try {
        res = await fetch(
          `/api/collections/${collectionId}/offers/${offerId}/listing-kit${
            mode === "update" ? "?mode=update" : ""
          }`
        );
      } catch {
        fail("Could not load this offer's listing.");
        return;
      }
      if (res.status === 409) {
        // The preconditions are evaluated twice — once for the row, once here — and this is the
        // reading that counts, so what it refuses on is what gets said.
        const body = (await res.json().catch(() => ({}))) as { blockers?: ListingBlocker[] };
        const act = mode === "update" ? "update this listing" : "post this offer";
        fail(
          body.blockers?.length
            ? `The Assistant cannot ${act}: ${body.blockers.map((b) => b.message).join(" ")}`
            : `The Assistant cannot ${act} yet.`
        );
        return;
      }
      if (!res.ok) {
        fail("Could not load this offer's listing.");
        return;
      }

      const task = (await res.json()) as {
        items?: { label: string; catalogItemSource?: { label: string } | null }[];
      };
      // What this listing stands under, where that is not the stamp itself (#616). Taken here, from
      // the payload actually handed over, so the report names the entries the form was filled with.
      const variants: AssistantListedVariant[] = [];
      for (const item of task.items ?? []) {
        const variant = item.catalogItemSource?.label;
        if (!variant || variants.some((v) => v.label === item.label && v.variant === variant)) {
          continue;
        }
        variants.push({ label: item.label, variant });
      }
      setHandoff((current) =>
        current?.requestId === requestId
          ? {
              ...current,
              variants,
              notes,
              payload: JSON.stringify({ v: 1, requestId, task }),
              // Handed over, and now the extension's to answer. Said as its own step so a browser
              // where the script never picks the node up does not sit on "Preparing…" for ever.
              state: "running",
              message: "Handed to the Assistant…",
            }
          : current
      );
    },
    [collectionId, onPhotosGenerated]
  );

  return { handoff, start, dismiss, nodeRef };
}
