import "../platform/modules"; // registers the shipped platform modules into this bundle's registry
import { resolveListedUrl, resolveListingTarget, selectListingPhotos } from "../platform/listing-run";
import type {
  AttachPhotosRequest,
  AttachPhotosResponse,
  FillRequest,
  FillResponse,
  ListedNotice,
  ListedResponse,
  ListResponse,
} from "../core/messages";
import type { ListingFillOutcome, ListingSkippedField, ListingTask } from "../platform/listing";
import { fetchListingPhotos } from "./photo-client";
import {
  forgetPendingListing,
  getPendingListing,
  markPendingListingSubmitted,
  rememberPendingListing,
  type PendingListing,
} from "./pending-listings";
import { postListedUrl, profileForListing } from "./listing-client";

// The wiring around `listing-run.ts` (#409): the half that has a browser to drive.
//
// `resolveListingTarget` and `fillListing` are pure and know nothing of Colnect or of tabs; what
// sits between them is a **navigation**, and this is where it happens — open the sale form beside
// the page that asked, wait for it, and have the content script there fill it. A second marketplace
// reuses every line of this unchanged, because nothing here names one.
//
// Nothing is submitted, here or below: the collector clicks the platform's own button.

/** How long to wait for the sale form to load before giving up. Generous — a marketplace form is a
 *  heavy page and the collector may be signing in — but finite, so a tab that never settles reports
 *  a timeout instead of leaving the offer card spinning for ever. */
const LOAD_TIMEOUT_MS = 90_000;

/** How long to wait for a page that is **not the form yet** to turn into it (#419) — an anti-bot
 *  interstitial reloads itself after a moment, and a sign-in page never does. Short, because this is
 *  a wait the collector is watching, and the error the page already has is the honest answer once it
 *  runs out. */
const RELOAD_TIMEOUT_MS = 20_000;

/** How many times a listing is filled again after the page reloaded under it (#419). A challenge
 *  page may serve a second one; a loop that never gives up would fill the same form for ever. */
const FILL_ATTEMPTS = 4;

/**
 * Run one listing task: resolve the module and the form URL, open it, fill it, and report.
 *
 * `sender` is the instance tab the handoff came from, used only to place the new tab beside it —
 * a listing session is worked through offer by offer, so the form belongs next to the workspace and
 * not at the end of a window's worth of tabs.
 */
export async function runListingTask(
  task: ListingTask,
  requestId: string,
  sender: chrome.tabs.Tab | undefined
): Promise<ListResponse> {
  const target = resolveListingTarget(task);
  if (!target.ok) return { ok: false, error: target.error };

  // The pictures are fetched **while the sale form loads** (#411) — from Stamporama, which is not the
  // marketplace, so nothing about this reaches the platform. What they are handed to, and when, is
  // decided further down, after the form is filled.
  const photos = loadListingPhotos(task, originOf(sender?.url));

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.create({
      url: target.url,
      active: true,
      openerTabId: sender?.id,
      windowId: sender?.windowId,
      index: sender?.index === undefined ? undefined : sender.index + 1,
    });
  } catch (e) {
    return { ok: false, error: `Could not open ${target.moduleName}'s listing form: ${message(e)}` };
  }
  if (tab.id === undefined) {
    return { ok: false, error: `Could not open ${target.moduleName}'s listing form.` };
  }

  try {
    await waitForLoad(tab.id);
    const res = await fillThroughReloads(tab.id, task);
    if (!res.ok) return { ok: false, error: res.error };

    // The form is filled and the collector takes over. What they do next — Save, or nothing at all —
    // happens in their own time, long after this worker has been unloaded, so the wait is written
    // down rather than held (#412). Written **before** the pictures go in: uploading them takes
    // seconds during which the collector can already press Save, and this record is what turns that
    // into a listed URL.
    await rememberPendingListing({
      tabId: tab.id,
      moduleId: res.moduleId,
      moduleName: res.moduleName,
      formUrl: target.url,
      offerId: task.offerId,
      collectionId: task.collectionId,
      requestId,
      instanceTabId: sender?.id ?? null,
      instanceOrigin: originOf(sender?.url),
      submitted: false,
      filledAt: Date.now(),
    });

    // Pictures last, and only now: Colnect posts each one the moment it is handed over, before the
    // sale is saved (#402), so this is the first thing in the run that writes to the marketplace at
    // all — and it happens with a filled form already in front of the collector.
    const outcome = mergeOutcomes(
      res.outcome,
      await attachPhotos(tab.id, res.moduleId, await photos)
    );

    return {
      ok: true,
      moduleId: res.moduleId,
      moduleName: res.moduleName,
      formUrl: target.url,
      outcome,
    };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/**
 * Fill the form in `tabId`, following the page through a reload it performs under us (#419).
 *
 * Colnect sometimes answers the sale form's own address with an **anti-bot interstitial** that
 * reloads itself into the real form a second or two later. Filled once and reported, that page costs
 * the whole text half of the listing: the form arrives blank while the pictures — fetched meanwhile
 * and attached afterwards — land on it perfectly, which is exactly what the bug looked like.
 *
 * So a page the module recognises by address but not by contents is not an outcome, it is a **wait**:
 * the next load in this tab starts the fill over, injection included, since a fresh document has no
 * content script in it. Bounded twice over — a fixed number of attempts and a short wait for each —
 * because a page that never becomes the form (a sign-in, a challenge the collector has to solve) must
 * end in the error it already has rather than in a spinner.
 */
async function fillThroughReloads(tabId: number, task: ListingTask): Promise<FillResponse> {
  let last: FillResponse = { ok: false, error: "The listing form never loaded." };
  for (let attempt = 1; attempt <= FILL_ATTEMPTS; attempt += 1) {
    // Armed **before** the attempt: an interstitial can reload while the fill message is in flight,
    // and a watcher started afterwards would have missed the one event it exists to catch.
    const reload = watchNextLoad(tabId);
    last = await fillOnce(tabId, task);
    if (last.ok || !last.retry) {
      reload.cancel();
      return last;
    }
    // Nothing settled in time: the page is what it is, and its own answer is the one worth giving.
    if (!(await reload.settled)) return last;
  }
  return last;
}

/** One injection and one fill on whatever the tab is showing now. A messaging failure is reported as
 *  **retryable**: the usual cause is the page navigating out from under the message, which is the very
 *  thing {@link fillThroughReloads} is waiting for. */
async function fillOnce(tabId: number, task: ListingTask): Promise<FillResponse> {
  try {
    // The declared content script covers the marketplace's own origin, but a tab that was already
    // open before an extension reload never ran it — the popup injects for the same reason. The
    // script guards itself against running twice.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return (await chrome.tabs.sendMessage(tabId, {
      type: "fill",
      task,
    } satisfies FillRequest)) as FillResponse;
  } catch (e) {
    return { ok: false, error: message(e), retry: true };
  }
}

/** What one listing hands over: the images that were fetched, and the report for every one that was
 *  not — the plan's own reasons and the fetch's failures together, since the collector fixes each of
 *  them somewhere different. */
interface LoadedListingPhotos {
  photos: AttachPhotosRequest["photos"];
  skipped: ListingSkippedField[];
}

/**
 * Fetch this task's pictures from the instance the handoff came from (#411).
 *
 * The connection is named exactly as the write-back names it (#412): the page's **origin** plus the
 * task's **collection**, the only pair that identifies one connection — so the token used is the one
 * the collector issued from the very collection this offer belongs to.
 *
 * Every failure is a report and never a refusal: the form is filled either way, and the fallback the
 * scope asks for is dragging the offer's ZIP in, not redoing the listing.
 */
async function loadListingPhotos(
  task: ListingTask,
  origin: string | null
): Promise<LoadedListingPhotos> {
  const selection = selectListingPhotos(task);
  if (selection.images.length === 0) return { photos: [], skipped: selection.skipped };

  const refused = (reason: string): LoadedListingPhotos => ({
    photos: [],
    skipped: [...selection.skipped, { field: "Pictures", reason }],
  });
  try {
    const profile = await profileForListing(origin, task.collectionId);
    if (!profile) {
      return refused("This Assistant holds no connection to the Stamporama the offer came from.");
    }
    const fetched = await fetchListingPhotos(profile, selection.images);
    return { photos: fetched.photos, skipped: [...selection.skipped, ...fetched.skipped] };
  } catch (e) {
    return refused(`Stamporama would not hand the pictures over: ${message(e)}`);
  }
}

/**
 * Hand the fetched pictures to the page that now holds the filled form, and report what it did with
 * them (#411).
 *
 * Nothing fetched is not silence in itself — the plan may have had reasons — so the loader's own
 * report always comes back, whether or not there was anything to attach.
 */
async function attachPhotos(
  tabId: number,
  moduleId: string,
  loaded: LoadedListingPhotos
): Promise<ListingFillOutcome> {
  const reported: ListingFillOutcome = { filled: [], skipped: loaded.skipped };
  if (loaded.photos.length === 0) return reported;
  try {
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: "attach-photos",
      moduleId,
      photos: loaded.photos,
    } satisfies AttachPhotosRequest)) as AttachPhotosResponse;
    if (!res.ok) {
      reported.skipped.push({ field: "Pictures", reason: res.error });
      return reported;
    }
    return mergeOutcomes(reported, res.outcome);
  } catch (e) {
    // The tab may have been closed while the bytes were on their way — the collector's own answer to
    // a listing they changed their mind about, and one that has posted nothing.
    reported.skipped.push({ field: "Pictures", reason: message(e) });
    return reported;
  }
}

/** The fill's report and the pictures' report, in that order: the fields the collector reads first
 *  are the ones the form is filled with. */
function mergeOutcomes(first: ListingFillOutcome, second: ListingFillOutcome): ListingFillOutcome {
  return {
    filled: [...first.filled, ...second.filled],
    skipped: [...first.skipped, ...second.skipped],
  };
}

/**
 * A navigation in a tab that holds a filled form: the one place the listing's own URL can be read
 * (#412).
 *
 * The module is asked whether this page **is** the listed entry — for Colnect it is, Save landing
 * straight on it — and only an answer captures. Every other page is silence: the collector may be
 * signing in, may have followed a link out of the form, or the form may have come back with its own
 * validation errors, and none of those has produced a listing.
 */
export async function captureListedUrl(tabId: number, url: string): Promise<void> {
  const pending = await getPendingListing(tabId, Date.now());
  if (!pending) return;
  const listedUrl = resolveListedUrl(pending.moduleId, url);
  if (!listedUrl) return;

  // Forgotten first: the entry page may fire more than one navigation event, and an offer is
  // activated once.
  await forgetPendingListing(tabId);
  await deliverListedUrl(pending, listedUrl);
}

/**
 * The listing tab was closed. A form the collector **submitted** whose entry was never recognised is
 * worth saying so — the listing exists and the offer does not know — while an abandoned one is worth
 * nothing at all: it leaves a Ready offer exactly as it was, which is what the scope asks for.
 */
export async function listingTabClosed(tabId: number): Promise<void> {
  const pending = await getPendingListing(tabId, Date.now());
  await forgetPendingListing(tabId);
  if (pending?.submitted) await deliverListedUrl(pending, null);
}

/** The filled form has been submitted, reported by the content script watching it (#412). */
export async function listingSubmitted(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  await markPendingListingSubmitted(tabId);
}

/**
 * Get the outcome home: to the **page** that handed the offer over, which publishes it itself, and
 * failing that straight to the instance.
 *
 * The page is preferred because that is #407's rule — the extension reports and the instance decides,
 * with the collector watching it happen on the card they started from. But this arrives after Save,
 * by which time that page may be closed, navigated away, or following the next offer's handoff, and
 * the URL is the one thing that cannot be recovered later. So a `taken: false` (or no page to ask at
 * all) falls through to the endpoint, which is idempotent precisely so the two cannot collide.
 *
 * A null `listedUrl` is the "submitted, URL unread" report: there is nothing to post, and the page is
 * simply told so.
 */
async function deliverListedUrl(pending: PendingListing, listedUrl: string | null): Promise<void> {
  const notice: ListedNotice = {
    type: "listed",
    requestId: pending.requestId,
    offerId: pending.offerId,
    moduleId: pending.moduleId,
    moduleName: pending.moduleName,
    formUrl: pending.formUrl,
    listedUrl,
  };

  let taken = false;
  if (pending.instanceTabId !== null) {
    try {
      const res = (await chrome.tabs.sendMessage(pending.instanceTabId, notice)) as
        | ListedResponse
        | undefined;
      taken = res?.taken === true;
    } catch {
      taken = false; // the tab is gone, or on another origin now
    }
  }
  if (taken || !listedUrl) return;

  const profile = await profileForListing(pending.instanceOrigin, pending.collectionId);
  if (!profile) {
    // Nothing to post with: the instance the page was on is not one this Assistant holds a token for
    // (the collector may have disconnected it since). The listing stands; the offer is activated in
    // Stamporama, where a blank URL is already an accepted answer.
    console.warn("[assistant] no connection to record the listing with", pending.instanceOrigin);
    return;
  }
  try {
    await postListedUrl(profile, pending.offerId, listedUrl);
  } catch (e) {
    console.warn("[assistant] could not record the listing's URL", message(e));
  }
}

/** The origin of a tab's URL, or null — how the page's own instance is named. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Resolve once the tab has finished loading a document. Rejects when the collector closes it, and
 *  when nothing has settled inside {@link LOAD_TIMEOUT_MS} — both being answers the page can state,
 *  unlike a promise that never resolves. */
function waitForLoad(tabId: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const done = (fn: () => void) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      fn();
    };
    const onUpdated = (id: number, change: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && change.status === "complete") done(resolve);
    };
    const onRemoved = (id: number) => {
      if (id === tabId) done(() => reject(new Error("The listing tab was closed.")));
    };
    const timer = setTimeout(
      () => done(() => reject(new Error("The listing form did not finish loading."))),
      LOAD_TIMEOUT_MS
    );
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    // The tab may already have settled between `create` and this listener going on.
    void chrome.tabs.get(tabId).then(
      (t) => {
        if (t.status === "complete") done(resolve);
      },
      () => done(() => reject(new Error("The listing tab was closed.")))
    );
  });
}

/**
 * Watch for the tab finishing a **further** document load: `settled` resolves `true` when one lands,
 * and `false` when nothing does inside {@link RELOAD_TIMEOUT_MS} or the collector closes the tab
 * (#419).
 *
 * Deliberately without {@link waitForLoad}'s "it may already be complete" shortcut: the page this is
 * armed on is *already* complete and is exactly the one being waited out, so reading its state would
 * answer instantly and turn the retry into a spin. Deliberately not a rejection either — a page that
 * stays put is the normal outcome here, and the caller has the page's own error to report.
 *
 * `cancel()` is what a run that no longer needs it calls, so a listing that filled first time leaves
 * no listener and no timer behind in a worker that goes on serving other work.
 */
function watchNextLoad(tabId: number): { settled: Promise<boolean>; cancel: () => void } {
  let finish: (value: boolean) => void = () => {};
  const settled = new Promise<boolean>((resolve) => {
    finish = (value: boolean) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      resolve(value);
    };
    const onUpdated = (id: number, change: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && change.status === "complete") finish(true);
    };
    const onRemoved = (id: number) => {
      if (id === tabId) finish(false);
    };
    const timer = setTimeout(() => finish(false), RELOAD_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
  return { settled, cancel: () => finish(false) };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
