import { getActiveProfile, type Profile } from "../core/profile";
import type {
  BackgroundRequest,
  ConfirmResponse,
  ExtractResponse,
  MatchResponse,
} from "../core/messages";
import type { ExtractedItem } from "../platform/types";
import type { Candidate, MatchResult } from "../core/decisions";

// Popup controller: shows the active profile, drives extraction (or sample data), previews match
// decisions (dry-run), and writes only after a confirm that names the active target.

const SAMPLE_ITEMS: ExtractedItem[] = [
  { platformItemId: "sample-1", name: "Sample A", catalogRefs: [{ catalog: "Mi", number: "PL 200" }] },
  { platformItemId: "sample-2", name: "Sample B", catalogRefs: [{ catalog: "Pol", number: "300" }] },
];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const badge = $("badge");
const statusEl = $("status");
const resultsEl = $("results");
const extractBtn = $<HTMLButtonElement>("extract");
const sampleBtn = $<HTMLButtonElement>("sample");
const previewBtn = $<HTMLButtonElement>("preview");
const writeAutoBtn = $<HTMLButtonElement>("writeAuto");

let profile: Profile | null = null;
let items: ExtractedItem[] = [];
let results: MatchResult[] = [];

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("err", isError);
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function sendToBackground<R>(msg: BackgroundRequest): Promise<R> {
  return chrome.runtime.sendMessage(msg) as Promise<R>;
}

async function refreshProfile(): Promise<void> {
  profile = await getActiveProfile();
  if (profile) {
    badge.classList.remove("none");
    badge.innerHTML = `<span class="name">${esc(profile.name || "Profile")}</span><span class="url">${esc(
      profile.apiBaseUrl
    )} · ${esc(profile.collectionName || profile.collectionId)}</span>`;
  } else {
    badge.classList.add("none");
    badge.textContent = "No active profile — open Options.";
  }
}

function setItems(next: ExtractedItem[]): void {
  items = next;
  results = [];
  resultsEl.innerHTML = "";
  previewBtn.disabled = items.length === 0;
  writeAutoBtn.disabled = true;
}

async function extractFromPage(): Promise<void> {
  setStatus("Extracting…");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("No active tab.", true);
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "extract" })) as ExtractResponse;
    if (!res.ok) {
      setStatus(res.error, true);
      setItems([]);
      return;
    }
    setItems(res.items);
    setStatus(`Extracted ${res.items.length} item(s).`);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  }
}

function loadSample(): void {
  setItems(SAMPLE_ITEMS);
  setStatus(`Loaded ${SAMPLE_ITEMS.length} sample item(s).`);
}

const REASON_LABEL: Record<string, string> = {
  "multiple-candidates": "Multiple candidates",
  "partial-conflict": "Partial conflict",
  "existing-different": "Already has a different Colnect ID",
  "no-candidates": "No matching stamp",
  "unresolved-refs": "No usable catalog refs",
};

function candidateRow(colnectId: string, c: Candidate): string {
  const meta = [c.name, c.issuedYear, c.areaName, c.catalogNumbers.join(", ")].filter(Boolean).join(" · ");
  return `<div class="cand"><span><span>${esc(c.name || "(unnamed)")}</span><br><span class="meta">${esc(
    meta
  )}${c.existingColnectId ? ` · has ${esc(c.existingColnectId)}` : ""}</span></span>` +
    `<button data-confirm data-colnect="${esc(colnectId)}" data-stamp="${esc(c.stampId)}"${
      c.existingColnectId ? ' data-overwrite="1"' : ""
    }>Use this</button></div>`;
}

function renderResults(): void {
  const autoPending = results.filter((r) => r.status === "auto" && !r.written).length;
  writeAutoBtn.disabled = autoPending === 0;
  writeAutoBtn.textContent = autoPending > 0 ? `Write ${autoPending} auto-match(es)` : "Write auto-matches";

  resultsEl.innerHTML = results
    .map((r) => {
      const head = `<div class="head"><span class="id">${esc(r.colnectId)}</span>`;
      if (r.status === "auto") {
        const label = r.alreadySet ? "already set" : r.written ? "written ✓" : "will write";
        return `<div class="item">${head}<span class="tag auto">auto · ${label}</span></div><div class="muted">→ stamp ${esc(
          r.stampId
        )}</div></div>`;
      }
      if (r.status === "needs-confirm") {
        return `<div class="item">${head}<span class="tag needs">${esc(
          REASON_LABEL[r.reason] || r.reason
        )}</span></div>${r.candidates.map((c) => candidateRow(r.colnectId, c)).join("")}</div>`;
      }
      return `<div class="item">${head}<span class="tag skip">skipped · ${esc(
        REASON_LABEL[r.reason] || r.reason
      )}</span></div></div>`;
    })
    .join("");

  resultsEl.querySelectorAll<HTMLButtonElement>("button[data-confirm]").forEach((btn) => {
    btn.addEventListener("click", () =>
      confirmOne(btn.dataset.colnect!, btn.dataset.stamp!, btn.dataset.overwrite === "1")
    );
  });
}

async function preview(): Promise<void> {
  if (!profile) {
    setStatus("Set an active profile first.", true);
    return;
  }
  setStatus("Previewing (dry-run)…");
  const res = await sendToBackground<MatchResponse>({ type: "match", items, dryRun: true });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  results = res.results;
  renderResults();
  setStatus(`Previewed ${results.length} decision(s) — no changes written.`);
}

async function writeAuto(): Promise<void> {
  if (!profile) return;
  if (!confirm(`Write auto-matches to "${profile.name}" (${profile.apiBaseUrl})?`)) return;
  setStatus("Writing auto-matches…");
  const res = await sendToBackground<MatchResponse>({ type: "match", items, dryRun: false });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  results = res.results;
  renderResults();
  const written = results.filter((r) => r.status === "auto" && r.written).length;
  setStatus(`Wrote ${written} auto-match(es) to ${profile.name}.`);
}

async function confirmOne(colnectId: string, stampId: string, overwrite: boolean): Promise<void> {
  if (!profile) return;
  if (!confirm(`Write Colnect ID ${colnectId} to stamp ${stampId} on "${profile.name}" (${profile.apiBaseUrl})?`)) {
    return;
  }
  setStatus("Writing…");
  const res = await sendToBackground<ConfirmResponse>({
    type: "confirm",
    colnectId,
    stampId,
    allowOverwrite: overwrite,
  });
  if (res.ok) {
    setStatus(`Wrote ${colnectId} → stamp ${stampId}.`);
    return;
  }
  if (res.conflict) {
    if (confirm(`That stamp already has Colnect ID ${res.existingColnectId ?? "?"}. Overwrite it?`)) {
      const retry = await sendToBackground<ConfirmResponse>({
        type: "confirm",
        colnectId,
        stampId,
        allowOverwrite: true,
      });
      setStatus(retry.ok ? `Overwrote → ${colnectId}.` : retry.error, !retry.ok);
    }
    return;
  }
  setStatus(res.error, true);
}

extractBtn.addEventListener("click", extractFromPage);
sampleBtn.addEventListener("click", loadSample);
previewBtn.addEventListener("click", preview);
writeAutoBtn.addEventListener("click", writeAuto);

void refreshProfile();
