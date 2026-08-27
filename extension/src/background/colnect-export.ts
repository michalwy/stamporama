import {
  describeExportProgress,
  type ExportHandoffReport,
  type ExportHandoffState,
  type ExportTask,
} from "../core/colnect-export-handoff";
import type {
  ColnectExportFetchRequest,
  ColnectExportFetchResponse,
  ColnectExportProgressNotice,
  ColnectExportResponse,
} from "../core/messages";
import { getActiveProfile, normalizeBaseUrl } from "../core/profile";
import { colnectTab } from "./colnect-tab";

// **Refreshing a list from Colnect without a file** (#690) — the run itself.
//
// The last manual step in the loop was the export: open Colnect, press *Export list*, wait, find the
// file, upload it. Colnect's own button is a scripted request (`platform/colnect/list-export.ts`),
// so it does not have to stay manual.
//
// **The request happens in the page, not here**, for the write's reason exactly (`colnect-apply.ts`):
// it is authenticated by the collector's session cookie and nothing else, so it has to be
// same-origin from a document that session is live on. The worker owns finding that document, the
// hop to the instance, and the reporting; the content script owns the two `fetch` calls.
//
// **The bytes never touch the report screen.** A Wish export is tens of megabytes and the page has
// no use for them — it is the *snapshot* it wants refreshed. So the file goes straight from here to
// the instance, over the same bearer token the apply run's done-marks go on, and is imported through
// the exact path a hand-picked file takes (#685): one importer, one set of rules about what an
// export means.
//
// **A refresh that fails changes nothing.** The instance replaces a snapshot in one transaction or
// not at all, and every failure here stops before that call — so the report goes on comparing
// against the export it already had rather than against nothing.

/** The one refresh in flight. Two at once would be two builds of the same account's lists on
 *  Colnect's server, and the second would be waiting on the first anyway. */
let active: string | null = null;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Start a refresh. Answers as soon as it is under way: Colnect takes its time building a
 * twenty-five-thousand-row file, and a page cannot hold a message channel open for it.
 */
export async function runColnectExport(
  task: ExportTask,
  requestId: string,
  sender: chrome.tabs.Tab | undefined
): Promise<ColnectExportResponse> {
  if (active) {
    return { ok: false, error: "A Colnect refresh is already going. Let it finish." };
  }
  active = requestId;
  // Not awaited: the answer is "it is under way", and the work outlives the message channel.
  void drive(task, requestId, sender?.id ?? null).finally(() => {
    active = null;
  });
  return { ok: true };
}

/** Ask Colnect, then hand what comes back to the instance. Every branch ends in one report. */
async function drive(
  task: ExportTask,
  requestId: string,
  instanceTabId: number | null
): Promise<void> {
  const say = (state: ExportHandoffState, report: ExportHandoffReport | null, override?: string) =>
    tell(instanceTabId, requestId, state, report, override ?? describeExportProgress(state, report, task.label));

  try {
    await say("running", null);

    const tabId = await colnectTab();
    if (tabId === null) {
      await say("error", null, "No Colnect page could be opened to ask for the export.");
      return;
    }

    let fetched: ColnectExportFetchResponse;
    try {
      fetched = (await chrome.tabs.sendMessage(tabId, {
        type: "colnect-export-fetch",
        lt: task.lt,
      } satisfies ColnectExportFetchRequest)) as ColnectExportFetchResponse;
    } catch (e) {
      await say("error", null, `Lost the Colnect page: ${message(e)}.`);
      return;
    }
    if (!fetched?.ok) {
      await say("error", null, fetched?.error ?? "The Colnect page answered nothing.");
      return;
    }

    await say("importing", null);
    const imported = await postToInstance(task, fetched.fileName, fetched.text);
    if (!imported.ok) {
      await say("error", null, imported.error);
      return;
    }
    await say("done", imported.report);
  } catch (e) {
    await say("error", null, `The refresh stopped: ${message(e)}.`);
  }
}

/**
 * Hand the file to the instance, which imports it exactly as it imports a picked one.
 *
 * Multipart rather than JSON because that is the boundary the import route already has (#685): a
 * Colnect export *is* a file, and sending it as one means the size ceiling, the parser and the
 * refusals are the same whichever way it arrived.
 *
 * `requireList` is the one thing the manual route does not send. A collector picking a file can
 * legitimately load the export's `"Test Swap FROM"` column into the list they call Swap; a refresh
 * nobody is watching cannot make that judgement, so a file naming a different list is refused rather
 * than written over the right snapshot.
 */
async function postToInstance(
  task: ExportTask,
  fileName: string,
  text: string
): Promise<{ ok: true; report: ExportHandoffReport } | { ok: false; error: string }> {
  const profile = await getActiveProfile();
  if (!profile || profile.collectionId !== task.collectionId) {
    return {
      ok: false,
      error: "This browser's Assistant is not set up for that collection — check it in the Assistant's options.",
    };
  }

  const form = new FormData();
  form.append("file", new Blob([text], { type: "text/csv" }), fileName);
  form.append("commit", "1");
  form.append("lt", String(task.lt));
  form.append("requireList", "1");

  let res: Response;
  try {
    res = await fetch(
      `${normalizeBaseUrl(profile.apiBaseUrl)}/api/collections/${task.collectionId}/colnect/list-import`,
      { method: "POST", headers: { Authorization: `Bearer ${profile.token}` }, body: form }
    );
  } catch (e) {
    return { ok: false, error: `Your Stamporama could not be reached: ${message(e)}.` };
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const stated =
      typeof (payload as { error?: unknown })?.error === "string"
        ? ((payload as { error: string }).error)
        : `Your Stamporama answered HTTP ${res.status}.`;
    return { ok: false, error: stated };
  }

  const result = (payload ?? {}) as Partial<ExportHandoffReport>;
  return {
    ok: true,
    report: {
      rowsWritten: result.rowsWritten ?? 0,
      rowsOnList: result.rowsOnList ?? 0,
      rowsWithoutId: result.rowsWithoutId ?? 0,
    },
  };
}

/** Tell the page that asked how it went. Fire-and-forget: the tab may be closed, and the snapshot on
 *  the instance is the real record either way. */
async function tell(
  instanceTabId: number | null,
  requestId: string,
  state: ExportHandoffState,
  report: ExportHandoffReport | null,
  text: string
): Promise<void> {
  if (instanceTabId === null) return;
  const notice: ColnectExportProgressNotice = {
    type: "colnect-export-progress",
    requestId,
    state,
    message: text,
    report,
  };
  try {
    await chrome.tabs.sendMessage(instanceTabId, notice);
  } catch {
    // The report screen is closed. The import either happened or did not; the next visit reads it.
  }
}
