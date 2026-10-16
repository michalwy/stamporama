/**
 * Updating and closing listings **from the offers list** (#1969) — pure, Prisma-free.
 *
 * The offer's screen already knows which way off *Needs action* a live listing goes (#1804): close it
 * when nothing is left to sell, update it otherwise. This module carries that answer onto the list's
 * rows, splits a ticked selection into the offers each action suits, and keeps the queue the list
 * runs them through — **one at a time**, because the Assistant handles one marketplace task at a time
 * (#407): an update opens a Colnect form and waits for the collector's Save, and closes are paced.
 */

import { needsActionRemedy, type NeedsActionRemedy } from "./offer-needs-action-remedy";
import type { OfferState } from "./offer-rules";
import { supportsAssistantClose, supportsAssistantUpdate } from "./platform-modules";

/** What the Assistant can do to one Active listing, as the list row carries it. */
export interface OfferAssistantFacts {
  /** **Update via Assistant** is offered (#462): the module edits live listings and the offer has
   *  its listing's URL to go back to. */
  update: boolean;
  /** The Colnect sale **Close via Assistant** names (#696/#729), or null where it is not offered. */
  closeSaleId: string | null;
  /** Which of the two *Needs action* calls for (#1804) — only where both are offered, exactly as on
   *  the offer's screen; null otherwise and on an offer in step. */
  remedy: NeedsActionRemedy | null;
  /** The sets sold elsewhere an update removes first (#1835). */
  soldElsewhereSetIds: string[];
}

interface AssistantTarget {
  state: OfferState;
  platformModule: string | null;
  url: string | null;
  colnectSaleId: string | null;
}

function canUpdate(o: AssistantTarget): boolean {
  return supportsAssistantUpdate(o.platformModule) && !!o.url?.trim();
}

function closeSaleId(o: AssistantTarget): string | null {
  return supportsAssistantClose(o.platformModule) ? o.colnectSaleId?.trim() || null : null;
}

/** Whether the Assistant can update or close this offer's listing at all — Active only, as both
 *  buttons on the offer's screen are. */
export function assistantActsOn(o: AssistantTarget): boolean {
  return o.state === "active" && (canUpdate(o) || closeSaleId(o) !== null);
}

/** The row's facts, from the offer's per-set answers — the same inputs the offer's screen hands
 *  `needsActionRemedy`, so the row offers the button the screen highlights. */
export function offerAssistantFacts(
  o: AssistantTarget & {
    listingOutOfDate: boolean;
    sets: readonly { id: string; sold: boolean; soldElsewhere: boolean; needsAction: boolean }[];
  }
): OfferAssistantFacts | null {
  if (!assistantActsOn(o)) return null;
  const update = canUpdate(o);
  const saleId = closeSaleId(o);
  return {
    update,
    closeSaleId: saleId,
    remedy:
      update && saleId
        ? needsActionRemedy({
            state: o.state,
            needsAction: o.sets.some((s) => s.needsAction),
            listingOutOfDate: o.listingOutOfDate,
            sets: o.sets,
          })
        : null,
    soldElsewhereSetIds: o.sets.filter((s) => s.soldElsewhere).map((s) => s.id),
  };
}

export type AssistantRunAct = NeedsActionRemedy["action"];

/** Whether `act` is the one this offer's *Needs action* calls for — a close where nothing is left to
 *  sell, an update otherwise. A ticked offer it does not suit is left alone and counted. */
export function suitsAssistantRun(
  offer: { assistant: OfferAssistantFacts | null },
  act: AssistantRunAct
): boolean {
  return offer.assistant?.remedy?.action === act;
}

/** The ticked offers `act` runs on, and how many it leaves alone — said before the run starts. */
export function planAssistantRuns<O extends { assistant: OfferAssistantFacts | null }>(
  offers: readonly O[],
  act: AssistantRunAct
): { run: O[]; skipped: number } {
  const run = offers.filter((o) => suitsAssistantRun(o, act));
  return { run, skipped: offers.length - run.length };
}

// ── The queue ────────────────────────────────────────────────────────────────

export type AssistantRunStatus = "queued" | "running" | "done" | "failed";

export interface AssistantRun {
  offerId: string;
  offerNo: number;
  /** What the offer is called, for the close task's report. */
  label: string;
  act: AssistantRunAct;
  /** A close's Colnect sale (#696). */
  saleId: string | null;
  /** The sets sold elsewhere an update removes first, as confirmed (#1835) — the server removes only
   *  those still sold elsewhere. */
  removeSetIds: string[];
  status: AssistantRunStatus;
  /** What a running one is doing, or why a failed one failed. */
  message: string | null;
}

/** Add runs to the end of the queue. An offer already queued or running is not added twice; one
 *  that finished is asked again, which is what a retry after a failure is. */
export function enqueueRuns(
  runs: readonly AssistantRun[],
  added: readonly Omit<AssistantRun, "status" | "message">[]
): AssistantRun[] {
  const busy = new Set(
    runs.filter((r) => r.status === "queued" || r.status === "running").map((r) => r.offerId)
  );
  const fresh = added.filter((a) => !busy.has(a.offerId));
  const replaced = new Set(fresh.map((a) => a.offerId));
  return [
    ...runs.filter((r) => !replaced.has(r.offerId)),
    ...fresh.map((a) => ({ ...a, status: "queued" as const, message: null })),
  ];
}

/** The run to start now: the first queued one, and none while another is running. */
export function nextRun(runs: readonly AssistantRun[]): AssistantRun | null {
  if (runs.some((r) => r.status === "running")) return null;
  return runs.find((r) => r.status === "queued") ?? null;
}

export function patchRun(
  runs: readonly AssistantRun[],
  offerId: string,
  patch: Partial<Pick<AssistantRun, "status" | "message">>
): AssistantRun[] {
  return runs.map((r) => (r.offerId === offerId ? { ...r, ...patch } : r));
}

/** What one of the two handoff nodes last said (#407/#729), as far as a run needs to know it. */
export interface HandoffView {
  offerId: string;
  state: string;
  message: string | null;
}

/**
 * A running run as it stands, read off the handoff it is following — the close node for a close, the
 * listing node for an update. Derived rather than copied into the queue, so the queue cannot fall out
 * of step with the node: an error there **is** the run failing, and the next run starts on it.
 *
 * A close that Colnect confirmed stays running: the withdrawal here is still to come, and only its
 * result settles the run. An update stays running through the collector's Save; it is settled when
 * the listing has been marked up to date (#542).
 */
export function liveRun(
  run: AssistantRun,
  listing: HandoffView | null,
  close: HandoffView | null
): AssistantRun {
  if (run.status !== "running") return run;
  const node = run.act === "close" ? close : listing;
  if (!node || node.offerId !== run.offerId) return run;
  if (node.state === "error") {
    return {
      ...run,
      status: "failed",
      message:
        node.message ??
        (run.act === "close" ? "Colnect did not close it." : "the Assistant could not update it."),
    };
  }
  if (run.act === "close") {
    return {
      ...run,
      message: node.state === "running" ? "Closing on Colnect…" : (run.message ?? "Withdrawing…"),
    };
  }
  if (node.state === "filled") return { ...run, message: "Waiting for you to save it on Colnect" };
  if (node.state === "updated") return { ...run, message: "Saved — marking it up to date…" };
  return { ...run, message: node.message ?? run.message };
}

/** Cancel the queue: the runs not yet started are dropped, so those offers stay as they were. The
 *  one running finishes — a close half done is a listing down on Colnect and still Active here. */
export function cancelQueued(runs: readonly AssistantRun[]): AssistantRun[] {
  return runs.filter((r) => r.status !== "queued");
}

/** Whether anything is queued or running. */
export function queueBusy(runs: readonly AssistantRun[]): boolean {
  return runs.some((r) => r.status === "queued" || r.status === "running");
}

/** The row's progress, in the issue's words: *queued · closing · closed · failed: reason*. */
export function assistantRunLabel(run: AssistantRun): string {
  switch (run.status) {
    case "queued":
      return "Queued";
    case "running":
      return run.message ?? (run.act === "close" ? "Closing…" : "Updating…");
    case "done":
      return run.act === "close" ? "Closed" : "Updated";
    case "failed":
      return `Failed: ${run.message ?? "unknown error"}`;
  }
}

/** The finished run's one-line summary: *2 closed · 1 updated · 1 failed*. */
export function assistantRunSummary(runs: readonly AssistantRun[]): string {
  const closed = runs.filter((r) => r.status === "done" && r.act === "close").length;
  const updated = runs.filter((r) => r.status === "done" && r.act === "update").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  return [
    ...(closed > 0 ? [`${closed} closed`] : []),
    ...(updated > 0 ? [`${updated} updated`] : []),
    ...(failed > 0 ? [`${failed} failed`] : []),
  ].join(" · ");
}
