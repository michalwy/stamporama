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
  OverwriteNumberResponse,
} from "../core/messages";
import {
  CATALOG_BACKFILL,
  getCatalogBackfill,
  getShowLinkedDecisions,
  setCatalogBackfill,
  setShowLinkedDecisions,
} from "../core/settings";
import type { ExtractedItem } from "../platform/types";
import { isAlreadyLinkedElsewhere } from "../core/decisions";
import type { BackfillProposal, Candidate, MatchResult, RefView } from "../core/decisions";

// Popup controller. On open it detects whether the active tab is a page one of our platform modules
// handles and extracts it straight away — the user only sees "Found N stamps" and decides whether to
// match. Nothing reaches the instance until Match (a dry-run preview), and the writes that are
// genuinely a decision — linking one ambiguous candidate, overwriting a catalog number we hold —
// go through an in-popup confirm that names the active profile. Writing the unambiguous matches
// does not (#515): see `writeAuto`.
//
// Results are grouped so the noisy majority (nothing of ours on the page, or already linked) folds
// away and only what needs a decision stays in view.

/** Items per match request — keeps payloads sane and makes the progress bar meaningful. */
const BATCH_SIZE = 25;

/** How long the result line stays up before the window closes itself after a batch write (#515) —
 * long enough to read "Wrote 8 auto-matches", short enough not to be a step of its own. */
const CLOSE_AFTER_WRITE_MS = 1200;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const badge = $("badge");
const badgeName = $("badgeName");
const badgeUrl = $("badgeUrl");
const profileSelect = $<HTMLSelectElement>("profileSelect");
const scanEl = $("scan");
const foundEl = $("found");
const statusEl = $("status");
const chipsEl = $("chips");
const legendEl = $("legend");
const resultsEl = $("results");
const progressEl = $("progress");
const barEl = $("bar");
const writeAutoBtn = $<HTMLButtonElement>("writeAuto");
const backfillEl = $<HTMLInputElement>("backfill");
const showLinkedOptEl = $("showLinkedOpt");
const showLinkedEl = $<HTMLInputElement>("showLinked");
const showLinkedLabelEl = $("showLinkedLabel");
const overlay = $("overlay");
const confirmMsg = $("confirmMsg");
const confirmOk = $<HTMLButtonElement>("confirmOk");
const confirmCancel = $<HTMLButtonElement>("confirmCancel");

let profile: Profile | null = null;
let items: ExtractedItem[] = [];
let results: MatchResult[] = [];
let busy = false;
/** #305 — whether decisions whose every candidate is already linked stay in the list. */
let showLinked = false;
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
// rendered in-page. Always names the target profile + instance, and is raised for the writes that
// are a decision rather than for every write (#515).

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
//
// With nothing to cancel it closes the Assistant itself. The window has no address bar and no close
// keystroke of its own worth reaching for, and it is opened from a page the collector is returning
// to — Escape is the gesture they already have in hand for "I am done here". It never discards work:
// every write went to the instance the moment it was confirmed, and the scan is redone on the next
// icon click anyway.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!overlay.hidden) closeConfirm(false);
  else window.close();
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
  // The backfill setting is also editable in Options; keep this window's toggle and preview honest.
  if (CATALOG_BACKFILL in changes) {
    void (async () => {
      const enabled = await getCatalogBackfill();
      if (enabled === backfillEl.checked) return; // our own write
      backfillEl.checked = enabled;
      if (items.length > 0 && profile) await preview();
    })();
  }
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

/**
 * Catalog numbers the pending write would add (#280). Already-linked stamps count too: the backfill
 * applies to every confidently matched stamp, so a page matched months ago can still gain numbers
 * Colnect has published since.
 */
function fillsOf(r: MatchResult): number {
  if (r.status !== "auto" || r.written) return 0;
  return r.stamp?.backfill.filter((p) => p.status === "would-fill").length ?? 0;
}

function pendingFillCount(): number {
  return results.reduce((n, r) => n + fillsOf(r), 0);
}

function syncButtons(): void {
  const pending = pendingAutoCount();
  const fills = pendingFillCount();
  writeAutoBtn.disabled = busy || (pending === 0 && fills === 0) || !profile;
  const parts = [
    pending > 0 ? `${pending} auto-match${pending === 1 ? "" : "es"}` : "",
    fills > 0 ? `${fills} catalog number${fills === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  writeAutoBtn.textContent = parts.length ? `Write ${parts.join(" + ")}` : "Write auto-matches";
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
  // Counts what the list shows: with the already-linked decisions folded away (#305), a chip that
  // still counted them would send you looking for rows that aren't there.
  const ask = results.filter(
    (r) => r.status === "needs-confirm" && (showLinked || !isAlreadyLinkedElsewhere(r))
  ).length;
  const linked = results.filter((r) => r.status === "auto" && r.alreadySet).length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const fills = pendingFillCount();
  const parts = [
    auto ? `<span class="chip auto">${auto} auto</span>` : "",
    ask ? `<span class="chip needs">${ask} to confirm</span>` : "",
    fills ? `<span class="chip auto">${fills} number${fills === 1 ? "" : "s"} to add</span>` : "",
    linked ? `<span class="chip">${linked} already linked</span>` : "",
    skipped ? `<span class="chip">${skipped} skipped</span>` : "",
  ].filter(Boolean);
  chipsEl.innerHTML = parts.join("");
  chipsEl.hidden = parts.length === 0;
  // The colour key only means anything once there are marked numbers on screen.
  legendEl.hidden = results.length === 0;
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

/**
 * Write every unambiguous match, then close the window (#515).
 *
 * **No confirmation.** The button already reads `Write 8 auto-matches + 3 catalog numbers` and names
 * the target in the badge above it, so the overlay only restated the label that was just clicked —
 * a keystroke, not a decision. An auto-match is by definition the one the matcher had no doubt
 * about, and the backfill never changes a number we already hold. The two writes that *are*
 * decisions keep their confirm: `confirmOne` names the one stamp it links, and `overwriteOne`
 * destroys a number of ours.
 *
 * **Then the window closes.** A batch write is the last thing done here — the collector is going
 * back to the page it was opened from — and after a short pause, so the result line is readable.
 * Nothing is lost by closing: the write landed on the instance, and the next icon click rescans.
 */
async function writeAuto(): Promise<void> {
  if (!profile) return;
  const out = await runMatch(false);
  if (!out) return;
  results = out;
  render();
  const written = results.filter((r) => r.status === "auto" && r.written).length;
  const filled = results.reduce(
    (acc, r) =>
      acc + (r.status === "auto" ? (r.stamp?.backfill.filter((p) => p.status === "filled").length ?? 0) : 0),
    0
  );
  setStatus(
    `Wrote ${written} auto-match${written === 1 ? "" : "es"}${
      filled ? ` and ${filled} catalog number${filled === 1 ? "" : "s"}` : ""
    } to ${profile.name}.`
  );
  window.setTimeout(() => window.close(), CLOSE_AFTER_WRITE_MS);
}

/** Swap one item's result in place after an individual write, so it leaves the to-do list. */
function markWritten(colnectId: string, stamp: Candidate, backfill: BackfillProposal[]): void {
  const i = results.findIndex((r) => r.colnectId === colnectId);
  if (i === -1) return;
  results[i] = {
    colnectId,
    status: "auto",
    stampId: stamp.stampId,
    written: true,
    alreadySet: false,
    // The server reports what it actually filled; before a write we only had proposals.
    stamp: { ...stamp, backfill, existingColnectId: colnectId },
    // The refs keep their classification: it described this stamp, which is the one just linked.
    refs: results[i].refs,
  };
  render();
}

async function confirmOne(colnectId: string, stamp: Candidate, overwrite: boolean): Promise<void> {
  if (!profile) return;
  const src = sourceOf(colnectId);
  const warn = stamp.existingColnectId
    ? `<div class="warnline">This stamp already has Colnect ID ${esc(stamp.existingColnectId)} — it will be replaced.</div>`
    : "";
  const fills = stamp.backfill.filter((p) => p.status === "would-fill");
  const fillLine = fills.length
    ? `<div>Also adds ${fills.map((p) => `<strong>${esc(p.label)}</strong>`).join(", ")}.</div>`
    : "";
  const ok = await askConfirm(
    `<div>Link Colnect <strong>#${esc(colnectId)}</strong>${
      src?.name ? ` (${esc(src.name)})` : ""
    } to <strong>${esc(stamp.name || "this stamp")}</strong>?</div>${fillLine}${warn}${targetLine()}`
  );
  if (!ok) return;

  setStatus("Writing…");
  const res = await sendToBackground<ConfirmResponse>({
    type: "confirm",
    colnectId,
    stampId: stamp.stampId,
    allowOverwrite: overwrite,
    catalogRefs: src?.catalogRefs,
  });
  if (res.ok) {
    markWritten(colnectId, stamp, res.backfill);
    const filled = res.backfill.filter((p) => p.status === "filled").length;
    setStatus(
      `Linked #${colnectId} → ${stamp.name || stamp.stampId}${
        filled ? `, added ${filled} catalog number${filled === 1 ? "" : "s"}` : ""
      }.`
    );
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
      catalogRefs: src?.catalogRefs,
    });
    if (retry.ok) {
      markWritten(colnectId, stamp, retry.backfill);
      setStatus(`Overwrote → #${colnectId}.`);
    } else {
      setStatus(retry.error, true);
    }
    return;
  }
  setStatus(res.error, true);
}

/**
 * Take Colnect's number for one catalog our stamp disagrees on (#433). Deliberately separate from
 * confirming the match: linking an item and rewriting a number we already hold are two different
 * claims, and only this one destroys something — so it is confirmed on its own, naming both values.
 */
async function overwriteOne(pick: OverwritePick): Promise<void> {
  if (!profile) return;
  const { stamp, proposal } = pick;
  const number = proposal.overwriteNumber;
  if (!number) return;
  const from = proposal.label;
  const to = proposal.overwriteLabel ?? proposal.printedNumber;
  const ok = await askConfirm(
    `<div>Replace <strong>${esc(from)}</strong> on <strong>${esc(
      stamp.name || "this stamp"
    )}</strong> with Colnect's <strong>${esc(to)}</strong>?</div>` +
      `<div class="warnline">Your current number is overwritten.</div>${targetLine()}`
  );
  if (!ok) return;

  setStatus("Writing…");
  const res = await sendToBackground<OverwriteNumberResponse>({
    type: "overwrite-number",
    stampId: stamp.stampId,
    catalogVendorId: proposal.catalogVendorId,
    number,
  });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  applyOverwrite(pick, res.label);
  render();
  const dupe = res.duplicateStampNames?.length
    ? ` — also on ${res.duplicateStampNames.join(", ")}`
    : "";
  setStatus(`${from} → ${res.label}${dupe}.`);
}

/**
 * Fold a written overwrite into what is on screen. The two sides were marked as disagreeing over
 * this catalog, and after the write they hold the same number — so both marks are corrected, rather
 * than leaving a conflict on display that no longer exists. The objects belong to `results`, so the
 * next render reads the new state without a re-match.
 */
function applyOverwrite(pick: OverwritePick, label: string): void {
  const { stamp, proposal, refs } = pick;
  const mine = stamp.catalogNumbers.find((n) => n.label === proposal.label);
  if (mine) {
    mine.label = label;
    mine.status = "matched";
  }
  const ref = refs.find(
    (r) => r.catalog === proposal.catalog && r.number === proposal.printedNumber
  );
  if (ref) ref.status = "matched";
  proposal.status = "filled";
  proposal.number = proposal.overwriteNumber ?? null;
  proposal.label = label;
  proposal.overwriteNumber = null;
  delete proposal.existingNumber;
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

// Both columns render through the same skeleton — label, then a row of picture + the same four
// lines (name / sub / catalog numbers / meta) — so a Colnect item and the stamp it resolved to can
// be read across, line against line. Only the picture's side differs: the Colnect one sits at the
// end of its column and the stamp's at the start of the next, so the two images meet in the middle.

interface SideLines {
  name: string;
  /** Second line: the Colnect id on one side, the issue name on the other. */
  sub?: string;
  /** Third line: catalog numbers, already escaped and marked up. */
  cats?: string;
  /** Fourth line: year · area, warnings. */
  meta?: string;
}

function sideBody(
  lines: SideLines,
  thumb: string,
  opts: { mirror?: boolean; action?: string; label?: string } = {}
): string {
  // The label sits inside the text column, beside the picture rather than above it, so the picture
  // gets the full height of the row.
  const text =
    `<span class="grow">` +
    `${opts.label ? `<div class="lbl">${opts.label}</div>` : ""}` +
    `<div class="nm">${lines.name}</div>` +
    `${lines.sub ? `<div class="sub">${lines.sub}</div>` : ""}` +
    `${lines.cats ? `<div class="cats">${lines.cats}</div>` : ""}` +
    `${lines.meta ? `<div class="meta">${lines.meta}</div>` : ""}</span>`;
  const inner = opts.mirror ? `${text}${thumb}` : `${thumb}${text}`;
  return `<div class="body">${inner}${opts.action ?? ""}</div>`;
}

const REF_TITLE: Record<string, string> = {
  matched: "Matches your stamp — this is what the match was made on",
  missing: "You keep this catalog, but your stamp has no number for it",
  conflict: "Your stamp has a different number in this catalog",
  unmapped: "No catalog of yours corresponds to this one",
  unknown: "Not comparable until a single stamp is chosen",
};

/** The Colnect refs, each marked with what it means for us. */
function refsMarkup(refs: RefView[] | undefined, fallback: ExtractedItem | undefined): string {
  if (refs?.length) {
    return refs
      .map(
        (r) =>
          `<span class="ref ${r.status}" title="${esc(REF_TITLE[r.status] ?? "")}">${esc(
            `${r.catalog}: ${r.number}`
          )}</span>`
      )
      .join(" ");
  }
  // Before a match has run we only have what the page printed, with nothing to compare it to.
  if (!fallback?.catalogRefs.length) return "";
  return fallback.catalogRefs
    .map((r) => `<span class="ref unknown">${esc(`${r.catalog}: ${r.number}`)}</span>`)
    .join(" ");
}

/** A column with a label but nothing to show under it — keeps the two sides' labels on one line. */
function labelledNote(label: string, note: string): string {
  return `<div class="body"><span class="grow"><div class="lbl">${esc(
    label
  )}</div><div class="empty">${note}</div></span></div>`;
}

const MINE_TITLE: Record<string, string> = {
  matched: "Colnect prints this same number — this is what the match was made on",
  conflict: "Colnect prints a different number in this catalog",
  "only-mine": "Colnect doesn't list this catalog for the item",
};

// ── Backfill (#280) ──────────────────────────────────────────────────────────
// Under the stamp's own numbers: what the Colnect item would add to it, and — in one muted line —
// what it offered that we deliberately won't write.

const FILL_TITLE: Record<string, string> = {
  "would-fill": "Missing from your stamp — will be added, with the area prefix stripped",
  filled: "Added to your stamp",
};

/** Why a printed number is not being written, phrased for the person reading it. */
function noFillReason(p: BackfillProposal): string {
  switch (p.status) {
    case "conflict":
      return `you have ${p.label}`;
    case "skipped-no-area-prefix":
      return "your area sets no prefix for this catalog";
    case "prefix-mismatch":
      return "a different country prefix than your area's";
    case "duplicate":
      return `already on ${(p.duplicateStampNames ?? []).join(", ") || "another stamp"}`;
    default:
      return "";
  }
}

/** Whether a conflict can be settled in Colnect's favour here (#433): the disagreement is still
 *  open, and the printed value resolved to a number we would actually store. */
function isResolvableConflict(p: BackfillProposal): boolean {
  return p.status === "conflict" && !!p.overwriteNumber;
}

function backfillMarkup(proposals: BackfillProposal[], resolvable: boolean): string {
  if (proposals.length === 0) return "";
  const fills = proposals.filter((p) => p.status === "would-fill" || p.status === "filled");
  const fixable = resolvable ? proposals.filter(isResolvableConflict) : [];
  const rest = proposals.filter(
    (p) => p.status !== "would-fill" && p.status !== "filled" && !fixable.includes(p)
  );

  const chips = fills.length
    ? `<div class="fills">${fills
        .map((p) => {
          const dupe = p.duplicateWarning
            ? ` — also on ${(p.duplicateStampNames ?? []).join(", ")}`
            : "";
          return `<span class="ref fill${p.status === "filled" ? " done" : ""}" title="${esc(
            (FILL_TITLE[p.status] ?? "") + dupe
          )}">${esc(`${p.status === "filled" ? "✓ " : "+ "}${p.label}`)}</span>`;
        })
        .join(" ")}</div>`
    : "";

  const skipped = rest.length
    ? `<div class="nofill">not added: ${rest
        .map((p) => esc(`${p.catalog} ${p.printedNumber} (${noFillReason(p)})`))
        .join(", ")}</div>`
    : "";

  // Each disagreement gets its own line and its own button: they are settled one field at a time,
  // and which catalog is being corrected has to be readable without opening anything.
  const fixes = fixable
    .map((p) => {
      overwrites.push(p);
      return (
        `<div class="fix"><span class="ref conflict">${esc(p.label)}</span>` +
        `<span class="arrow">→</span><span class="ref missing">${esc(
          p.overwriteLabel ?? p.printedNumber
        )}</span>` +
        `<button class="small" data-overwrite="${overwrites.length - 1}" title="${esc(
          `Replace ${p.label} with the number Colnect prints. Your current number is overwritten.`
        )}">Use Colnect's</button></div>`
      );
    })
    .join("");

  return `${chips}${fixes}${skipped}`;
}

/** One of our stamps, with enough detail to tell it from a sibling. */
function stampBlock(
  c: Candidate,
  label: string,
  opts: { actionIndex?: number; resolveConflicts?: boolean } = {}
): string {
  const { actionIndex, resolveConflicts = false } = opts;
  const meta = [c.issuedYear ? String(c.issuedYear) : null, c.areaName].filter(Boolean).join(" · ");
  const warn = c.existingColnectId
    ? `<div class="warnline">already has Colnect ID ${esc(c.existingColnectId)}</div>`
    : "";
  const action =
    actionIndex !== undefined ? `<button class="small" data-pick="${actionIndex}">Use this</button>` : "";
  // Placeholder only — the bytes need an auth header, so hydrateStampPhotos() fills src later.
  const thumb = c.photoId
    ? `<img class="thumb" data-photo="${esc(c.photoId)}" alt="">`
    : `<span class="thumb thumb--none"></span>`;
  return sideBody(
    {
      name: esc(c.name || "(unnamed stamp)"),
      sub: c.issueName ? `<em>${esc(c.issueName)}</em>` : undefined,
      cats: c.catalogNumbers.length
        ? c.catalogNumbers
            .map(
              (n) =>
                `<span class="ref ${n.status}" title="${esc(MINE_TITLE[n.status] ?? "")}">${esc(
                  n.label
                )}</span>`
            )
            .join(" ")
        : undefined,
      meta: [backfillMarkup(c.backfill, resolveConflicts), meta, warn].filter(Boolean).join(""),
    },
    thumb,
    { action, label: esc(label) }
  );
}

/** Click targets for "Use this", indexed so we can hand back the full candidate object. */
let picks: { colnectId: string; stamp: Candidate; overwrite: boolean }[] = [];

/**
 * Click targets for "Use Colnect's number" (#433). Filled while a card renders, so a proposal is
 * registered exactly where its button is drawn; the stamp and the item's own refs are attached when
 * the card is built, since a proposal alone doesn't know which stamp it landed on.
 */
interface OverwritePick {
  stamp: Candidate;
  proposal: BackfillProposal;
  refs: RefView[];
}
let overwrites: BackfillProposal[] = [];
let overwritePicks: OverwritePick[] = [];

/**
 * Turn the proposals registered while one card rendered into full click targets. Rendering a card
 * cannot do this itself — `backfillMarkup` is handed proposals, not the stamp or the item — so the
 * card closes the loop for whatever its own stamp block just pushed.
 */
function claimOverwrites(from: number, stamp: Candidate, refs: RefView[]): void {
  for (let i = from; i < overwrites.length; i++) {
    overwritePicks[i] = { stamp, proposal: overwrites[i], refs };
  }
}

function itemCard(r: MatchResult): string {
  const src = sourceOf(r.colnectId);
  let tag: string;
  let matchLabel: string;
  let matchBody: string;

  // Which rows may settle a catalog-number disagreement (#433): the ones that name a single stamp.
  // A row still offering several candidates has not said which stamp this item is, and correcting a
  // number on the wrong sibling is a change nobody would think to look for.
  const resolveConflicts = r.status === "auto" || (r.status === "needs-confirm" && r.candidates.length === 1);

  if (r.status === "auto") {
    const state = r.alreadySet ? "already linked" : r.written ? "written ✓" : "will write";
    tag = `<span class="tag auto">${state}</span>`;
    matchLabel = "Your stamp";
    const from = overwrites.length;
    matchBody = r.stamp
      ? stampBlock(r.stamp, matchLabel, { resolveConflicts })
      : labelledNote(matchLabel, `stamp ${esc(r.stampId)}`);
    if (r.stamp) claimOverwrites(from, r.stamp, r.refs);
  } else if (r.status === "needs-confirm") {
    tag = `<span class="tag needs">${esc(REASON_LABEL[r.reason] || r.reason)}</span>`;
    matchLabel = r.candidates.length > 1 ? "Pick the right stamp" : "Your stamp";
    const overwrite = r.reason === "existing-different";
    matchBody = r.candidates
      .map((c) => {
        picks.push({ colnectId: r.colnectId, stamp: c, overwrite });
        const from = overwrites.length;
        const block = stampBlock(c, matchLabel, { actionIndex: picks.length - 1, resolveConflicts });
        claimOverwrites(from, c, r.refs);
        return block;
      })
      .join("");
  } else {
    tag = `<span class="tag skip">skipped</span>`;
    matchLabel = "No match";
    matchBody = labelledNote(matchLabel, esc(REASON_LABEL[r.reason] || r.reason));
  }

  // Prefer the canvas-captured data URL; the raw Colnect URL is a hotlink the site may refuse.
  const picture = src?.imageData ?? src?.imageUrl;
  const thumb = picture
    ? `<img class="thumb" src="${esc(picture)}" alt="">`
    : `<span class="thumb thumb--none"></span>`;

  // Same field order as our side: name / (issue — Colnect has no counterpart) / numbers / year·area.
  const colnect =
    `<div class="side src">` +
    sideBody(
      {
        name: esc(src?.name || "(unnamed)"),
        cats: refsMarkup(r.refs, src),
        meta: [src?.issuedYear ? String(src.issuedYear) : null, src?.country]
          .filter(Boolean)
          .map((v) => esc(String(v)))
          .join(" · "),
      },
      thumb,
      { mirror: true, label: `Colnect: #${esc(r.colnectId)} ${tag}` }
    ) +
    `</div>`;

  return `<div class="item">${colnect}<div class="side match">${matchBody}</div></div>`;
}

/**
 * One titled group of results. `kind` picks the heading's accent colour, matching the tag colour of
 * the rows underneath. A collapsible section starts folded unless `open` — but stays collapsible,
 * so it can be folded back once its contents have been read.
 */
function section(
  title: string,
  rows: MatchResult[],
  kind: "needs" | "will" | "done" | "skip",
  collapsible: boolean,
  open = false
): string {
  if (rows.length === 0) return "";
  const body = rows.map(itemCard).join("");
  const fills = rows.reduce((n, r) => n + fillsOf(r), 0);
  // Say what a folded section is hiding, so a section worth opening announces itself.
  const heading =
    `<span class="ttl">${esc(title)}</span><span class="cnt">${rows.length}</span>` +
    (fills > 0
      ? `<span class="add">+${fills} catalog number${fills === 1 ? "" : "s"}</span>`
      : "");
  return collapsible
    ? `<details class="sec ${kind}"${open ? " open" : ""}><summary>${heading}</summary>${body}</details>`
    : `<div class="sec ${kind}"><div class="hdr">${heading}</div>${body}</div>`;
}

function render(): void {
  picks = [];
  overwrites = [];
  overwritePicks = [];
  // Decisions already taken elsewhere (#305) leave the list unless asked for. The control lives in
  // the toolbar row rather than in the section heading: with every such row hidden the section is
  // gone, and a toggle inside it would take the only way back with it.
  const linkedElsewhere = results.filter(isAlreadyLinkedElsewhere);
  showLinkedOptEl.hidden = linkedElsewhere.length === 0;
  showLinkedLabelEl.textContent = `Show ${linkedElsewhere.length} already linked elsewhere`;
  const needsConfirm = results.filter(
    (r) => r.status === "needs-confirm" && (showLinked || !isAlreadyLinkedElsewhere(r))
  );
  const willWrite = results.filter((r) => r.status === "auto" && !r.alreadySet && !r.written);
  const done = results.filter((r) => r.status === "auto" && (r.alreadySet || r.written));
  const skipped = results.filter((r) => r.status === "skipped");

  resultsEl.innerHTML =
    section("Needs your decision", needsConfirm, "needs", false) +
    section("Will link automatically", willWrite, "will", false) +
    // "Already linked" normally folds away as noise — but a stamp that is linked *and* still gains
    // catalog numbers (#280) is about to be written to, so that section opens itself.
    section("Already linked", done, "done", true, done.some((r) => fillsOf(r) > 0)) +
    section("Skipped", skipped, "skip", true);

  resultsEl.querySelectorAll<HTMLButtonElement>("button[data-pick]").forEach((btn) => {
    const pick = picks[Number(btn.dataset.pick)];
    btn.addEventListener("click", () => confirmOne(pick.colnectId, pick.stamp, pick.overwrite));
  });

  resultsEl.querySelectorAll<HTMLButtonElement>("button[data-overwrite]").forEach((btn) => {
    const pick = overwritePicks[Number(btn.dataset.overwrite)];
    if (pick) btn.addEventListener("click", () => overwriteOne(pick));
  });

  renderChips();
  syncButtons();
  hydrateStampPhotos();
}

/**
 * Scan the page and, when there is something to match and a profile to match against, run the
 * dry-run immediately — the user lands on the decisions without clicking. This is read-only: the
 * matcher only computes, and every write still needs a button pressed for it.
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

// Toggling the backfill changes what a write would do, so the preview on screen is re-computed
// against the new setting rather than left describing the old one. Still read-only: a dry-run.
backfillEl.addEventListener("change", () => {
  void (async () => {
    await setCatalogBackfill(backfillEl.checked);
    if (items.length > 0 && profile) await preview();
  })();
});

// Purely a view filter over results already in hand — no re-match, so it costs nothing to flip back
// and forth while reading the list.
showLinkedEl.addEventListener("change", () => {
  showLinked = showLinkedEl.checked;
  void setShowLinkedDecisions(showLinked);
  if (results.length > 0) render();
});

void (async () => {
  backfillEl.checked = await getCatalogBackfill();
  showLinked = await getShowLinkedDecisions();
  showLinkedEl.checked = showLinked;
  await refreshProfile();
  ready = true;
  await scanAndMatch();
})();
