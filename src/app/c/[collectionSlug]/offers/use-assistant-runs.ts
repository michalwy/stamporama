"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelQueued,
  enqueueRuns,
  liveRun,
  nextRun,
  patchRun,
  queueBusy,
  type AssistantRun,
  type HandoffView,
} from "@/lib/offer-assistant-runs";
import { useAssistantHandoff } from "./assistant-handoff";
import { useAssistantClose } from "./assistant-close-handoff";

// The offers list's queue of **Update via Assistant** and **Close via Assistant** runs (#1969).
//
// Nothing new crosses to the Assistant: each run is the offer screen's own handoff — the close node
// (#729) and the listing node in update mode (#462) — driven here one offer after another, because
// the Assistant handles one marketplace task at a time (#407). A close is followed by the withdrawal
// the offer's screen makes; an update removes the sets sold elsewhere first (#1835) and then waits
// for the collector to save the form on Colnect, which is what moves the queue on.
//
// A running run's progress is **read off its node** (`liveRun`) rather than copied into the queue,
// so an error on the node is the run failing and the next one starting, with nothing to keep in step.
// A failure stops nothing else: it is written on its run, and the next one starts.

/** The gap between two closes. Colnect is asked well under once a second (#1969); a close is one
 *  request, so this is the whole of the pacing. */
const CLOSE_SPACING_MS = 3000;

export function useAssistantRuns(collectionId: string) {
  const [stored, setRuns] = useState<AssistantRun[]>([]);

  const settle = useCallback(
    (offerId: string, status: "done" | "failed", message: string | null = null) =>
      setRuns((prev) => patchRun(prev, offerId, { status, message })),
    []
  );
  const say = useCallback(
    (offerId: string, message: string) =>
      setRuns((prev) =>
        prev.some((r) => r.offerId === offerId && r.status === "running")
          ? patchRun(prev, offerId, { message })
          : prev
      ),
    []
  );

  // An update is done once the handoff has marked the listing up to date (#542) — its `onUpdated`,
  // which is after the write and not merely after Colnect's Save.
  const onUpdated = useCallback((offerId: string) => settle(offerId, "done"), [settle]);
  const {
    handoff,
    start: startHandoff,
    dismiss: dismissHandoff,
    nodeRef: listingNodeRef,
  } = useAssistantHandoff(collectionId, { onUpdated });
  const {
    handoff: closeHandoff,
    start: startClose,
    dismiss: dismissClose,
    nodeRef: closeNodeRef,
  } = useAssistantClose();

  const listingView: HandoffView | null = useMemo(
    () =>
      handoff ? { offerId: handoff.offerId, state: handoff.state, message: handoff.message } : null,
    [handoff]
  );
  const closeView: HandoffView | null = useMemo(
    () =>
      closeHandoff
        ? { offerId: closeHandoff.offerId, state: closeHandoff.state, message: closeHandoff.message }
        : null,
    [closeHandoff]
  );
  /** The stored queue with its running run read off the node it follows. */
  const live = useCallback(
    (runs: readonly AssistantRun[]) => runs.map((r) => liveRun(r, listingView, closeView)),
    [listingView, closeView]
  );
  const runs = useMemo(() => live(stored), [live, stored]);
  const running = runs.find((r) => r.status === "running") ?? null;

  // ── Start the next run ────────────────────────────────────────────────────
  const lastCloseAt = useRef(0);
  // The run last started, so an effect run twice over the same queue (React's development double
  // mount) hands nothing to the Assistant twice. A retry is a new run object, so it is not caught.
  const started = useRef<AssistantRun | null>(null);
  const next = nextRun(runs);
  useEffect(() => {
    if (!next || started.current === next) return;
    started.current = next;
    const run = next;
    void (async () => {
      // A microtask first, so the queue is written from a callback rather than the effect's body.
      // The run that just ended is written down as it ended (read off its node), and this one
      // starts with the nodes empty — whatever is left on them belongs to the last run.
      await Promise.resolve();
      setRuns((prev) =>
        patchRun(live(prev), run.offerId, { status: "running", message: null })
      );
      dismissClose();
      dismissHandoff();
      if (run.act === "close") {
        const wait = lastCloseAt.current + CLOSE_SPACING_MS - Date.now();
        if (wait > 0) {
          say(run.offerId, "Waiting a moment before the next close…");
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        lastCloseAt.current = Date.now();
        startClose({
          offerId: run.offerId,
          collectionId,
          saleId: run.saleId ?? "",
          label: run.label,
        });
        return;
      }
      if (run.removeSetIds.length > 0) {
        const n = run.removeSetIds.length;
        say(run.offerId, `Removing ${n} ${n === 1 ? "set" : "sets"} sold elsewhere…`);
        const { removeOfferSetsSoldElsewhereAction } = await import("@/app/actions/offers");
        const removed = await removeOfferSetsSoldElsewhereAction(run.offerId, run.removeSetIds);
        if (removed.status === "error") {
          settle(run.offerId, "failed", removed.message ?? "the sets could not be removed.");
          return;
        }
      }
      void startHandoff(run.offerId, "update");
    })();
  }, [next, live, collectionId, dismissClose, dismissHandoff, startClose, startHandoff, say, settle]);

  // ── A close Colnect confirmed: withdraw the offer here ────────────────────
  // The transition the offer screen's close ends in. Once per close, so a re-render cannot
  // withdraw twice.
  const withdrawnFor = useRef<string | null>(null);
  useEffect(() => {
    if (!running || running.act !== "close") return;
    if (closeHandoff?.offerId !== running.offerId || closeHandoff.state !== "closed") return;
    if (withdrawnFor.current === closeHandoff.requestId) return;
    withdrawnFor.current = closeHandoff.requestId;
    const offerId = running.offerId;
    void (async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(offerId, "withdrawn");
      if (result.status === "success") settle(offerId, "done");
      else
        settle(
          offerId,
          "failed",
          `closed on Colnect, but this offer could not be withdrawn: ${result.message} — withdraw it from its ⋮.`
        );
    })();
  }, [closeHandoff, running, settle]);

  /** Queue runs at the end. */
  const enqueue = useCallback(
    (added: Parameters<typeof enqueueRuns>[1]) =>
      setRuns((prev) => enqueueRuns(live(prev), added)),
    [live]
  );
  /** Drop the runs not yet started; the running one finishes. */
  const cancel = useCallback(() => setRuns((prev) => cancelQueued(live(prev))), [live]);
  /** Stop waiting for an update's Save, which nothing else ends — the form stays open on Colnect. */
  const stopWaiting = useCallback(() => {
    if (!running || running.act !== "update") return;
    dismissHandoff();
    settle(running.offerId, "failed", "not saved on Colnect — the queue stopped waiting for it.");
  }, [running, dismissHandoff, settle]);
  /** Forget the finished runs — the report the rows carry. */
  const clearFinished = useCallback(
    () =>
      setRuns((prev) =>
        live(prev).filter((r) => r.status === "queued" || r.status === "running")
      ),
    [live]
  );

  return {
    runs,
    running,
    busy: queueBusy(runs),
    /** Whether the running update is waiting on the collector's Save. */
    awaitingSave: running?.act === "update" && handoff?.state === "filled",
    enqueue,
    cancel,
    stopWaiting,
    clearFinished,
    listingNodeRef,
    listingPayload: handoff?.payload ?? null,
    closeNodeRef,
    closePayload: closeHandoff?.payload ?? null,
  };
}
