import { findCaptureModuleForUrl, findModuleForUrl } from "../platform/modules";
import { attachListingPhotos, fillListing } from "../platform/listing-run";
import { linkifyInstanceUrls, registeredOrigins } from "../core/instance-links";
import { getProfileStore } from "../core/profile";
import iconUrl from "../../icons/icon-16.png";
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
} from "../core/messages";
import type { ListingPhotoFile } from "../platform/listing";

// Content script. It runs two ways, both guarded so only one instance is ever live per page:
//   • declaratively on Colnect pages (manifest `content_scripts`) — so the toolbar badge can show
//     how many items the page holds before the popup is ever opened;
//   • injected on demand by the popup (chrome.scripting) — which also covers tabs that were already
//     open when the extension was installed or reloaded, where the declarative script never ran.
//
// The manifest's match pattern is a coarse net (all of colnect.com); `findModuleForUrl` does the
// precise check, so a non-catalog Colnect page simply reports zero. Detection is entirely local —
// no instance call is made to produce the badge count.

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
  // must cost the collector nothing but the click they were already making.
  void linkifyPrivateNote().catch(() => {});
}
