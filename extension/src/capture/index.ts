import {
  assignProfileColors,
  getProfileStore,
  profileSubtitle,
  setActiveProfileId,
  type Profile,
} from "../core/profile";
import type {
  CaptureResponse,
  CaptureSaveRequest,
  CaptureSaveResponse,
} from "../core/messages";
import type { CapturedLot } from "../platform/capture";
import type { CaptureOutcome } from "../core/capture";

// The **capture window** (#355): one auction listing, read off the page it is on, reviewed, and
// written into the watchlist.
//
// A window of its own rather than a mode of the match window, for the same reason the match window
// is not a toolbar popup: it is a different question about a different kind of page, and the two
// share nothing but the profile badge. Which one the toolbar icon opens is decided by the page in
// front of it (`findCaptureModuleForUrl`), so the collector performs one gesture either way.
//
// Everything on screen is **editable before it is written**. What a marketplace prints is a
// proposal — a seller's shop name is not reliably the contact they are filed under here, and a page
// that phrases its price oddly should not silently become a bid nobody placed — so the fields are
// inputs, and the instance is asked what *would* happen before anything does.

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const badge = $("badge");
const badgeName = $("badgeName");
const badgeUrl = $("badgeUrl");
const profileSelect = $<HTMLSelectElement>("profileSelect");
const sourceEl = $("source");
const formEl = $<HTMLFormElement>("form");
const titleEl = $<HTMLInputElement>("title");
const lotNoEl = $<HTMLInputElement>("lotNo");
const sellerEl = $<HTMLInputElement>("seller");
const endsAtEl = $<HTMLInputElement>("endsAt");
const endsAtHint = $("endsAtHint");
const bidEl = $<HTMLInputElement>("currentBid");
const bidHint = $("bidHint");
const startEl = $<HTMLInputElement>("startingPrice");
const planEl = $("plan");
const planHead = $("planHead");
const planLine = $("planLine");
const saveBtn = $<HTMLButtonElement>("save");
const recheckBtn = $<HTMLButtonElement>("recheck");
const statusEl = $("status");

let profile: Profile | null = null;
/** The lot as the page stated it. The form edits a copy; this is kept only for the offer id and the
 *  URL, which are the listing's identity and are not the collector's to retype. */
let captured: CapturedLot | null = null;
let busy = false;
/** Bumped on every preview, so a slower one cannot overwrite a newer answer. */
let previewGeneration = 0;

// The page this window was opened from. Passed in the URL by the service worker: a separate window
// is its own "current window", so querying the active tab here would find this UI.
const sourceTabId = (() => {
  const raw = new URLSearchParams(location.search).get("tabId");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
})();

function setStatus(text: string, kind: "" | "err" | "ok" = ""): void {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function syncButtons(): void {
  saveBtn.disabled = busy || !profile || !captured || !endsAtEl.value;
  recheckBtn.disabled = busy;
}

// ── Profile badge ────────────────────────────────────────────────────────────

async function refreshProfile(): Promise<void> {
  const { profiles, activeProfileId } = await getProfileStore();
  const colors = assignProfileColors(profiles);
  profile = profiles.find((p) => p.id === activeProfileId) ?? null;

  profileSelect.hidden = profiles.length === 0;
  profileSelect.replaceChildren(
    ...profiles.map((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name || "Profile"} — ${profileSubtitle(p)}`;
      opt.selected = p.id === activeProfileId;
      return opt;
    })
  );

  if (profile) {
    badge.classList.remove("none");
    badge.style.setProperty("--accent", colors.get(profile.id) ?? "");
    badgeName.textContent = profile.name || "Profile";
    badgeUrl.textContent = profileSubtitle(profile);
  } else {
    badge.classList.add("none");
    badge.style.removeProperty("--accent");
    badgeName.textContent = "No active profile";
    badgeUrl.textContent = "Add one in Options, then click the toolbar icon again.";
  }
  syncButtons();
}

profileSelect.addEventListener("change", () => {
  void (async () => {
    await setActiveProfileId(profileSelect.value);
    await refreshProfile();
    // The previous answer was about another collection — a parcel, a seller and a lot that all
    // belong to the instance we just left. Ask the new one.
    hidePlan();
    void preview();
  })();
});

// ── Times ────────────────────────────────────────────────────────────────────
//
// The page states the close as an exact UTC instant; `datetime-local` speaks the browser's own zone,
// which is the collector's. Both conversions go through `Date`, so the value shown is the wall clock
// they read on the listing and the value sent is the instant the auction actually ends.

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

function localInputToIso(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

// ── Reading the page ─────────────────────────────────────────────────────────

async function readPage(): Promise<void> {
  captured = null;
  formEl.hidden = true;
  hidePlan();
  setStatus("");
  sourceEl.textContent = "Reading the page…";
  syncButtons();

  if (sourceTabId === null) {
    sourceEl.textContent = "The page this window was opened from is gone.";
    syncButtons();
    return;
  }

  try {
    // The declarative content script does not cover marketplaces we only ever capture from — the
    // feature starts with a click, and running a script on every page of a shop the collector
    // browses would be a cost with nothing to show for it. The click is also what grants access.
    await chrome.scripting.executeScript({ target: { tabId: sourceTabId }, files: ["content.js"] });
    const res = (await chrome.tabs.sendMessage(sourceTabId, { type: "capture" })) as CaptureResponse;
    if (!res.ok) {
      sourceEl.textContent = res.error;
      syncButtons();
      return;
    }
    captured = res.lot;
    fillForm(res.lot, res.moduleName);
  } catch (e) {
    sourceEl.textContent = e instanceof Error ? e.message : String(e);
  }
  syncButtons();
}

function fillForm(lot: CapturedLot, moduleName: string): void {
  sourceEl.textContent = `${moduleName} · ${lot.url}`;
  titleEl.value = lot.title ?? "";
  lotNoEl.value = lot.lotNo ?? "";
  sellerEl.value = lot.sellerName ?? "";
  endsAtEl.value = isoToLocalInput(lot.endsAt);
  bidEl.value = lot.currentBid ?? "";
  startEl.value = lot.startingPrice ?? "";
  endsAtHint.textContent = "";
  // Why the figure landed where it did. Without this, a lot nobody has bid on looks like a lot whose
  // bid the Assistant failed to read.
  bidHint.textContent = lot.currency
    ? lot.bidderCount
      ? `${lot.currency} · ${lot.bidderCount} bidding`
      : `${lot.currency} · no bids yet`
    : "";
  formEl.hidden = false;
  void preview();
}

// ── What would happen ────────────────────────────────────────────────────────

function hidePlan(): void {
  planEl.hidden = true;
}

function showPlan(result: CaptureOutcome): void {
  const refreshed = result.outcome === "refreshed";
  planEl.hidden = false;
  planEl.className = `plan ${refreshed ? "refresh" : "new"}`;
  planHead.textContent = refreshed
    ? "Already watched — the bid will be refreshed"
    : result.saleCreated
      ? `New parcel: ${result.saleName}`
      : `Joins the open parcel: ${result.saleName}`;
  const parts = [`${result.platformName} · ${result.saleCurrency}`];
  if (refreshed) {
    parts.push(result.previousBid ? `currently recorded at ${result.previousBid}` : "no bid recorded yet");
  } else {
    parts.push(result.sellerCreated ? `new seller: ${result.sellerName}` : `seller: ${result.sellerName}`);
  }
  planLine.textContent = parts.join(" · ");
}

function showBlocked(error: string): void {
  planEl.hidden = false;
  planEl.className = "plan blocked";
  planHead.textContent = "Cannot save this lot";
  planLine.textContent = error;
}

/** Ask the instance what a save would do. Re-asked whenever the seller changes, because the seller is
 *  what decides the parcel — and the answer is the whole reason to look before saving. */
async function preview(): Promise<void> {
  if (!captured || !profile) return;
  const generation = ++previewGeneration;
  const res = await send({ type: "capture-save", lot: currentLot(), dryRun: true });
  if (generation !== previewGeneration) return;
  if (res.ok) showPlan(res.result);
  else showBlocked(res.error);
}

/** The lot as the form now states it — the collector's corrections over the page's proposal. The
 *  offer id and the URL are never edited: they are what the listing *is*. */
function currentLot(): CapturedLot {
  const lot = captured!;
  return {
    ...lot,
    title: titleEl.value.trim() || null,
    lotNo: lotNoEl.value.trim() || null,
    sellerName: sellerEl.value.trim() || null,
    endsAt: localInputToIso(endsAtEl.value) || lot.endsAt,
    currentBid: bidEl.value.trim() || null,
    startingPrice: startEl.value.trim() || null,
  };
}

function send(msg: CaptureSaveRequest): Promise<CaptureSaveResponse> {
  return chrome.runtime.sendMessage(msg) as Promise<CaptureSaveResponse>;
}

// ── Saving ───────────────────────────────────────────────────────────────────

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  void save();
});

/**
 * Write the lot, then close the window (#522), exactly as the match window's batch write does
 * (#515).
 *
 * Saving is the last act here: the collector is going back to the listing this was opened from, and
 * the window has nothing further to offer about a lot the instance has already accepted — the
 * composition is entered in the app, not here. A pause to let the result line be read would only be
 * the dismiss step this removes, worn differently, so the close happens the moment the instance
 * answers. The plan and the status line before it stay as what the window falls back to should the
 * close ever not take.
 *
 * A failed save keeps the window up: the error is the reason to still be here, and the form holds
 * the corrections that were typed into it.
 */
async function save(): Promise<void> {
  if (!captured || !profile || busy) return;
  busy = true;
  syncButtons();
  setStatus("Saving…");

  const res = await send({ type: "capture-save", lot: currentLot(), dryRun: false });
  busy = false;
  if (!res.ok) {
    setStatus(res.error, "err");
    showBlocked(res.error);
    syncButtons();
    return;
  }

  showPlan(res.result);
  setStatus(
    res.result.outcome === "refreshed"
      ? `Bid refreshed on the lot in ${res.result.saleName}.`
      : `Lot added to ${res.result.saleName}. Describe what it holds in Stamporama.`,
    "ok"
  );
  // Saved twice in a row would be a refresh of what was just written, which is not what the button
  // reads as. Re-reading the page is how the collector asks for that.
  saveBtn.disabled = true;
  recheckBtn.disabled = false;
  window.close();
}

recheckBtn.addEventListener("click", () => void readPage());
sellerEl.addEventListener("change", () => void preview());

// Escape closes the window, exactly as it does in the match window: this has no address bar and no
// close keystroke of its own worth reaching for, and it is opened from a listing the collector is
// going back to. Nothing is lost — a saved lot reached the instance the moment it was saved, and
// everything else on screen is what the page says, read again on the next click of the icon.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.close();
});

void (async () => {
  await refreshProfile();
  await readPage();
})();
