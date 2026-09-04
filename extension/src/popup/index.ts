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
  OverwriteAttributesResponse,
  OverwriteDateResponse,
  OverwriteNumberResponse,
  ResultsUpdatedNotice,
} from "../core/messages";
import {
  CATALOG_BACKFILL,
  ISSUE_DATE_SYNC,
  getCatalogBackfill,
  getIssueDateSync,
  getShowLinkedDecisions,
  setCatalogBackfill,
  setIssueDateSync,
  setShowLinkedDecisions,
} from "../core/settings";
import type { ExtractedItem } from "../platform/types";
import { isAlreadyLinkedElsewhere } from "../core/decisions";
import type {
  AttributeProposal,
  BackfillProposal,
  Candidate,
  DateProposal,
  MatchResult,
  RefView,
} from "../core/decisions";

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

/** Match requests in flight at once. A page of 200 stamps is eight chunks, and walking them one at a
 *  time made the window's own first render the slowest thing about it. */
const MATCH_CONCURRENCY = 3;

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
const issueDateEl = $<HTMLInputElement>("issueDate");
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
/** The address `results` describe, so the badge push can be dropped once the tab has moved on. */
let scannedUrl: string | null = null;

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
  resetPicks();
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
  // Both write settings are also editable in Options; keep this window's toggles and preview honest.
  if (CATALOG_BACKFILL in changes) {
    void (async () => {
      const enabled = await getCatalogBackfill();
      if (enabled === backfillEl.checked) return; // our own write
      backfillEl.checked = enabled;
      if (items.length > 0 && profile) await preview();
    })();
  }
  if (ISSUE_DATE_SYNC in changes) {
    void (async () => {
      const enabled = await getIssueDateSync();
      if (enabled === issueDateEl.checked) return; // our own write
      issueDateEl.checked = enabled;
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

/**
 * Date rows the collector has **unticked** (#668), by `colnectId|stampId`.
 *
 * The dates are opt-*out*: every row that has one to write is ticked when it is drawn, and this
 * holds the exceptions. Keyed rather than indexed because the list is rebuilt on every render and an
 * index would move under a tick; keyed on the pair because a `needs-confirm` row draws the same
 * Colnect item against several of our stamps, each with a date question of its own.
 *
 * Deliberately not persisted. It says "not this stamp, on this page, this time" — the standing
 * answer is the **Fill missing issue dates** toggle, which is remembered.
 */
const skippedDates = new Set<string>();

const dateKey = (colnectId: string, stampId: string): string => `${colnectId}|${stampId}`;

const dateTicked = (colnectId: string, stampId: string): boolean =>
  !skippedDates.has(dateKey(colnectId, stampId));

/**
 * Whether the pending write would also date this stamp (#655). Like the catalog fills, an
 * already-linked stamp counts: the date rides on the match being confident, not on the Colnect ID
 * being new, and a stamp linked months ago may still be dated by its issue's year alone.
 *
 * An unticked row (#668) is not pending: the button must not count what it will not write.
 */
function dateFillOf(r: MatchResult): boolean {
  if (r.status !== "auto" || r.written) return false;
  if (r.stamp?.dateProposal?.status !== "would-fill") return false;
  return dateTicked(r.colnectId, r.stampId);
}

function pendingDateCount(): number {
  return results.filter(dateFillOf).length;
}

/**
 * Attribute rows the collector has **unticked** (#739), by `colnectId|stampId|field`.
 *
 * `skippedDates`' rule with one more segment, and the segment is the point: a stamp faces up to six
 * attribute questions at once, and *take the colour but not the perforation* has to be sayable. Not
 * persisted either — the standing answer is the **Fill missing stamp attributes** toggle.
 */
const skippedAttributes = new Set<string>();

const attrKey = (colnectId: string, stampId: string, field: string): string =>
  `${colnectId}|${stampId}|${field}`;

const attrTicked = (colnectId: string, stampId: string, field: string): boolean =>
  !skippedAttributes.has(attrKey(colnectId, stampId, field));

/** The attribute fills the pending write would make on one row (#739) — the ticked `would-fill`
 *  proposals. Already-linked stamps count, exactly as the numbers and the date do: the fill rides on
 *  the match being confident, not on the Colnect ID being new. */
function attributeFillsOf(r: MatchResult): number {
  if (r.status !== "auto" || r.written) return 0;
  return (r.stamp?.attributes ?? []).filter(
    (p) => p.status === "would-fill" && attrTicked(r.colnectId, r.stampId, p.field)
  ).length;
}

function pendingAttributeCount(): number {
  return results.reduce((n, r) => n + attributeFillsOf(r), 0);
}

/** The attribute **changes** the write would make (#739) — the ticked conflicts, grouped by the
 *  stamp they land on, since one call settles every attribute of one stamp. Registered as the list
 *  renders, so this reads whatever is currently on screen. */
function pendingAttributeChanges(): AttributePick[] {
  const byStamp = new Map<string, AttributePick>();
  for (const pick of attributeOverwritePicks) {
    if (!pick) continue;
    if (!attrTicked(pick.colnectId, pick.stamp.stampId, pick.proposal.field)) continue;
    const key = `${pick.colnectId}|${pick.stamp.stampId}`;
    const seen = byStamp.get(key);
    if (seen) seen.fields[pick.proposal.field] = pick.proposal.colnectLabel;
    else {
      byStamp.set(key, {
        colnectId: pick.colnectId,
        stamp: pick.stamp,
        proposal: pick.proposal,
        fields: { [pick.proposal.field]: pick.proposal.colnectLabel },
      });
    }
  }
  return [...byStamp.values()];
}

/** How many attributes those changes replace, across every stamp — what the confirm names, since a
 *  collector counts fields rather than requests. */
function pendingAttributeChangeCount(): number {
  return pendingAttributeChanges().reduce((n, p) => n + Object.keys(p.fields).length, 0);
}

/**
 * The date **changes** the write would make (#668) — the conflicts still ticked.
 *
 * A different act from the fills above and counted separately, because it is the one that destroys
 * something: a date we already state, replaced by Colnect's. The rows are registered as the list
 * renders, so this reads whatever is currently on screen.
 */
function pendingDateChanges(): DatePick[] {
  return dateOverwritePicks.filter(
    (pick) => pick && dateTicked(pick.colnectId, pick.stamp.stampId)
  );
}

/**
 * The extracted items behind everything the write button offers — the counts `syncButtons` prints,
 * resolved back to what has to be sent. An already-linked decision is in only when it still has
 * numbers or a date to add: re-sending the rest would ask the instance to re-decide a page for
 * nothing.
 */
function pendingWriteItems(): ExtractedItem[] {
  const wanted = new Set(
    results
      .filter(
        (r) =>
          r.status === "auto" &&
          !r.written &&
          (!r.alreadySet || fillsOf(r) > 0 || dateFillOf(r) || attributeFillsOf(r) > 0)
      )
      .map((r) => r.colnectId)
  );
  // A fill the collector unticked (#668) goes without the page's printed date. The instance fills
  // from `issuedOn` and from nothing else, so withholding it *is* "leave this stamp's date alone" —
  // no second flag to add, and nothing else about the item changes. Only a `would-fill` row is
  // stripped: withholding the date on an unticked **disagreement** would take the disagreement off
  // the screen with it, which is not what unticking one says.
  const undated = new Set(
    results
      .filter(
        (r) =>
          r.status === "auto" &&
          r.stamp?.dateProposal?.status === "would-fill" &&
          !dateTicked(r.colnectId, r.stampId)
      )
      .map((r) => r.colnectId)
  );
  // The same withholding, one field at a time (#739): the instance fills an attribute from what the
  // page states and from nothing else, so leaving a value out of `attributes` *is* "leave this
  // attribute of this stamp alone". A `conflict` is never stripped, for the date's own reason — the
  // disagreement would leave the screen with it — and neither is an `unmapped` word, which is
  // reported rather than written anyway.
  const droppedFields = new Map<string, Set<string>>();
  for (const r of results) {
    if (r.status !== "auto" || r.written) continue;
    const skipped = (r.stamp?.attributes ?? []).filter(
      (p) => p.status === "would-fill" && !attrTicked(r.colnectId, r.stampId, p.field)
    );
    if (skipped.length > 0) {
      droppedFields.set(r.colnectId, new Set(skipped.map((p) => p.field)));
    }
  }

  return items
    .filter((i) => wanted.has(i.platformItemId))
    .map((i) => {
      const dropped = droppedFields.get(i.platformItemId);
      if (!undated.has(i.platformItemId) && !dropped) return i;
      const stripped: ExtractedItem = { ...i };
      if (undated.has(i.platformItemId)) delete stripped.issuedOn;
      if (dropped && stripped.attributes) {
        const attributes = { ...stripped.attributes };
        for (const field of dropped) delete attributes[field as keyof typeof attributes];
        stripped.attributes = attributes;
      }
      return stripped;
    });
}

/** Fold the outcome of a partial run into what is on screen, leaving untouched decisions alone. */
function mergeResults(written: MatchResult[]): void {
  const byId = new Map(written.map((r) => [r.colnectId, r]));
  results = results.map((r) => byId.get(r.colnectId) ?? r);
}

function syncButtons(): void {
  const pending = pendingAutoCount();
  const fills = pendingFillCount();
  const dates = pendingDateCount();
  // The ticked disagreements (#668) are counted apart from the fills and named apart in the label:
  // one adds what we lack, the other replaces what we hold, and a single "dates" would hide which.
  const changes = pendingDateChanges().length;
  const attrs = pendingAttributeCount();
  const attrChanges = pendingAttributeChangeCount();
  writeAutoBtn.disabled =
    busy ||
    (pending === 0 &&
      fills === 0 &&
      dates === 0 &&
      changes === 0 &&
      attrs === 0 &&
      attrChanges === 0) ||
    !profile;
  const parts = [
    pending > 0 ? `${pending} auto-match${pending === 1 ? "" : "es"}` : "",
    fills > 0 ? `${fills} catalog number${fills === 1 ? "" : "s"}` : "",
    dates > 0 ? `${dates} date${dates === 1 ? "" : "s"}` : "",
    changes > 0 ? `${changes} date change${changes === 1 ? "" : "s"}` : "",
    // Counted apart from the fills for the dates' own reason (#668): one adds what we state nothing
    // for, the other replaces what we hold, and a single "attributes" would hide which.
    attrs > 0 ? `${attrs} attribute${attrs === 1 ? "" : "s"}` : "",
    attrChanges > 0
      ? `${attrChanges} attribute change${attrChanges === 1 ? "" : "s"}`
      : "",
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
  scannedUrl = null;
  resetPicks();
  // A rescan is a different page: the ticks named stamps on the old one (#668), so the exceptions
  // the collector made there mean nothing here.
  skippedDates.clear();
  skippedAttributes.clear();
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
  scannedUrl = tab.url;

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

/**
 * Run a set of items through the matcher in chunks, reporting progress. Null on failure.
 *
 * Takes what to match rather than reading `items`, because a write is not a match of the page: the
 * preview already decided, and only the decisions still owing a write need to be sent (see
 * `writeAuto`). The results come back in input order regardless of which chunk finished first.
 */
async function runMatch(batch: ExtractedItem[], dryRun: boolean): Promise<MatchResult[] | null> {
  busy = true;
  syncButtons();
  const slices: ExtractedItem[][] = [];
  for (let i = 0; i < batch.length; i += BATCH_SIZE) slices.push(batch.slice(i, i + BATCH_SIZE));
  const out: MatchResult[][] = slices.map(() => []);
  let done = 0;
  let failure: string | null = null;
  let next = 0;
  showProgress(0, batch.length);

  // Chunks are independent — the matcher decides each item on its own — so they need not wait in
  // line. A few at a time: every request is a real query on the instance, and this window is a
  // background errand, not a load test.
  const worker = async (): Promise<void> => {
    for (let i = next++; i < slices.length && failure === null; i = next++) {
      const slice = slices[i];
      const res = await sendToBackground<MatchResponse>({ type: "match", items: slice, dryRun });
      if (!res.ok) {
        failure ??= res.error;
        return;
      }
      out[i] = res.results;
      done += slice.length;
      showProgress(done, batch.length);
      setStatus(`${dryRun ? "Matching" : "Writing"} ${done}/${batch.length}…`);
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(MATCH_CONCURRENCY, slices.length) }, () => worker())
    );
    if (failure !== null) {
      setStatus(failure, true);
      return null;
    }
    return out.flat();
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
  const dates = pendingDateCount();
  const attrs = pendingAttributeCount();
  const unmapped = results.reduce(
    (n, r) =>
      n +
      (r.status === "auto" ? (r.stamp?.attributes ?? []) : []).filter(
        (p) => p.status === "unmapped"
      ).length,
    0
  );
  const parts = [
    auto ? `<span class="chip auto">${auto} auto</span>` : "",
    ask ? `<span class="chip needs">${ask} to confirm</span>` : "",
    fills ? `<span class="chip auto">${fills} number${fills === 1 ? "" : "s"} to add</span>` : "",
    dates ? `<span class="chip auto">${dates} date${dates === 1 ? "" : "s"} to add</span>` : "",
    attrs
      ? `<span class="chip auto">${attrs} attribute${attrs === 1 ? "" : "s"} to add</span>`
      : "",
    // Said even though nothing will be written from it, because it is the one thing on this page
    // that a trip to Settings → Colnect makes go away for good (#739).
    unmapped
      ? `<span class="chip">${unmapped} unmapped Colnect word${unmapped === 1 ? "" : "s"}</span>`
      : "",
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
  const out = await runMatch(items, true);
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
 * **Then the window closes**, the moment the instance answers. A batch write is the last thing done
 * here — the collector is going back to the page it was opened from — and a pause to let the result
 * line be read would only be the dismiss step this replaced, worn differently. Nothing is lost: the
 * write landed on the instance, and the next icon click rescans. The merge and the status line below
 * it stay all the same, as what the window falls back to should the close ever not take.
 *
 * **Only the pending decisions are sent.** A page of 200 stamps holding one unwritten match used to
 * be re-matched whole — the same eight requests the preview had just run, to write one row. The
 * button promises what `syncButtons` counted, so that is exactly what goes: the items behind the
 * pending auto-matches and the pending fills. This concedes nothing to the client, which still only
 * says *which items to consider* — the instance decides each one again and writes nothing it does
 * not rule `auto` itself.
 *
 * **The ticked date changes go with it** (#668). They are a separate write per stamp — a date we
 * hold, replaced by Colnect's — and they are taken first, so the match that follows sees the dates
 * the collector has just settled rather than re-reporting them as disagreements. They are the one
 * thing here that destroys something, so they are the one thing confirmed: once, naming how many
 * dates are about to be replaced, rather than once per row as they used to be.
 */
async function writeAuto(): Promise<void> {
  if (!profile) return;
  const changes = pendingDateChanges();
  const attrChanges = pendingAttributeChanges();
  const attrFields = pendingAttributeChangeCount();
  if (changes.length > 0 || attrChanges.length > 0) {
    // One confirm for both (#668/#739). They are the same act on two kinds of field — what we hold,
    // replaced by what Colnect states — and asking twice for one press of Write would be two
    // overlays in front of one decision.
    const what = [
      changes.length
        ? `the date on <strong>${changes.length} stamp${changes.length === 1 ? "" : "s"}</strong>`
        : "",
      attrFields
        ? `<strong>${attrFields} attribute${attrFields === 1 ? "" : "s"}</strong> on ` +
          `<strong>${attrChanges.length} stamp${attrChanges.length === 1 ? "" : "s"}</strong>`
        : "",
    ].filter(Boolean);
    const ok = await askConfirm(
      `<div>Replace ${what.join(" and ")} with what Colnect states?</div>` +
        `<div class="warnline">What each of them says now is overwritten${
          changes.length ? ", date components Colnect doesn't state included" : ""
        }.</div>${targetLine()}`
    );
    if (!ok) return;
    setStatus("Writing…");
    for (const pick of changes) {
      const res = await sendToBackground<OverwriteDateResponse>({
        type: "overwrite-date",
        stampId: pick.stamp.stampId,
        issuedOn: pick.issuedOn,
      });
      // One failure stops the run rather than pressing on: the rest are the same call to the same
      // instance, and a list of them failing one by one says nothing the first one did not.
      if (!res.ok) {
        render();
        setStatus(res.error, true);
        return;
      }
      applyDateOverwrite(pick, res.label);
    }
    // One call per stamp, carrying every attribute of it the collector ticked — the instance settles
    // them together, and six requests to replace six words on one row would be five round trips
    // nobody asked for.
    for (const pick of attrChanges) {
      const res = await sendToBackground<OverwriteAttributesResponse>({
        type: "overwrite-attributes",
        stampId: pick.stamp.stampId,
        attributes: pick.fields,
      });
      if (!res.ok) {
        render();
        setStatus(res.error, true);
        return;
      }
      applyAttributeOverwrite(pick, res.attributes);
    }
  }

  const batch = pendingWriteItems();
  if (batch.length === 0) {
    // Nothing left to match — the corrections were the whole of it. Report them and go, exactly as a
    // batch write does.
    if (changes.length === 0 && attrChanges.length === 0) return;
    render();
    const done = [
      changes.length ? `${changes.length} date${changes.length === 1 ? "" : "s"}` : "",
      attrFields ? `${attrFields} attribute${attrFields === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    setStatus(`Changed ${done.join(" and ")} on ${profile.name}.`);
    window.close();
    return;
  }
  const out = await runMatch(batch, false);
  if (!out) return;
  mergeResults(out);
  render();
  const written = out.filter((r) => r.status === "auto" && r.written).length;
  const filled = out.reduce(
    (acc, r) =>
      acc + (r.status === "auto" ? (r.stamp?.backfill.filter((p) => p.status === "filled").length ?? 0) : 0),
    0
  );
  const dated = out.filter(
    (r) => r.status === "auto" && r.stamp?.dateProposal?.status === "filled"
  ).length;
  const attributed = out.reduce(
    (acc, r) =>
      acc +
      (r.status === "auto"
        ? (r.stamp?.attributes ?? []).filter((p) => p.status === "filled").length
        : 0),
    0
  );
  const extras = [
    filled ? `${filled} catalog number${filled === 1 ? "" : "s"}` : "",
    dated ? `${dated} date${dated === 1 ? "" : "s"}` : "",
    changes.length ? `${changes.length} date change${changes.length === 1 ? "" : "s"}` : "",
    attributed ? `${attributed} attribute${attributed === 1 ? "" : "s"}` : "",
    attrFields ? `${attrFields} attribute change${attrFields === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  setStatus(
    `Wrote ${written} auto-match${written === 1 ? "" : "es"}${
      extras.length ? ` and ${extras.join(" and ")}` : ""
    } to ${profile.name}.`
  );
  window.close();
}

/** Swap one item's result in place after an individual write, so it leaves the to-do list. */
function markWritten(
  colnectId: string,
  stamp: Candidate,
  backfill: BackfillProposal[],
  dateProposal: DateProposal | null,
  attributes: AttributeProposal[]
): void {
  const i = results.findIndex((r) => r.colnectId === colnectId);
  if (i === -1) return;
  results[i] = {
    colnectId,
    status: "auto",
    stampId: stamp.stampId,
    written: true,
    alreadySet: false,
    // The server reports what it actually filled; before a write we only had proposals.
    stamp: { ...stamp, backfill, dateProposal, attributes, existingColnectId: colnectId },
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
  const adds = fills.map((p) => `<strong>${esc(p.label)}</strong>`);
  // The row's date tick decides whether this write carries the date at all (#668) — the same rule
  // the batch write follows, and for the same reason: the instance dates from `issuedOn`, so an
  // unticked row simply sends none.
  const dating = stamp.dateProposal?.status === "would-fill" && dateTicked(colnectId, stamp.stampId);
  // The same, per attribute (#739): the row's ticks decide which of the six this write carries, and
  // an unticked one is expressed by leaving it out of what is sent.
  const attributes: ExtractedItem["attributes"] = {};
  for (const p of stamp.attributes) {
    if (p.status !== "would-fill") continue;
    if (!attrTicked(colnectId, stamp.stampId, p.field)) continue;
    const printed = src?.attributes?.[p.field as keyof NonNullable<ExtractedItem["attributes"]>];
    if (printed) attributes[p.field as keyof typeof attributes] = printed;
  }
  const attributing = Object.keys(attributes).length > 0;
  // A date fill is an addition like a number's, so it is named in the same sentence (#655). A
  // conflict never is: it is not part of this write.
  if (dating && stamp.dateProposal) {
    adds.push(`the issue date <strong>${esc(stamp.dateProposal.label)}</strong>`);
  }
  if (attributing) {
    const n = Object.keys(attributes).length;
    adds.push(`<strong>${n} attribute${n === 1 ? "" : "s"}</strong>`);
  }
  const fillLine = adds.length ? `<div>Also adds ${adds.join(", ")}.</div>` : "";
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
    issuedOn: dating ? src?.issuedOn : undefined,
    attributes: attributing ? attributes : undefined,
  });
  if (res.ok) {
    markWritten(colnectId, stamp, res.backfill, res.date, res.attributes);
    const filled = res.backfill.filter((p) => p.status === "filled").length;
    const written = res.attributes.filter((p) => p.status === "filled").length;
    const extras = [
      filled ? `${filled} catalog number${filled === 1 ? "" : "s"}` : "",
      res.date?.status === "filled" ? `the date ${res.date.label}` : "",
      written ? `${written} attribute${written === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    setStatus(
      `Linked #${colnectId} → ${stamp.name || stamp.stampId}${
        extras.length ? `, added ${extras.join(" and ")}` : ""
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
      issuedOn: dating ? src?.issuedOn : undefined,
      attributes: attributing ? attributes : undefined,
    });
    if (retry.ok) {
      markWritten(colnectId, stamp, retry.backfill, retry.date, retry.attributes);
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

/**
 * Fold a written date overwrite into what is on screen (#655). The stamp now carries Colnect's date,
 * so the two sides no longer disagree and the proposal reads as written rather than as a decision
 * still owing. The objects belong to `results`, so the next render shows it without a re-match —
 * which is what lets the batch (#668) redraw once at the end rather than after every stamp.
 */
function applyDateOverwrite(pick: DatePick, label: string): void {
  const { stamp, proposal } = pick;
  stamp.issuedYear = proposal.date.year;
  stamp.issuedMonth = proposal.date.month;
  stamp.issuedDay = proposal.date.day;
  proposal.status = "filled";
  proposal.label = label;
  proposal.currentLabel = label;
  delete proposal.conflictingFields;
}

/**
 * Fold a written attribute overwrite into what is on screen (#739) — {@link applyDateOverwrite} for
 * a handful of fields at once.
 *
 * The instance answers with what it *actually* did, and that answer is what lands: a field it
 * refused because Colnect's word maps to nothing stays `unmapped` on the row rather than being
 * marked written, which is the one thing a naive "they all went through" fold would get wrong.
 */
function applyAttributeOverwrite(pick: AttributePick, written: AttributeProposal[]): void {
  const byField = new Map(written.map((p) => [p.field, p]));
  for (const proposal of pick.stamp.attributes) {
    const result = byField.get(proposal.field);
    if (!result || !(proposal.field in pick.fields)) continue;
    proposal.status = result.status;
    proposal.label = result.label;
    proposal.currentLabel = result.status === "filled" ? result.label : result.currentLabel;
  }
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

// ── Issue date (#655) ────────────────────────────────────────────────────────
// Under the numbers, in the same two shapes: a chip for what the item would add to our date, and a
// line for a date the two sides state differently.
//
// Both carry a **tick** rather than a button (#668), and both are ticked when they are drawn. A page
// is dozens of matches, the answer is "yes" on nearly all of them, and settling that one row at a
// time — a click and a confirm each — was the slowest thing in the window. So the list states what
// it is about to do, the collector unticks the exceptions, and one press of **Write** commits the
// lot behind a single confirm. Unticking is per stamp and lasts as long as the window; the standing
// answer is the **Fill missing issue dates** toggle above the list.

const DATE_TITLE: Record<string, string> = {
  "would-fill": "Colnect dates this more precisely than you do — will be filled in",
  filled: "Written to your stamp",
};

const TICK_TITLE = {
  fill: "Write this date to your stamp with the match. Untick to leave the stamp's date alone.",
  change: "Replace your date with the one Colnect prints, when you press Write. Untick to keep yours.",
} as const;

/** One date row's tick, remembered by `key` across renders — see {@link skippedDates}. */
function dateTick(key: string, kind: keyof typeof TICK_TITLE): string {
  return (
    `<label class="tick" title="${esc(TICK_TITLE[kind])}">` +
    `<input type="checkbox" data-date-key="${esc(key)}"${skippedDates.has(key) ? "" : " checked"} />` +
    `</label>`
  );
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The stamp's own date, formatted as the app formats it. Read off the candidate rather than out of
 * the proposal, because a stamp with nothing to propose still has a date worth showing.
 */
function stampDate(c: Candidate): string | null {
  const parts: string[] = [];
  if (c.issuedDay) parts.push(String(c.issuedDay));
  if (c.issuedMonth && c.issuedMonth >= 1 && c.issuedMonth <= 12) parts.push(MONTH_ABBR[c.issuedMonth - 1]);
  if (c.issuedYear) parts.push(String(c.issuedYear));
  return parts.length ? parts.join(" ") : null;
}

/**
 * @param key       what this row's tick is remembered by (#668), or null where the row has nothing
 *                  left to decide — a date already written, or a candidate this item may not be.
 * @param resolvable whether a disagreement may be settled from this row at all: only a row naming a
 *                  single stamp may, since correcting the wrong sibling is a change nobody would
 *                  think to look for (#433).
 */
function dateMarkup(proposal: DateProposal | null, resolvable: boolean, key: string | null): string {
  if (!proposal) return "";
  if (proposal.status !== "conflict") {
    const mark = proposal.status === "filled" ? "✓ " : "+ ";
    const chip = `<span class="ref fill${
      proposal.status === "filled" ? " done" : ""
    }" title="${esc(DATE_TITLE[proposal.status] ?? "")}">${esc(`${mark}${proposal.label}`)}</span>`;
    // The tick belongs on the one that has not happened yet; a written date is a fact, not a plan.
    const tick = key && proposal.status === "would-fill" ? dateTick(key, "fill") : "";
    return `<div class="fills">${tick}${chip}</div>`;
  }
  // A conflict means both sides state a component, so our side always has a date to name.
  const theirs = `<span class="ref missing">${esc(proposal.colnectLabel)}</span>`;
  const mine = `<span class="ref conflict">${esc(proposal.currentLabel ?? "")}</span>`;
  if (!resolvable || !key) {
    return `<div class="fix">${mine}<span class="arrow">→</span>${theirs}</div>`;
  }
  datePicks.push(proposal);
  return (
    `<div class="fix">${dateTick(key, "change")}${mine}` +
    `<span class="arrow">→</span>${theirs}</div>`
  );
}

/** What each attribute status means, on the chip that carries it. */
const ATTRIBUTE_TITLE: Record<string, string> = {
  "would-fill": "Your stamp states nothing here — Colnect's value will be stored",
  filled: "Stored from Colnect",
  unmapped:
    "Colnect's word maps to none of your values — map it under Settings → Colnect, or leave it",
};

/**
 * A stamp's attribute proposals (#739) — the date row six fields wide, drawn on the same two shapes:
 * an addition is a ticked chip, a disagreement is `ours → theirs` with a tick of its own.
 *
 * An **unmapped** value is neither, and deliberately gets no tick at all: there is nothing to write
 * and nothing to decide here, only a word to be told about. It is drawn quietly and named for what
 * it is, because the answer to it is one trip to Settings that then covers every page.
 *
 * @param keyFor    what this row's ticks are remembered by (#668's rule, one segment wider), or null
 *                  where the row has nothing left to decide.
 * @param resolvable whether a disagreement may be settled from this row at all — only a row naming
 *                  a single stamp may (#433).
 */
function attributeMarkup(
  proposals: AttributeProposal[],
  resolvable: boolean,
  keyFor: ((field: string) => string) | null
): string {
  if (proposals.length === 0) return "";
  const rows = proposals.map((p) => {
    const name = `<span class="attrname">${esc(p.fieldLabel)}</span>`;
    if (p.status === "unmapped") {
      return (
        `<div class="fills">${name}` +
        `<span class="ref unmapped" title="${esc(ATTRIBUTE_TITLE.unmapped)}">` +
        `${esc(p.colnectLabel)} — not mapped</span></div>`
      );
    }
    if (p.status !== "conflict") {
      const mark = p.status === "filled" ? "✓ " : "+ ";
      const chip =
        `<span class="ref fill${p.status === "filled" ? " done" : ""}" ` +
        `title="${esc(ATTRIBUTE_TITLE[p.status] ?? "")}">${esc(`${mark}${p.label}`)}</span>`;
      const tick =
        keyFor && p.status === "would-fill" ? attributeTick(keyFor(p.field), "fill") : "";
      return `<div class="fills">${tick}${name}${chip}</div>`;
    }
    const theirs = `<span class="ref missing">${esc(p.colnectLabel)}</span>`;
    const mine = `<span class="ref conflict">${esc(p.currentLabel ?? "")}</span>`;
    if (!resolvable || !keyFor) {
      return `<div class="fix">${name}${mine}<span class="arrow">→</span>${theirs}</div>`;
    }
    attributePicks.push(p);
    return (
      `<div class="fix">${attributeTick(keyFor(p.field), "change")}${name}${mine}` +
      `<span class="arrow">→</span>${theirs}</div>`
    );
  });
  return rows.join("");
}

/** One attribute row's tick, remembered by `key` across renders — {@link dateTick}'s twin. */
function attributeTick(key: string, kind: keyof typeof TICK_TITLE): string {
  return (
    `<label class="tick" title="${esc(TICK_TITLE[kind])}">` +
    `<input type="checkbox" data-attr-key="${esc(key)}"${
      skippedAttributes.has(key) ? "" : " checked"
    } />` +
    `</label>`
  );
}

/** One of our stamps, with enough detail to tell it from a sibling. */
function stampBlock(
  c: Candidate,
  label: string,
  opts: {
    actionIndex?: number;
    resolveConflicts?: boolean;
    dateKey?: string | null;
    attrKeyFor?: ((field: string) => string) | null;
  } = {}
): string {
  const {
    actionIndex,
    resolveConflicts = false,
    dateKey: key = null,
    attrKeyFor = null,
  } = opts;
  const meta = [stampDate(c), c.areaName].filter(Boolean).join(" · ");
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
      meta: [
        backfillMarkup(c.backfill, resolveConflicts),
        dateMarkup(c.dateProposal, resolveConflicts, key),
        attributeMarkup(c.attributes, resolveConflicts, attrKeyFor),
        meta,
        warn,
      ]
        .filter(Boolean)
        .join(""),
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
 * Click targets for "Use Colnect's date" (#655), registered the same way: the proposal while the
 * card renders, the stamp and the page's printed value when the card closes the loop. The printed
 * value is what the instance is sent — the same string the matcher read.
 */
interface DatePick {
  /** Which Colnect item's row this tick belongs to — half of the key the tick is remembered by
   *  (#668), since one stamp can face two items on a page. */
  colnectId: string;
  stamp: Candidate;
  proposal: DateProposal;
  issuedOn: string;
}
let datePicks: DateProposal[] = [];
let dateOverwritePicks: DatePick[] = [];

/**
 * The same for the attribute disagreements (#739), with one difference that matters: a stamp can
 * carry several at once, so `pendingAttributeChanges` folds these back down to **one pick per
 * stamp** — the instance settles every attribute of a stamp in a single call, and six requests to
 * replace six words on one row would be five round trips nobody asked for.
 */
interface AttributePick {
  colnectId: string;
  stamp: Candidate;
  proposal: AttributeProposal;
  /** The printed values to send, by field — filled in by the fold above. */
  fields: Record<string, string>;
}
let attributePicks: AttributeProposal[] = [];
let attributeOverwritePicks: AttributePick[] = [];

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

/** The same for the attribute proposals a card just registered (#739). */
function claimAttributes(from: number, colnectId: string, stamp: Candidate): void {
  for (let i = from; i < attributePicks.length; i++) {
    attributeOverwritePicks[i] = {
      colnectId,
      stamp,
      proposal: attributePicks[i],
      fields: {},
    };
  }
}

/** The same for the date proposals a card just registered (#655). */
function claimDates(
  from: number,
  colnectId: string,
  stamp: Candidate,
  issuedOn: string | undefined
): void {
  for (let i = from; i < datePicks.length; i++) {
    if (issuedOn) dateOverwritePicks[i] = { colnectId, stamp, proposal: datePicks[i], issuedOn };
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
    const fromDate = datePicks.length;
    const fromAttr = attributePicks.length;
    matchBody = r.stamp
      ? stampBlock(r.stamp, matchLabel, {
          resolveConflicts,
          // Nothing left to tick on a row already written — its dates are facts now (#668).
          dateKey: r.written ? null : dateKey(r.colnectId, r.stampId),
          attrKeyFor: r.written
            ? null
            : (field) => attrKey(r.colnectId, r.stampId, field),
        })
      : labelledNote(matchLabel, `stamp ${esc(r.stampId)}`);
    if (r.stamp) {
      claimOverwrites(from, r.stamp, r.refs);
      claimDates(fromDate, r.colnectId, r.stamp, src?.issuedOn);
      claimAttributes(fromAttr, r.colnectId, r.stamp);
    }
  } else if (r.status === "needs-confirm") {
    tag = `<span class="tag needs">${esc(REASON_LABEL[r.reason] || r.reason)}</span>`;
    matchLabel = r.candidates.length > 1 ? "Pick the right stamp" : "Your stamp";
    const overwrite = r.reason === "existing-different";
    matchBody = r.candidates
      .map((c) => {
        picks.push({ colnectId: r.colnectId, stamp: c, overwrite });
        const from = overwrites.length;
        const fromDate = datePicks.length;
        const fromAttr = attributePicks.length;
        const block = stampBlock(c, matchLabel, {
          actionIndex: picks.length - 1,
          resolveConflicts,
          // Only where this row names a single stamp: a tick on one of several candidates would be
          // a decision about a stamp the collector has not chosen yet.
          dateKey: resolveConflicts ? dateKey(r.colnectId, c.stampId) : null,
          attrKeyFor: resolveConflicts
            ? (field) => attrKey(r.colnectId, c.stampId, field)
            : null,
        });
        claimOverwrites(from, c, r.refs);
        claimDates(fromDate, r.colnectId, c, src?.issuedOn);
        claimAttributes(fromAttr, r.colnectId, c);
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
        meta: [src?.issuedOn ?? null, src?.country]
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
  const dates = rows.filter(dateFillOf).length;
  // Say what a folded section is hiding, so a section worth opening announces itself.
  const adds = [
    fills > 0 ? `${fills} catalog number${fills === 1 ? "" : "s"}` : "",
    dates > 0 ? `${dates} date${dates === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const heading =
    `<span class="ttl">${esc(title)}</span><span class="cnt">${rows.length}</span>` +
    (adds.length ? `<span class="add">+${adds.join(", +")}</span>` : "");
  return collapsible
    ? `<details class="sec ${kind}"${open ? " open" : ""}><summary>${heading}</summary>${body}</details>`
    : `<div class="sec ${kind}"><div class="hdr">${heading}</div>${body}</div>`;
}

/**
 * Drop every click target registered by the last render.
 *
 * Called before a render fills them again, and by everything that throws the list away without
 * rendering one — a rescan, a change of target. That second case matters since #668: the date
 * changes are counted off `dateOverwritePicks` rather than off the DOM, so picks left over from a
 * page that is no longer on screen would have the Write button promising them.
 */
function resetPicks(): void {
  picks = [];
  overwrites = [];
  overwritePicks = [];
  datePicks = [];
  dateOverwritePicks = [];
  attributePicks = [];
  attributeOverwritePicks = [];
}

/**
 * Tell the worker what the results now say, so the toolbar badge stops counting work that has just
 * been done (#283).
 *
 * Hung off the redraw rather than off each write, because what the window shows and what the badge
 * counts are one fact stated twice — a write path that redraws without publishing would leave the
 * two disagreeing, which is the bug this exists to fix. It costs nothing when nothing changed: the
 * worker recomputes the same count and sets the same badge.
 *
 * Fire-and-forget, and silent on failure: the badge belongs to a tab the collector is not looking at
 * while this window is open, and no write may fail on the strength of it.
 */
function publishResults(): void {
  if (sourceTabId === null || scannedUrl === null || results.length === 0) return;
  void chrome.runtime
    .sendMessage({
      type: "results-updated",
      tabId: sourceTabId,
      url: scannedUrl,
      results,
    } satisfies ResultsUpdatedNotice)
    .catch(() => {});
}

function render(): void {
  resetPicks();
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
    section("Already linked", done, "done", true, done.some((r) => fillsOf(r) > 0 || dateFillOf(r))) +
    section("Skipped", skipped, "skip", true);

  resultsEl.querySelectorAll<HTMLButtonElement>("button[data-pick]").forEach((btn) => {
    const pick = picks[Number(btn.dataset.pick)];
    btn.addEventListener("click", () => confirmOne(pick.colnectId, pick.stamp, pick.overwrite));
  });

  resultsEl.querySelectorAll<HTMLButtonElement>("button[data-overwrite]").forEach((btn) => {
    const pick = overwritePicks[Number(btn.dataset.overwrite)];
    if (pick) btn.addEventListener("click", () => overwriteOne(pick));
  });

  // The date ticks (#668). Unticking never re-renders: the list would fold its own `<details>`
  // sections shut under the collector's cursor. It changes what **Write** promises, and that is the
  // whole of what has to be redrawn.
  resultsEl.querySelectorAll<HTMLInputElement>("input[data-date-key]").forEach((box) => {
    box.addEventListener("change", () => {
      const key = box.dataset.dateKey!;
      if (box.checked) skippedDates.delete(key);
      else skippedDates.add(key);
      renderChips();
      syncButtons();
    });
  });

  // The attribute ticks (#739), on exactly the same terms — and never re-rendering, for exactly the
  // same reason.
  resultsEl.querySelectorAll<HTMLInputElement>("input[data-attr-key]").forEach((box) => {
    box.addEventListener("change", () => {
      const key = box.dataset.attrKey!;
      if (box.checked) skippedAttributes.delete(key);
      else skippedAttributes.add(key);
      renderChips();
      syncButtons();
    });
  });

  renderChips();
  syncButtons();
  hydrateStampPhotos();
  publishResults();
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

// The date sync is a second write the preview has to describe honestly, so it re-previews too.
issueDateEl.addEventListener("change", () => {
  void (async () => {
    await setIssueDateSync(issueDateEl.checked);
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
  issueDateEl.checked = await getIssueDateSync();
  showLinked = await getShowLinkedDecisions();
  showLinkedEl.checked = showLinked;
  await refreshProfile();
  ready = true;
  await scanAndMatch();
})();
