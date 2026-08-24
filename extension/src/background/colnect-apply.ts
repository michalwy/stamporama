import {
  describeApplyProgress,
  type ApplyHandoffState,
  type ApplyItem,
  type ApplyTask,
} from "../core/colnect-apply-handoff";
import type {
  ColnectApplyProgressNotice,
  ColnectApplyResponse,
  ColnectWriteRequest,
  ColnectWriteResponse,
} from "../core/messages";
import {
  COLNECT_WRITE_INTERVAL_MS,
  classifyColnectListWrite,
  colnectWriteBackoffMs,
} from "../platform/colnect/list-write";
import { getActiveProfile, normalizeBaseUrl } from "../core/profile";
import {
  readApplyRun,
  runAdvanced,
  runIsLive,
  runReport,
  runThrottled,
  writeApplyRun,
  type ApplyRun,
} from "./colnect-apply-run";

// **Applying a list difference on Colnect** (#689) — the run itself.
//
// The first thing this extension has ever done that *changes* a Colnect account. ADR-0042 records
// the decision, what is written and on whose authority; `platform/colnect/list-write.ts` holds the
// request's shape and the whole decision table for a response, pure and unit-tested. What lives
// here is the part that needs a browser: finding a Colnect page to write from, the pace, the place
// in the worklist, and telling both the collector's screen and the instance what has landed.
//
// **The write happens in the page, not here.** Colnect authenticates the checkbox call by session
// cookie alone — no CSRF token — so the request must be same-origin from a document the collector is
// signed in on. The worker owns the pace, the worklist and the reporting; the content script owns
// exactly one `fetch`. That split is also the honest one: a service worker quietly posting to
// somebody else's site with their cookies is a much wider capability than a page doing what its own
// checkbox does.
//
// **One item at a time, at a measured pace.** ~4 req/s trips 429 on this site; ~0.6 req/s ran 3,070
// operations clean. A first Swap pass is therefore about an hour and a half — which is why the run
// is written down after **every** item, and why an interrupted one continues rather than restarts.
//
// **What lands is marked done on the report as it lands**, in small batches, so the two screens
// never disagree about what was carried out. A crash mid-run leaves the report describing exactly
// what got through.

/** How many done marks are posted to the instance at once. Small, because the point of the mark is
 *  that the report never overstates what is still to do; a batch is only here so a run paced at one
 *  write every other second does not open a second connection beside each of them. */
const MARK_BATCH = 10;

/** Where the run writes from. Any Colnect page will do — the call is same-origin and says which
 *  item it is about — so an already-open tab is reused before one is opened. */
const COLNECT_HOME = "https://colnect.com/en";

/** The one run in flight, if this worker is the one running it. `null` between items only when
 *  nothing is running: two runs would be two paces on one account, and the measured safe rate is a
 *  rate for the account. */
let active: string | null = null;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Start (or resume) a run. Answers as soon as it is under way — an hour-and-a-half job cannot be
 * something a page waits on.
 */
export async function runColnectApply(
  task: ApplyTask,
  requestId: string,
  sender: chrome.tabs.Tab | undefined
): Promise<ColnectApplyResponse> {
  if (active) {
    return {
      ok: false,
      error: "A Colnect run is already going. Let it finish, or reload the extension to stop it.",
    };
  }
  if (task.items.length === 0) return { ok: false, error: "Nothing to apply." };

  const run: ApplyRun = {
    requestId,
    collectionId: task.collectionId,
    instanceOrigin: originOf(sender?.url),
    instanceTabId: sender?.id ?? null,
    lt: task.lt,
    label: task.label,
    items: task.items,
    cursor: 0,
    applied: 0,
    changed: 0,
    failed: 0,
    consecutive429s: 0,
    startedAt: Date.now(),
  };
  await writeApplyRun(run);
  // Not awaited: the answer is "it is under way", and the work outlives the message channel.
  void drive(run);
  return { ok: true };
}

/** Continue whatever run this worker was in the middle of when it was unloaded. Called on startup —
 *  a paused run is one the collector expects to be able to pick up, not one they have to rebuild. */
export async function resumeColnectApply(): Promise<void> {
  if (active) return;
  const run = await readApplyRun();
  if (!runIsLive(run, Date.now())) return;
  void drive(run);
}

/**
 * Work the list.
 *
 * Every item settles the same way: write, classify, move the cursor, write the run down. The one
 * outcome that does **not** move the cursor is a `429` — the item was refused rather than tried, so
 * it is the next one again after the back-off.
 */
async function drive(start: ApplyRun): Promise<void> {
  active = start.requestId;
  let run = start;
  try {
    const tabId = await colnectTab();
    if (tabId === null) {
      await report(run, "error", "No Colnect page could be opened to apply the changes from.");
      return;
    }

    await report(run, "applying");
    const pendingMarks: { colnectId: string; kind: string }[] = [];

    while (run.cursor < run.items.length) {
      const item = run.items[run.cursor];
      const outcome = await writeOne(tabId, item, run.lt);

      if (outcome.status === "throttled") {
        run = runThrottled(run);
        await writeApplyRun(run);
        const wait = colnectWriteBackoffMs(run.consecutive429s, outcome.retryAfterMs);
        if (wait === null) {
          // Colnect has said no at the longest back-off. Stopping is the honest answer; the run is
          // written down and the collector starts it again when the site is happier.
          await flushMarks(run, pendingMarks, true);
          await report(run, "paused");
          return;
        }
        await report(run, "paused");
        await sleep(wait);
        await report(run, "applying");
        continue;
      }

      if (outcome.status === "unauthorized") {
        await flushMarks(run, pendingMarks, true);
        await report(
          run,
          "error",
          "Colnect answered as if nobody is signed in. Sign in on Colnect in this browser and start the run again."
        );
        return;
      }
      if (outcome.status === "stopped") {
        await flushMarks(run, pendingMarks, true);
        await report(run, "error", `${outcome.reason} The run stopped rather than guessing.`);
        return;
      }

      run = runAdvanced(run, outcome.status === "applied" ? "applied" : "changed");
      await writeApplyRun(run);
      // Only what actually landed is claimed done. A `changed` item is one Colnect no longer holds
      // in the shape the export described, and claiming that fixed would be a lie the next import
      // would have to catch.
      if (outcome.status === "applied") pendingMarks.push({ colnectId: item.colnectId, kind: item.kind });
      await flushMarks(run, pendingMarks, false);
      await report(run, "applying");

      if (run.cursor < run.items.length) await sleep(COLNECT_WRITE_INTERVAL_MS);
    }

    await flushMarks(run, pendingMarks, true);
    await report(run, "done");
    await writeApplyRun(null);
  } catch (e) {
    await report(run, "error", `The run stopped: ${message(e)}`);
  } finally {
    active = null;
  }
}

/** One write, performed by the page. A failure to *reach* the page is a stop rather than a retry:
 *  the tab is gone, and hammering a dead message channel helps nobody. */
async function writeOne(tabId: number, item: ApplyItem, lt: number) {
  let res: ColnectWriteResponse;
  try {
    res = (await chrome.tabs.sendMessage(tabId, {
      type: "colnect-write",
      colnectId: item.colnectId,
      lt,
      direction: item.direction,
    } satisfies ColnectWriteRequest)) as ColnectWriteResponse;
  } catch (e) {
    return { status: "stopped" as const, reason: `Lost the Colnect page: ${message(e)}.` };
  }
  if (!res?.ok) {
    return { status: "stopped" as const, reason: res?.error ?? "The Colnect page answered nothing." };
  }
  return classifyColnectListWrite(res.status, {
    get: (name) => (name.toLowerCase() === "retry-after" ? res.retryAfter : null),
  });
}

/** A Colnect tab to write from: one already open by preference, a new one otherwise. Reusing is not
 *  only tidier — a page the collector already has loaded is one they are already signed in on. */
async function colnectTab(): Promise<number | null> {
  try {
    const open = await chrome.tabs.query({ url: "*://*.colnect.com/*" });
    const existing = open.find((tab) => tab.id !== undefined);
    if (existing?.id !== undefined) return existing.id;
    const created = await chrome.tabs.create({ url: COLNECT_HOME, active: false });
    if (created.id === undefined) return null;
    await waitForLoad(created.id);
    return created.id;
  } catch {
    return null;
  }
}

/** Post what has landed to the instance, in batches (see {@link MARK_BATCH}). `force` empties the
 *  queue whatever its size — the end of a run, or the moment before it stops. */
async function flushMarks(
  run: ApplyRun,
  queue: { colnectId: string; kind: string }[],
  force: boolean
): Promise<void> {
  if (queue.length === 0 || (!force && queue.length < MARK_BATCH)) return;
  const marks = queue.splice(0, queue.length);
  const profile = await getActiveProfile();
  if (!profile || profile.collectionId !== run.collectionId) return;
  try {
    await fetch(
      `${normalizeBaseUrl(profile.apiBaseUrl)}/api/collections/${run.collectionId}/colnect/report/done`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.token}` },
        body: JSON.stringify({ lt: run.lt, marks }),
      }
    );
  } catch {
    // The instance is unreachable — a laptop that moved networks mid-run. The writes on Colnect are
    // real either way, and the next export is what checks them; losing the claim is not worth losing
    // the run, and it is exactly the case a "done" mark expiring on re-import is designed for.
  }
}

/** Tell the page that asked how it is going. Fire-and-forget in both directions: the tab may be
 *  closed, and a run must never fail because nobody is watching it. */
async function report(
  run: ApplyRun,
  state: ApplyHandoffState,
  overrideMessage?: string
): Promise<void> {
  if (run.instanceTabId === null) return;
  const notice: ColnectApplyProgressNotice = {
    type: "colnect-apply-progress",
    requestId: run.requestId,
    state,
    message: overrideMessage ?? describeApplyProgress(state, runReport(run), run.label),
    report: runReport(run),
  };
  try {
    await chrome.tabs.sendMessage(run.instanceTabId, notice);
  } catch {
    // The report screen is closed. The run carries on; what it does is recorded on the instance.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for a freshly opened tab to finish loading, so the content script is in it. */
function waitForLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === "complete") done();
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Finite: a Colnect page that never settles still has a document, and the first write will say
    // so far more usefully than waiting for ever would.
    const timer = setTimeout(done, 30_000);
    // It may already have settled between `create` and this listener going on.
    void chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === "complete") done();
      },
      () => done()
    );
  });
}

/** The origin of a URL, or null. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
