import {
  assignProfileColors,
  getProfileStore,
  profileSubtitle,
  profileTarget,
  setActiveProfileId,
  type Profile,
} from "../core/profile";
import { findModuleForUrl } from "../platform/modules";
import type {
  BackgroundRequest,
  CachedResultsResponse,
  ConfirmResponse,
  ExtractResponse,
  MatchResponse,
} from "../core/messages";
import type { ExtractedItem } from "../platform/types";
import type { Candidate, MatchResult } from "../core/decisions";

// Popup controller. On open it detects whether the active tab is a page one of our platform modules
// handles and extracts it straight away — the user only sees "Found N stamps" and decides whether to
// match. Nothing reaches the instance until Match (a dry-run preview), and nothing is written until
// an in-popup confirm that names the active profile.
//
// Results are grouped so the noisy majority (nothing of ours on the page, or already linked) folds
// away and only what needs a decision stays in view.

/** Items per match request — keeps payloads sane and makes the progress bar meaningful. */
const BATCH_SIZE = 25;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const badge = $("badge");
const badgeName = $("badgeName");
const badgeUrl = $("badgeUrl");
const profileSelect = $<HTMLSelectElement>("profileSelect");
const scanEl = $("scan");
const foundEl = $("found");
const statusEl = $("status");
const chipsEl = $("chips");
const resultsEl = $("results");
const progressEl = $("progress");
const barEl = $("bar");
const writeAutoBtn = $<HTMLButtonElement>("writeAuto");
const overlay = $("overlay");
const confirmMsg = $("confirmMsg");
const confirmOk = $<HTMLButtonElement>("confirmOk");
const confirmCancel = $<HTMLButtonElement>("confirmCancel");

let profile: Profile | null = null;
let items: ExtractedItem[] = [];
let results: MatchResult[] = [];
let busy = false;
/** Bumped on every profile switch, so a match still in flight for the previous target is discarded. */
let generation = 0;

// The page we operate on. The service worker passes the source tab's id when it opens this window;
// we must not fall back to "active tab in the current window", because in a separate window that is
// this UI itself. (The query fallback only applies if the page is ever hosted as a toolbar popup.)
const sourceTabId = (() => {
  const raw = new URLSearchParams(location.search).get("tabId");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
})();

async function targetTab(): Promise<chrome.tabs.Tab | null> {
  if (sourceTabId !== null) {
    try {
      return await chrome.tabs.get(sourceTabId);
    } catch {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ── Stamp photos ─────────────────────────────────────────────────────────────
// The serving route is collection-scoped and token-authorized, and an <img src> cannot carry an
// Authorization header (and a token does not belong in a URL). So the bytes are fetched here with
// the header and handed to the <img> as an object URL, once per photo.

const photoUrls = new Map<string, string | null>();

async function loadStampPhoto(photoId: string): Promise<string | null> {
  const cached = photoUrls.get(photoId);
  if (cached !== undefined) return cached;
  if (!profile) return null;
  try {
    const base = profile.apiBaseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/api/collections/${profile.collectionId}/photos/${photoId}/thumb`, {
      headers: { Authorization: `Bearer ${profile.token}` },
    });
    const url = res.ok ? URL.createObjectURL(await res.blob()) : null;
    photoUrls.set(photoId, url);
    return url;
  } catch {
    photoUrls.set(photoId, null);
    return null;
  }
}

/** Fill in the stamp thumbnails left as placeholders by the last render. */
function hydrateStampPhotos(): void {
  resultsEl.querySelectorAll<HTMLImageElement>("img[data-photo]").forEach((img) => {
    const photoId = img.dataset.photo;
    if (!photoId) return;
    void loadStampPhoto(photoId).then((url) => {
      if (url) img.src = url;
      else img.remove();
    });
  });
}

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("err", isError);
}

function sendToBackground<R>(msg: BackgroundRequest): Promise<R> {
  return chrome.runtime.sendMessage(msg) as Promise<R>;
}

// ── In-popup confirmation ────────────────────────────────────────────────────
// Native confirm() is unreliable inside an MV3 popup (it can dismiss the popup), so the confirm is
// rendered in-page. Always names the target profile + instance before any write.

let resolveConfirm: ((ok: boolean) => void) | null = null;

function askConfirm(bodyHtml: string): Promise<boolean> {
  confirmMsg.innerHTML = bodyHtml;
  overlay.hidden = false;
  confirmOk.focus();
  return new Promise((resolve) => {
    resolveConfirm = resolve;
  });
}

function closeConfirm(ok: boolean): void {
  overlay.hidden = true;
  const r = resolveConfirm;
  resolveConfirm = null;
  r?.(ok);
}

confirmOk.addEventListener("click", () => closeConfirm(true));
confirmCancel.addEventListener("click", () => closeConfirm(false));
// Escape cancels. Enter is left to the focused button's native activation (Confirm is focused on
// open), so tabbing to Cancel and pressing Enter cancels rather than writing.
document.addEventListener("keydown", (e) => {
  if (!overlay.hidden && e.key === "Escape") closeConfirm(false);
});

/** The "you are about to write to X" line shared by every write confirm. */
function targetLine(): string {
  return `<div>Target: <span class="target">${esc(profile?.name ?? "?")}</span></div>` +
    `<div class="target" style="font-weight:400;color:var(--muted);font-size:11px">${esc(
      profile ? profileSubtitle(profile) : ""
    )}</div>`;
}

// ── Profile badge + selector ─────────────────────────────────────────────────
// The badge names the active target and wears its colour, and the selector beside it switches target
// without leaving the window. Switching is a real re-point: results from the previous instance are
// dropped and the page is matched again, so what is on screen always belongs to what the badge says.

/** False right after a switch: the background's per-tab cache was computed for the previous target. */
let mayUseCachedResults = true;
/** Set once the initial load has read the profile, so storage events can't race the first render. */
let ready = false;

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

/** Everything on screen belongs to the old target — drop it, then match the page against the new one. */
async function switchTarget(): Promise<void> {
  for (const url of photoUrls.values()) if (url) URL.revokeObjectURL(url);
  photoUrls.clear();
  results = [];
  picks = [];
  resultsEl.replaceChildren();
  chipsEl.hidden = true;
  setStatus("");
  mayUseCachedResults = false;
  generation++;
  await refreshProfile();
  await scanAndMatch();
}

profileSelect.addEventListener("change", () => {
  // Persist only: the storage listener below drives the re-match, so switching from here and
  // switching from the Options page take exactly the same path.
  void setActiveProfileId(profileSelect.value);
});

$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

// Options may be open in another tab; a profile edited, deleted, or activated there must not leave
// this window describing a target it is no longer pointed at.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!ready) return; // the first read may itself migrate #253's key, which writes both keys
  if (!("activeProfileId" in changes) && !("profiles" in changes)) return;
  void (async () => {
    const previous = profile;
    const { profiles, activeProfileId } = await getProfileStore();
    const next = profiles.find((p) => p.id === activeProfileId) ?? null;
    // A rename only redraws the badge; anything that changes where or how we call re-runs the match.
    const sameTarget =
      next !== null &&
      previous !== null &&
      next.id === previous.id &&
      profileTarget(next) === profileTarget(previous) &&
      next.token === previous.token;
    if (sameTarget) {
      await refreshProfile();
      return;
    }
    await switchTarget();
  })();
});

function pendingAutoCount(): number {
  return results.filter((r) => r.status === "auto" && !r.written && !r.alreadySet).length;
}

function syncButtons(): void {
  const pending = pendingAutoCount();
  writeAutoBtn.disabled = busy || pending === 0 || !profile;
  writeAutoBtn.textContent = pending > 0 ? `Write ${pending} auto-match${pending === 1 ? "" : "es"}` : "Write auto-matches";
}

function setFound(text: string, hasItems: boolean): void {
  foundEl.textContent = text;
  scanEl.classList.toggle("empty", !hasItems);
}

async function scanPage(): Promise<void> {
  items = [];
  results = [];
  resultsEl.innerHTML = "";
  chipsEl.hidden = true;
  setStatus("");
  setFound("Scanning page…", false);
  syncButtons();

  const tab = await targetTab();
  if (!tab?.id || !tab.url) {
    setFound("The page this window was opened from is gone.", false);
    syncButtons();
    return;
  }
  const module = findModuleForUrl(tab.url);
  if (!module) {
    setFound("Not a supported catalog page.", false);
    syncButtons();
    return;
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "extract" })) as ExtractResponse;
    if (!res.ok) {
      setFound(res.error, false);
      syncButtons();
      return;
    }
    items = res.items;
    setFound(
      items.length === 0
        ? `No stamps found on this ${module.name} page.`
        : `Found ${items.length} stamp${items.length === 1 ? "" : "s"} on this ${module.name} page.`,
      items.length > 0
    );
  } catch (e) {
    setFound(e instanceof Error ? e.message : String(e), false);
  }
  syncButtons();
}

// ── Matching (chunked, with progress) ────────────────────────────────────────

function showProgress(done: number, total: number): void {
  progressEl.hidden = false;
  barEl.style.width = `${total === 0 ? 0 : Math.round((done / total) * 100)}%`;
}

function hideProgress(): void {
  progressEl.hidden = true;
  barEl.style.width = "0%";
}

/** Run the whole batch through the matcher in chunks, reporting progress. Null on failure. */
async function runMatch(dryRun: boolean): Promise<MatchResult[] | null> {
  busy = true;
  syncButtons();
  const out: MatchResult[] = [];
  let done = 0;
  showProgress(0, items.length);
  try {
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const slice = items.slice(i, i + BATCH_SIZE);
      const res = await sendToBackground<MatchResponse>({ type: "match", items: slice, dryRun });
      if (!res.ok) {
        setStatus(res.error, true);
        return null;
      }
      out.push(...res.results);
      done += slice.length;
      showProgress(done, items.length);
      setStatus(`${dryRun ? "Matching" : "Writing"} ${done}/${items.length}…`);
    }
    return out;
  } finally {
    busy = false;
    hideProgress();
    syncButtons();
  }
}

function renderChips(): void {
  const auto = results.filter((r) => r.status === "auto" && !r.alreadySet).length;
  const ask = results.filter((r) => r.status === "needs-confirm").length;
  const linked = results.filter((r) => r.status === "auto" && r.alreadySet).length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const parts = [
    auto ? `<span class="chip auto">${auto} auto</span>` : "",
    ask ? `<span class="chip needs">${ask} to confirm</span>` : "",
    linked ? `<span class="chip">${linked} already linked</span>` : "",
    skipped ? `<span class="chip">${skipped} skipped</span>` : "",
  ].filter(Boolean);
  chipsEl.innerHTML = parts.join("");
  chipsEl.hidden = parts.length === 0;
}

async function preview(): Promise<void> {
  if (!profile) {
    setStatus("Set an active profile first.", true);
    return;
  }
  const gen = generation;
  const out = await runMatch(true);
  if (!out || gen !== generation) return; // the target changed while this ran
  results = out;
  render();
  setStatus("Preview only — nothing written.");
}

async function writeAuto(): Promise<void> {
  if (!profile) return;
  const n = pendingAutoCount();
  const ok = await askConfirm(
    `<div>Write <strong>${n}</strong> unambiguous match${n === 1 ? "" : "es"}?</div>${targetLine()}`
  );
  if (!ok) return;
  const out = await runMatch(false);
  if (!out) return;
  results = out;
  render();
  const written = results.filter((r) => r.status === "auto" && r.written).length;
  setStatus(`Wrote ${written} auto-match${written === 1 ? "" : "es"} to ${profile.name}.`);
}

/** Swap one item's result in place after an individual write, so it leaves the to-do list. */
function markWritten(colnectId: string, stamp: Candidate): void {
  const i = results.findIndex((r) => r.colnectId === colnectId);
  if (i === -1) return;
  results[i] = {
    colnectId,
    status: "auto",
    stampId: stamp.stampId,
    written: true,
    alreadySet: false,
    stamp: { ...stamp, existingColnectId: colnectId },
  };
  render();
}

async function confirmOne(colnectId: string, stamp: Candidate, overwrite: boolean): Promise<void> {
  if (!profile) return;
  const src = sourceOf(colnectId);
  const warn = stamp.existingColnectId
    ? `<div class="warnline">This stamp already has Colnect ID ${esc(stamp.existingColnectId)} — it will be replaced.</div>`
    : "";
  const ok = await askConfirm(
    `<div>Link Colnect <strong>#${esc(colnectId)}</strong>${
      src?.name ? ` (${esc(src.name)})` : ""
    } to <strong>${esc(stamp.name || "this stamp")}</strong>?</div>${warn}${targetLine()}`
  );
  if (!ok) return;

  setStatus("Writing…");
  const res = await sendToBackground<ConfirmResponse>({
    type: "confirm",
    colnectId,
    stampId: stamp.stampId,
    allowOverwrite: overwrite,
  });
  if (res.ok) {
    markWritten(colnectId, stamp);
    setStatus(`Linked #${colnectId} → ${stamp.name || stamp.stampId}.`);
    return;
  }
  if (res.conflict) {
    const retryOk = await askConfirm(
      `<div>That stamp already has Colnect ID <strong>${esc(
        res.existingColnectId ?? "?"
      )}</strong>. Overwrite it with <strong>#${esc(colnectId)}</strong>?</div>${targetLine()}`
    );
    if (!retryOk) return;
    const retry = await sendToBackground<ConfirmResponse>({
      type: "confirm",
      colnectId,
      stampId: stamp.stampId,
      allowOverwrite: true,
    });
    if (retry.ok) {
      markWritten(colnectId, stamp);
      setStatus(`Overwrote → #${colnectId}.`);
    } else {
      setStatus(retry.error, true);
    }
    return;
  }
  setStatus(res.error, true);
}

// ── Rendering ────────────────────────────────────────────────────────────────

const REASON_LABEL: Record<string, string> = {
  "multiple-candidates": "several possible stamps",
  "partial-conflict": "partial conflict",
  "existing-different": "already has a different Colnect ID",
  "no-candidates": "no matching stamp",
  "unresolved-refs": "no usable catalog refs",
};

function sourceOf(colnectId: string): ExtractedItem | undefined {
  return items.find((i) => i.platformItemId === colnectId);
}

function refsLine(item: ExtractedItem | undefined): string {
  if (!item || item.catalogRefs.length === 0) return "";
  return `<div class="refs">${esc(item.catalogRefs.map((r) => `${r.catalog}: ${r.number}`).join("  ·  "))}</div>`;
}

/** One of our stamps, with enough detail to tell it from a sibling. */
function stampBlock(c: Candidate, actionIndex?: number): string {
  const meta = [
    c.issuedYear ? String(c.issuedYear) : null,
    c.areaName,
    c.catalogNumbers.length ? `<span class="cat">${esc(c.catalogNumbers.join(", "))}</span>` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const warn = c.existingColnectId
    ? `<div class="warnline">already has Colnect ID ${esc(c.existingColnectId)}</div>`
    : "";
  const issue = c.issueName ? `<div class="issue">${esc(c.issueName)}</div>` : "";
  const btn = actionIndex !== undefined ? `<button class="small" data-pick="${actionIndex}">Use this</button>` : "";
  // Placeholder only — the bytes need an auth header, so hydrateStampPhotos() fills src later.
  const thumb = c.photoId ? `<img class="thumb" data-photo="${esc(c.photoId)}" alt="">` : "";
  return `<div class="stamp">${thumb}<span class="grow"><div class="nm">${esc(c.name || "(unnamed stamp)")}</div>` +
    `${issue}<div class="meta">${meta || "no details"}</div>${warn}</span>${btn}</div>`;
}

/** Click targets for "Use this", indexed so we can hand back the full candidate object. */
let picks: { colnectId: string; stamp: Candidate; overwrite: boolean }[] = [];

function itemCard(r: MatchResult): string {
  const src = sourceOf(r.colnectId);
  const title = esc(src?.name || "(unnamed)");
  let tag: string;
  let match: string;

  if (r.status === "auto") {
    const state = r.alreadySet ? "already linked" : r.written ? "written ✓" : "will write";
    tag = `<span class="tag auto">${state}</span>`;
    match = `<div class="match"><div class="lbl">Matches your stamp</div>${
      r.stamp ? stampBlock(r.stamp) : `<div class="empty">stamp ${esc(r.stampId)}</div>`
    }</div>`;
  } else if (r.status === "needs-confirm") {
    tag = `<span class="tag needs">${esc(REASON_LABEL[r.reason] || r.reason)}</span>`;
    const overwrite = r.reason === "existing-different";
    match = `<div class="match"><div class="lbl">Pick the right stamp</div>${r.candidates
      .map((c) => {
        picks.push({ colnectId: r.colnectId, stamp: c, overwrite });
        return stampBlock(c, picks.length - 1);
      })
      .join("")}</div>`;
  } else {
    tag = `<span class="tag skip">skipped</span>`;
    match = `<div class="match"><div class="empty">${esc(REASON_LABEL[r.reason] || r.reason)}</div></div>`;
  }

  // Prefer the canvas-captured data URL; the raw Colnect URL is a hotlink the site may refuse.
  const picture = src?.imageData ?? src?.imageUrl;
  const thumb = picture ? `<img class="thumb" src="${esc(picture)}" alt="">` : "";

  // The Colnect thumbnail sits at the *end* of its column and the stamp photo at the start of the
  // next, so in the two-column layout the two pictures meet in the middle — image beside image.
  return `<div class="item"><div class="src"><div class="head"><span class="title">${title}</span>${tag}</div>` +
    `<div class="srcrow"><span class="grow"><div class="id">Colnect #${esc(r.colnectId)}</div>${refsLine(
      src
    )}</span>${thumb}</div></div>${match}</div>`;
}

function section(title: string, rows: MatchResult[], collapsed: boolean): string {
  if (rows.length === 0) return "";
  const body = rows.map(itemCard).join("");
  return collapsed
    ? `<details class="sec"><summary>${esc(title)} (${rows.length})</summary>${body}</details>`
    : `<div class="sec"><div class="hdr">${esc(title)} (${rows.length})</div>${body}</div>`;
}

function render(): void {
  picks = [];
  const needsConfirm = results.filter((r) => r.status === "needs-confirm");
  const willWrite = results.filter((r) => r.status === "auto" && !r.alreadySet && !r.written);
  const done = results.filter((r) => r.status === "auto" && (r.alreadySet || r.written));
  const skipped = results.filter((r) => r.status === "skipped");

  resultsEl.innerHTML =
    section("Needs your decision", needsConfirm, false) +
    section("Will link automatically", willWrite, false) +
    section("Already linked", done, true) +
    section("Skipped", skipped, true);

  resultsEl.querySelectorAll<HTMLButtonElement>("button[data-pick]").forEach((btn) => {
    const pick = picks[Number(btn.dataset.pick)];
    btn.addEventListener("click", () => confirmOne(pick.colnectId, pick.stamp, pick.overwrite));
  });

  renderChips();
  syncButtons();
  hydrateStampPhotos();
}

/**
 * Scan the page and, when there is something to match and a profile to match against, run the
 * dry-run immediately — the user lands on the decisions without clicking. This is read-only: the
 * matcher only computes, and every write still goes through an explicit in-window confirm.
 *
 * This runs once per window load, and again whenever the active profile changes. There is
 * deliberately no rescan/re-match button: clicking the toolbar icon re-points and reloads this
 * window, which re-runs the whole thing.
 */
async function scanAndMatch(): Promise<void> {
  const gen = generation;
  await scanPage();
  if (items.length === 0 || !profile || gen !== generation) return;

  // The page was very likely already matched as it loaded (#283); reuse that instead of running the
  // whole batch again, so the window opens instantly. Never after a profile switch, though — that
  // cache describes the instance we just left.
  if (sourceTabId !== null && mayUseCachedResults) {
    const cached = (await chrome.runtime.sendMessage({
      type: "cached-results",
      tabId: sourceTabId,
    })) as CachedResultsResponse;
    // Only reuse a cache that covers exactly what the page shows now — the page may have grown
    // (lazy-loaded cards) since it was matched, and a partial list would read as the whole truth.
    const ids = new Set(items.map((i) => i.platformItemId));
    if (
      gen === generation &&
      cached?.results?.length === items.length &&
      cached.results.every((r) => ids.has(r.colnectId))
    ) {
      results = cached.results;
      render();
      setStatus("Preview only — nothing written.");
      return;
    }
  }

  await preview();
}

writeAutoBtn.addEventListener("click", writeAuto);

void (async () => {
  await refreshProfile();
  ready = true;
  await scanAndMatch();
})();
