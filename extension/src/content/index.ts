import { findCaptureModuleForUrl, findModuleForUrl } from "../platform/modules";
import { attachListingPhotos, fillListing } from "../platform/listing-run";
import { linkifyInstanceUrls, registeredOrigins } from "../core/instance-links";
import {
  anchorIsListRow,
  anchorNeedsLink,
  isAssistantNode,
  offerAnchors,
  renderInlineOfferLink,
  renderOfferMarker,
  type OfferMarkerTarget,
} from "../core/offer-marker";
import { getProfileStore } from "../core/profile";
import { markIconUrl as iconUrl } from "../core/mark";
import type {
  AttachPhotoPayload,
  AttachPhotosRequest,
  AttachPhotosResponse,
  DetectedNotice,
  CaptureRequest,
  CaptureResponse,
  ExtractRequest,
  ExtractResponse,
  FillRequest,
  FillResponse,
  ListingSubmittedNotice,
  OfferLookupRequest,
  OfferLookupResponse,
} from "../core/messages";
import type { ListingPhotoFile } from "../platform/listing";

// Content script. It runs two ways, both guarded so only one instance is ever live per page:
//   • declaratively (manifest `content_scripts`) on Colnect — so the toolbar badge can show how many
//     items the page holds before the popup is ever opened — and on Allegro's offer pages and the
//     seller's own assortment list, for the links back to the offers those listings are here (#466);
//   • injected on demand by the popup (chrome.scripting) — which also covers tabs that were already
//     open when the extension was installed or reloaded, where the declarative script never ran.
//
// The Colnect pattern is a coarse net (all of colnect.com); `findModuleForUrl` does the precise
// check, so a non-catalog Colnect page simply reports zero. The Allegro one is deliberately narrow
// — the offer pages (`/oferta/*`, `/produkt/*`) and the seller's own assortment list — because #355
// scripted none of that site: a capture starts with a toolbar click, which is what grants access to
// the page. An in-page link cannot wait for a click, so the narrowest match that still covers the
// pages the collector reads their own listings on is the trade made for it.
//
// Detection is entirely local — no instance call is made to produce the badge count.

declare global {
  interface Window {
    __stamporamaAssistantLoaded?: boolean;
  }
}

/** Longest edge of a captured thumbnail, in px — enough to compare a stamp, small to message. */
const THUMB_MAX_EDGE = 96;

/** The already-rendered <img> for a URL, so capture never refetches anything. */
function renderedImage(url: string): HTMLImageElement | null {
  for (const img of Array.from(document.images)) {
    if (img.currentSrc === url || img.src === url) return img;
  }
  return null;
}

/**
 * Re-encode a rendered image as a small `data:` URL by drawing it to a canvas.
 *
 * The extension page is a different origin from Colnect, so pointing an <img> there at a Colnect
 * URL is a hotlink the site may refuse. Capturing here sidesteps that: in the page, the thumbnail
 * is same-origin and already decoded. Returns undefined if the image hasn't loaded, or if the
 * canvas is tainted — which happens when the image comes from a CDN without CORS headers, and is a
 * normal outcome, not an error: the row simply shows no Colnect picture.
 */
function captureThumb(img: HTMLImageElement): string | undefined {
  if (!img.complete || !img.naturalWidth || !img.naturalHeight) return undefined;
  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  try {
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return undefined; // tainted canvas — cross-origin image without CORS
  }
}

/**
 * Extract the current page with whichever module handles it, or null when none does.
 * `withImages` drives the canvas capture, which is only worth its cost when the window is actually
 * going to display the thumbnails — not on every page view for the badge.
 */
function extractHere(withImages: boolean) {
  const module = findModuleForUrl(location.href);
  if (!module) return null;
  const items = module.extraction.extract(document);
  if (withImages) {
    for (const item of items) {
      if (!item.imageUrl) continue;
      const img = renderedImage(item.imageUrl);
      if (img) item.imageData = captureThumb(img);
    }
  }
  return items;
}

/**
 * Note the moment the collector submits the form the Assistant filled (#412).
 *
 * Filling stops before Save, so what happens afterwards is the collector's own doing — and the two
 * outcomes need telling apart. A submitted listing whose entry page is never recognised is worth
 * reporting, because the listing exists and the offer does not know; a form simply abandoned is worth
 * nothing at all, and reporting it would raise an alarm about an offer nothing happened to.
 *
 * The page is the sale form (the fill refused otherwise), so any submit on it is that listing. A form
 * a site posts through script raises no `submit` event and is therefore missed — which costs only the
 * distinction, never the capture: the entry page is read from the navigation either way.
 */
function watchForSubmit(): void {
  document.addEventListener(
    "submit",
    () => {
      void chrome.runtime
        .sendMessage({ type: "listing-submitted" } satisfies ListingSubmittedNotice)
        .catch(() => {});
    },
    { capture: true, once: true }
  );
}

/**
 * Turn one messaged image back into a `File` (#411).
 *
 * Built here rather than in the worker because a `File` does not survive extension messaging, and
 * because this is the realm the form lives in: the object a page's uploader receives should have been
 * made by the same window as the page it is handed to.
 */
function toFile(photo: AttachPhotoPayload): ListingPhotoFile {
  const binary = atob(photo.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return {
    photoId: photo.photoId,
    file: new File([bytes], photo.fileName, { type: photo.mime }),
  };
}

/**
 * Make the Stamporama link in a Colnect **private note** clickable (#417).
 *
 * Colnect prints the note as text in one dedicated element on a sale page, so the `{offerUrl}` a
 * listing carries there (#415) cannot be followed without selecting it by hand. The note element is
 * the entire search area — deliberately, rather than the whole page: this rewrites only the field
 * the collector's own text is in, never Colnect's copy.
 *
 * Which URLs become links is decided by `linkifyInstanceUrls` on the registered origins alone, so a
 * page with no note, no profile, or a link to somewhere else is silently untouched.
 */
async function linkifyPrivateNote(): Promise<void> {
  const notes = document.querySelectorAll("._sl-private-note");
  if (notes.length === 0) return;
  const { profiles } = await getProfileStore();
  const origins = registeredOrigins(profiles.map((p) => p.apiBaseUrl));
  for (const note of Array.from(notes)) linkifyInstanceUrls(note, origins, iconUrl);
}

/**
 * Ask the instance which of `platformOfferIds` are offers of this collection (#466).
 *
 * Answers are **remembered for the life of the page**: the assortment table re-renders on every
 * filter, sort and page change, and re-asking about rows we have already asked about would turn one
 * lookup into one per re-render. A miss is remembered too — that is what keeps a page of somebody
 * else's listings from being asked about again and again.
 */
const knownOffers = new Map<string, OfferMarkerTarget | null>();

async function lookupOffers(platformOfferIds: string[]): Promise<void> {
  const unknown = platformOfferIds.filter((id) => !knownOffers.has(id));
  if (unknown.length === 0) return;

  const res = (await chrome.runtime.sendMessage({
    type: "offer-lookup",
    platformOfferIds: unknown,
  } satisfies OfferLookupRequest)) as OfferLookupResponse;
  if (!res?.ok) return;
  for (const id of unknown) knownOffers.set(id, res.matches[id] ?? null);
}

/** The listing id an anchor points at, through whichever module handles that address — so the shell
 *  never names Allegro, and an anchor pointing anywhere else answers null. */
function anchorListingId(anchor: HTMLAnchorElement): string | null {
  const href = anchor.href;
  if (!href) return null;
  return findCaptureModuleForUrl(href)?.capture.listingId(href) ?? null;
}

/**
 * Draw the link to the offer behind every listing this page links to, and behind the page itself
 * (#466).
 *
 * Two shapes of the same answer. A **listing page** gets the corner chip: the page *is* one offer,
 * and the question was asked before any click. A **list** — Allegro's *Mój asortyment* — gets a small
 * link beside each row's own title, because there the question is asked once per row.
 *
 * The page states which listings it is about — each address read by the module that handles it,
 * exactly as the capture reads the one it is standing on — and the instance states which of those
 * are ours. The page is never asked what it *sells*: a listing the collector is bidding on and one
 * they are selling are the same URL shape and the same markup, and only the collection can tell the
 * two apart.
 *
 * Silent on every listing that is somebody else's, which is nearly all of them, and silent when
 * there is no profile, no instance, or no answer. A marker that appeared on a stranger's auction
 * would be worse than none.
 *
 * Only anchors that are **rows of a list** are answered inline. A page links to listings elsewhere
 * too — the search box above the assortment table suggests them as you type — and those are neither
 * a place the question is being asked nor markup that stays still long enough to answer it.
 */
async function markOwnListings(): Promise<void> {
  const pending: { anchor: HTMLAnchorElement; id: string }[] = [];
  for (const anchor of offerAnchors(document)) {
    if (!anchorIsListRow(anchor)) continue;
    const id = anchorListingId(anchor);
    if (id && anchorNeedsLink(anchor, id)) pending.push({ anchor, id });
  }

  const pageListingId = findCaptureModuleForUrl(location.href)?.capture.listingId(location.href);
  const ids = pending.map((entry) => entry.id);
  if (pageListingId) ids.push(pageListingId);
  if (ids.length === 0) return;

  await lookupOffers(ids);

  if (pageListingId) {
    const match = knownOffers.get(pageListingId);
    if (match) renderOfferMarker(document, match, iconUrl);
  }
  // A listing that matched nothing is recorded as answered all the same — that is what stops a table
  // of somebody else's offers being re-tested on every re-render for ever.
  for (const { anchor, id } of pending) {
    renderInlineOfferLink(anchor, id, knownOffers.get(id) ?? null, iconUrl);
  }
}

/** How long to let a burst of DOM changes settle before re-scanning. A filtered, sorted or paged
 *  table rewrites hundreds of rows in one go, and scanning after each would be a scan per row. */
const RESCAN_DELAY_MS = 300;

/**
 * Keep the links on a page that redraws itself.
 *
 * The assortment table is a client-rendered list: filtering, sorting and paging replace its rows
 * without a navigation, taking our links with them. So the page is watched rather than read once —
 * and because every anchor we have answered for is marked, a re-scan of an untouched table finds
 * nothing to do and costs one `querySelectorAll`.
 *
 * **Our own writing is not a change worth reacting to.** Drawing a link is a DOM change like any
 * other, so a watcher that does not exclude it schedules a scan for every link it draws, and a page
 * that also redraws itself never settles — which is the page moving under the collector's hands.
 */
function watchForNewListings(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver((records) => {
    const theirs = records.some((record) => {
      if (isAssistantNode(record.target)) return false;
      const touched = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
      return touched.length === 0 || touched.some((node) => !isAssistantNode(node));
    });
    if (!theirs) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void markOwnListings().catch(() => {});
    }, RESCAN_DELAY_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (!window.__stamporamaAssistantLoaded) {
  window.__stamporamaAssistantLoaded = true;

  // The listing form's own half (#409): the background worker opened this tab at the sale form and
  // asks the page to fill it in. The fill is DOM work through the task's own module, so it happens
  // here; the module stops before submit, so nothing is posted.
  chrome.runtime.onMessage.addListener(
    (msg: FillRequest, _sender, sendResponse: (r: FillResponse) => void) => {
      if (msg?.type !== "fill") return;
      const result = fillListing(msg.task, document, location.href);
      if (result.ok) watchForSubmit();
      sendResponse(
        result.ok
          ? {
              ok: true,
              moduleId: result.moduleId,
              moduleName: result.moduleName,
              outcome: result.outcome,
            }
          : { ok: false, error: result.error, retry: result.retry }
      );
    }
  );

  // The pictures, once the form is filled (#411). Deliberately a second message and deliberately
  // last: Colnect's uploader posts each picture the moment it is handed over, before the sale is
  // saved, so the form in front of the collector is complete before anything is written there.
  chrome.runtime.onMessage.addListener(
    (msg: AttachPhotosRequest, _sender, sendResponse: (r: AttachPhotosResponse) => void) => {
      if (msg?.type !== "attach-photos") return;
      try {
        const result = attachListingPhotos(
          msg.moduleId,
          document,
          location.href,
          msg.photos.map(toFile)
        );
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  // One auction, read for the watchlist (#355). Same shape as `extract` and for the same reason —
  // reading a page is DOM work — but a different question, so a different module half answers it.
  chrome.runtime.onMessage.addListener(
    (msg: CaptureRequest, _sender, sendResponse: (r: CaptureResponse) => void) => {
      if (msg?.type !== "capture") return;
      try {
        const module = findCaptureModuleForUrl(location.href);
        if (!module) {
          sendResponse({ ok: false, error: "No Assistant module captures lots from this page." });
          return;
        }
        const result = module.capture.capture(document, location.href);
        sendResponse(
          result.ok
            ? { ok: true, moduleId: module.id, moduleName: module.name, lot: result.lot }
            : { ok: false, error: result.message, reason: result.reason, message: result.message }
        );
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  chrome.runtime.onMessage.addListener(
    (msg: ExtractRequest, _sender, sendResponse: (r: ExtractResponse) => void) => {
      if (msg?.type !== "extract") return;
      try {
        const items = extractHere(true);
        if (!items) {
          sendResponse({ ok: false, error: "No Assistant module matches this page." });
          return;
        }
        sendResponse({ ok: true, items });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  // Report what this page holds, for the toolbar badge — and, when match-on-load is enabled, for
  // the background to dry-run it so the badge counts work to do rather than page contents. Refs
  // only: no names, no image bytes, since this is sent on every supported page view. Best-effort
  // and fire-and-forget (the service worker may be asleep on a page we don't handle).
  try {
    const items = extractHere(false) ?? [];
    const notice: DetectedNotice = {
      type: "detected",
      count: items.length,
      refs: items.map((i) => ({ platformItemId: i.platformItemId, catalogRefs: i.catalogRefs })),
    };
    void chrome.runtime.sendMessage(notice).catch(() => {});
  } catch {
    /* detection must never break the page */
  }

  // Best-effort and last, for the same reason detection is guarded: a note that fails to linkify
  // must cost the collector nothing but the click they were already making. The same goes for the
  // listing marker, which additionally asks the instance a question — one it may not be there to
  // answer, on a page that must not notice either way.
  void linkifyPrivateNote().catch(() => {});
  void markOwnListings()
    .catch(() => {})
    .finally(() => watchForNewListings());
}
