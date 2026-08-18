import {
  findCaptureModuleForUrl,
  findModuleForUrl,
  findOrdersModuleForUrl,
} from "../platform/modules";
import {
  attachListingPhotos,
  fillListing,
  prepareListing,
  resolveListedUrlInDocument,
} from "../platform/listing-run";
import { linkifyInstanceUrls, registeredOrigins } from "../core/instance-links";
import {
  anchorIsListRow,
  anchorNeedsLink,
  offerAnchors,
  renderInlineOfferLink,
  renderOfferMarker,
  type OfferMarkerTarget,
} from "../core/offer-marker";
import { isAssistantNode } from "../core/marker-shell";
import {
  orderNeedsMark,
  renderOrderMark,
  type OrderSaleTarget,
} from "../core/order-marker";
import { renderLotMarker, type LotMarkerTarget } from "../core/lot-marker";
import { getProfileStore } from "../core/profile";
import { markIconUrl as iconUrl } from "../core/mark";
import type { PlatformOrder } from "../platform/orders";
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
  ListedHereNotice,
  LotLookupRequest,
  LotLookupResponse,
  ListingSubmittedNotice,
  OfferLookupRequest,
  OfferLookupResponse,
  OrderImportRequest,
  OrderImportResponse,
  OrderLookupRequest,
  OrderLookupResponse,
} from "../core/messages";
import type { ListingPhotoFile, ListingTask } from "../platform/listing";

// Content script. It runs two ways, both guarded so only one instance is ever live per page:
//   • declaratively (manifest `content_scripts`) on Colnect — so the toolbar badge can show how many
//     items the page holds before the popup is ever opened — on Allegro's offer pages and the
//     seller's own assortment list, for the links back to the offers those listings are here (#466)
//     and to the auction lots they are being bid on as (#575), and on Delcampe's own sold-items
//     screens, for what each order is here and the button that records one (#612);
//   • injected on demand by the popup (chrome.scripting) — which also covers tabs that were already
//     open when the extension was installed or reloaded, where the declarative script never ran.
//
// The Colnect pattern is a coarse net (all of colnect.com); `findModuleForUrl` does the precise
// check, so a non-catalog Colnect page simply reports zero. The Allegro one is deliberately narrow
// — the offer pages (`/oferta/*`, `/produkt/*`) and the seller's own assortment list — because #355
// scripted none of that site: a capture starts with a toolbar click, which is what grants access to
// the page. An in-page link cannot wait for a click, so the narrowest match that still covers the
// pages the collector reads their own listings on is the trade made for it. Delcampe's is narrower
// still — the seller's own sold-items screens and nothing else — for the same reason: those are the
// only Delcampe pages this extension has anything to say about.
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
 * Make this page ready and then fill it from `task` (#493).
 *
 * **Prepare first, always.** A marketplace may answer the sale form's address with a page on the way
 * to it, and it may serve the form itself with fields folded away behind its own controls; both are
 * asynchronous and neither is a fill. Running it unconditionally is what makes those one step rather
 * than two rules — and it costs nothing for a module without a `prepare`, which is every module but
 * Allegro's.
 *
 * If preparing ended by navigating, the fill that follows lands on a dying document and reports
 * `retry`; the shell's own answer to that is already **wait for the next load and ask again** (#419),
 * which starts a fresh attempt on the page that arrives.
 *
 * A failing `prepare` replaces the fill's own error, because it is the more specific of the two: "no
 * category, so there is no form to open" says what to do, where "the form has not loaded" does not.
 */
async function fillHere(task: ListingTask): Promise<FillResponse> {
  const prepared = await prepareListing(task, document, location.href);
  if (!prepared.ok) return { ok: false, error: prepared.error };
  const result = fillListing(task, document, location.href);
  if (result.ok) {
    watchForSubmit();
    watchForListedUrl(result.moduleId);
  }
  return result.ok
    ? {
        ok: true,
        moduleId: result.moduleId,
        moduleName: result.moduleName,
        outcome: result.outcome,
      }
    : { ok: false, error: result.error, retry: result.retry };
}

/**
 * Note the moment the collector submits the form the Assistant filled (#412).
 *
 * Filling stops before Save, so what happens afterwards is the collector's own doing — and the two
 * outcomes need telling apart. A submitted listing whose entry page is never recognised is worth
 * reporting, because the listing exists and the offer does not know; a form simply abandoned is worth
 * nothing at all, and reporting it would raise an alarm about an offer nothing happened to.
 *
 * The page is the sale form (the fill refused otherwise), so any submit on it is that listing. **A
 * form the site posts through script raises no `submit` event** and is therefore missed — which is
 * why nothing that matters hangs off this: the listing's own URL is watched for separately (see
 * {@link watchForListedUrl}), and this only decides which of two reports a closed tab produces.
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

/** How long a filled form is watched for its own confirmation. Long, because it is the collector's
 *  own time being waited on: they review the form, they press the marketplace's button, and only
 *  then does the page have anything to say. */
const CONFIRMATION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Watch this page for the confirmation that says **what was listed** (#412/#493).
 *
 * Started the moment the form is filled, and deliberately **not** gated on `submit`: Allegro posts
 * its form through script, so no `submit` event is raised and a watch that waited for one never
 * starts. Nothing is lost by watching early either — a thank-you page can only appear after the form
 * has been posted, so its presence *is* the submission.
 *
 * A `MutationObserver` rather than a poll, because the page only changes once and the wait is long:
 * it costs nothing while nothing happens, and the check it runs is one `getElementById`.
 *
 * The background reads a listed URL off the tab's navigations as well (#412), which is the whole
 * answer on a marketplace that navigates to the new entry. Allegro never navigates — the address bar
 * stays on the form — so without this every Allegro listing ends as "submitted, URL unread", with the
 * listing existing and the offer never learning its address.
 */
function watchForListedUrl(moduleId: string): void {
  const report = (): boolean => {
    const url = resolveListedUrlInDocument(moduleId, document);
    if (!url) return false;
    // Said out loud, unlike anything else this script does: it happens once per listing, it is the
    // moment the offer here goes live, and when it does *not* happen there is otherwise nothing
    // anywhere to look at.
    console.info("[assistant] the listing was posted:", url);
    void chrome.runtime
      .sendMessage({ type: "listed-here", url } satisfies ListedHereNotice)
      .catch(() => {});
    return true;
  };
  // The page may already be showing it — a re-fill on a form that was posted a moment ago.
  if (report()) return;

  const observer = new MutationObserver(() => {
    if (report()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), CONFIRMATION_TIMEOUT_MS);
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

/**
 * The same question of the watchlist: "is this listing a lot I am already bidding on?" (#575).
 *
 * Remembered for the life of the page for the offer lookup's reason, and a miss is remembered too:
 * this is asked on every auction the collector opens, and nearly all of them are auctions nobody
 * here has ever bid on.
 */
const knownLots = new Map<string, LotMarkerTarget | null>();

async function lookupLots(platformOfferIds: string[]): Promise<void> {
  const unknown = platformOfferIds.filter((id) => !knownLots.has(id));
  if (unknown.length === 0) return;

  const res = (await chrome.runtime.sendMessage({
    type: "lot-lookup",
    platformOfferIds: unknown,
  } satisfies LotLookupRequest)) as LotLookupResponse;
  if (!res?.ok) return;
  for (const id of unknown) knownLots.set(id, res.matches[id] ?? null);
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

  // Both questions at once, and independently: a listing is one of ours to sell, one of ours to bid
  // on, or — nearly always — neither, and no answer here stands in for another. Only the page's own
  // listing is asked about as a lot: a list of auctions on a marketplace is somebody else's, where
  // the offer side has the collector's own assortment table to answer for.
  await Promise.all([lookupOffers(ids), pageListingId ? lookupLots([pageListingId]) : null]);

  if (pageListingId) {
    const match = knownOffers.get(pageListingId);
    if (match) renderOfferMarker(document, match, iconUrl);
    const lot = knownLots.get(pageListingId);
    if (lot) renderLotMarker(document, lot, iconUrl);
  }
  // A listing that matched nothing is recorded as answered all the same — that is what stops a table
  // of somebody else's offers being re-tested on every re-render for ever.
  for (const { anchor, id } of pending) {
    renderInlineOfferLink(anchor, id, knownOffers.get(id) ?? null, iconUrl);
  }
}

// ── The seller's own sold orders (#612) ─────────────────────────────────────

/** What the instance last said about each order on this page, by the marketplace's own order id.
 *  A miss is remembered too, exactly as the two listing lookups remember theirs: an order that is not
 *  recorded is the ordinary case, and the row showing *Import* is that answer being drawn. */
const knownOrders = new Map<string, OrderSaleTarget | null>();

/**
 * Mark every sold order on this page with what it is here (#612).
 *
 * The page states which orders it holds — read by the module that knows this marketplace, so the
 * shell never names Delcampe — and the **instance** states which of them are already sales. An order
 * it has never heard of gets the *Import* affordance, which is the only mark in the extension that
 * offers an act rather than an answer: it is what the collector came to the screen to do.
 *
 * Silent when the page is not a sold-order screen, when there is no profile, and when the instance
 * says nothing — a marked row that could not actually import would be worse than an unmarked one.
 */
async function markSoldOrders(): Promise<void> {
  const module = findOrdersModuleForUrl(location.href);
  if (!module) return;

  const orders = module.orders.read(document, location.href);
  if (orders.length === 0) return;

  const unknown = orders
    .map((order) => order.orderId)
    .filter((orderId) => !knownOrders.has(orderId));
  if (unknown.length > 0) {
    const res = (await chrome.runtime.sendMessage({
      type: "order-lookup",
      orderIds: unknown,
    } satisfies OrderLookupRequest)) as OrderLookupResponse;
    // No answer leaves the page unmarked rather than marked wrongly: nothing is recorded here as far
    // as this page is concerned, and offering to import into an instance that did not reply would
    // promise something the next click cannot deliver.
    if (!res?.ok) return;
    for (const orderId of unknown) knownOrders.set(orderId, res.matches[orderId] ?? null);
  }

  for (const order of orders) {
    if (!orderNeedsMark(order.anchor, order.orderId)) continue;
    drawOrderMark(order);
  }
}

/** Draw one row's mark from what is currently known about it, and wire its button. */
function drawOrderMark(order: PlatformOrder, refusal?: string): void {
  const sale = knownOrders.get(order.orderId);
  const state = sale
    ? ({ kind: "recorded", sale } as const)
    : refusal
      ? ({ kind: "refused", message: refusal } as const)
      : ({ kind: "importable" } as const);
  renderOrderMark(order.anchor, order.orderId, state, iconUrl, () => {
    void importOrder(order);
  });
}

/**
 * Record one order, and redraw its row with whatever the instance answered.
 *
 * The row says *Importing…* while the instance is deciding, because this is the one mark that starts
 * something: a button that stayed unchanged would be pressed again. What replaces it is always the
 * instance's own answer — the sale it created, or the sentence naming the item that stopped it, kept
 * verbatim so the collector reads the same words the app would have shown them.
 */
async function importOrder(order: PlatformOrder): Promise<void> {
  renderOrderMark(order.anchor, order.orderId, { kind: "importing" }, iconUrl, () => {});
  let res: OrderImportResponse;
  try {
    // The element the mark hangs on is not sent: what the instance decides from is what the page
    // printed, and an element is not something a message can carry anyway.
    const { anchor: _anchor, ...reported } = order;
    res = (await chrome.runtime.sendMessage({
      type: "order-import",
      order: reported,
    } satisfies OrderImportRequest)) as OrderImportResponse;
  } catch (e) {
    res = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (res?.ok) {
    knownOrders.set(order.orderId, res.sale);
    drawOrderMark(order);
    return;
  }
  drawOrderMark(order, res?.error ?? "The import failed.");
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
      void markSoldOrders().catch(() => {});
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
      void fillHere(msg.task).then(sendResponse);
      // Answered asynchronously: a marketplace whose form is reached through its own entry pages is
      // walked there first (#493), and that is a wait on the site rather than a DOM pass.
      return true;
    }
  );

  // The pictures, once the form is filled (#411). Deliberately a second message and deliberately
  // last: Colnect's uploader posts each picture the moment it is handed over, before the sale is
  // saved, so the form in front of the collector is complete before anything is written there.
  chrome.runtime.onMessage.addListener(
    (msg: AttachPhotosRequest, _sender, sendResponse: (r: AttachPhotosResponse) => void) => {
      if (msg?.type !== "attach-photos") return;
      void attachListingPhotos(msg.moduleId, document, location.href, msg.photos.map(toFile))
        .then(sendResponse)
        .catch((e: unknown) =>
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
        );
      // Answered asynchronously: a marketplace may ask something about the pictures the moment it
      // takes them, and the uploader is not done until that is answered (#493).
      return true;
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
  void markSoldOrders().catch(() => {});
  void markOwnListings()
    .catch(() => {})
    .finally(() => watchForNewListings());
}
