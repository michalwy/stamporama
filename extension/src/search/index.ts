import {
  assignProfileColors,
  getProfileStore,
  profileSubtitle,
  setActiveProfileId,
  type Profile,
} from "../core/profile";
import type { SearchRequest, SearchResponse } from "../core/messages";
import {
  copyDispositions,
  holdingLabel,
  isEmptyAnswer,
  wantAxesLabel,
  wantedRows,
  wantProgressLabel,
  WANT_PRIORITY_LABEL,
  type SearchAnswer,
  type SearchCopy,
  type SearchIssue,
  type SearchStamp,
  type WantedRow,
} from "../core/search";

// The **search window** (#529): "have I got this?", asked about text selected anywhere on the web.
//
// A window of its own rather than a mode of the match window, for the reason the capture window is
// one: it is a different question about a different kind of page — here, about no particular page at
// all. The context menu is what carries the text over, so this works on a marketplace the extension
// has no module for, on a dealer's price list, on an email.
//
// The query is **editable and re-runnable**. What a selection catches is a proposal: a drag that
// took a stray word, a number with the seller's own prefix glued to it, a catalog reference written
// the long way. Refining it here is the whole difference between this and a search that has to be
// started again on the page.
//
// Nothing is written from this window. It reads, and every row is a link into the app — which is why
// they open in a tab rather than navigating this window: the collector is still working through
// whatever they were looking at.

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const badge = $("badge");
const badgeName = $("badgeName");
const badgeUrl = $("badgeUrl");
const profileSelect = $<HTMLSelectElement>("profileSelect");
const askForm = $<HTMLFormElement>("ask");
const queryEl = $<HTMLInputElement>("query");
const runBtn = $<HTMLButtonElement>("run");
const statusEl = $("status");
const ledeEl = $("lede");
const sections = {
  wants: { section: $("wantsSection"), rows: $("wants") },
  stamps: { section: $("stampsSection"), rows: $("stamps") },
  issues: { section: $("issuesSection"), rows: $("issues") },
  copies: { section: $("copiesSection"), rows: $("copies") },
};

let profile: Profile | null = null;
let busy = false;
/** Bumped on every search, so a slower answer cannot overwrite a newer one. */
let generation = 0;

function setStatus(text: string, kind: "" | "err" = ""): void {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function syncButtons(): void {
  runBtn.disabled = busy || !profile;
}

// ── Profile badge ────────────────────────────────────────────────────────────
// The capture window's, unchanged: which collection is being asked is the one thing that must never
// be in doubt, and a search answered by the wrong instance looks exactly like a collection that is
// missing a stamp.

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
    badgeUrl.textContent = "Add one in Options, then try the menu entry again.";
  }
  syncButtons();
}

profileSelect.addEventListener("change", () => {
  void (async () => {
    await setActiveProfileId(profileSelect.value);
    await refreshProfile();
    // The results on screen are another collection's. Ask the one just chosen the same question.
    clearResults();
    void search();
  })();
});

// ── Searching ────────────────────────────────────────────────────────────────

askForm.addEventListener("submit", (e) => {
  e.preventDefault();
  void search();
});

async function search(): Promise<void> {
  const query = queryEl.value.trim();
  if (!profile) {
    setStatus("No active profile. Set one in the extension options.", "err");
    return;
  }
  if (!query) {
    clearResults();
    setStatus("Type what to look for.");
    return;
  }

  const mine = ++generation;
  busy = true;
  syncButtons();
  setStatus("Searching…");

  const res = (await chrome.runtime.sendMessage({
    type: "search",
    query,
  } satisfies SearchRequest)) as SearchResponse;

  if (mine !== generation) return; // a newer query is already on its way
  busy = false;
  syncButtons();

  if (!res.ok) {
    clearResults();
    setStatus(res.error, "err");
    return;
  }
  render(res.answer);
}

// ── Rendering ────────────────────────────────────────────────────────────────

function clearResults(): void {
  for (const { section, rows } of Object.values(sections)) {
    section.hidden = true;
    rows.replaceChildren();
  }
  ledeEl.hidden = true;
  ledeEl.textContent = "";
}

function render(answer: SearchAnswer): void {
  // Wants first, and the stamps behind them are the ones **not** wanted: a stamp on the want list is
  // already a row above, and repeating it under *Stamps* would make the section a highlight rather
  // than an answer. The link is the same either way, so nothing is lost by moving it.
  const wanted = wantedRows(answer.stamps);
  fill(sections.wants, wanted, wantRow);
  fill(
    sections.stamps,
    answer.stamps.filter((s) => !s.wants),
    stampRow
  );
  fill(sections.issues, answer.issues, issueRow);
  fill(sections.copies, answer.copies, copyRow);

  setStatus(
    isEmptyAnswer(answer)
      ? `Nothing in this collection matches “${answer.query}”.`
      : `${countLabel(answer, wanted.length)} for “${answer.query}”.`
  );
  showWantLede(answer.stamps, wanted.length);
}

/**
 * The **negative** want answer, which no section can state.
 *
 * When something is wanted the section above says so far better than a sentence could. When nothing
 * is, the absence of a section is indistinguishable from a window that never asked — so it is said
 * in words. Silence when the query matched no stamps at all: "none of these are on your want list"
 * is worth saying only when there was something to be on it.
 */
function showWantLede(stamps: SearchStamp[], wantedCount: number): void {
  const quiet = wantedCount > 0 || stamps.length === 0;
  ledeEl.hidden = quiet;
  ledeEl.textContent = quiet ? "" : "None of these are on your want list.";
}

function countLabel(answer: SearchAnswer, wantedCount: number): string {
  const parts: string[] = [];
  // Wants lead the count as they lead the window, and the stamp count is the rest — the two must add
  // up to what is actually on screen, or the line describes a different search.
  const otherStamps = answer.stamps.filter((s) => !s.wants).length;
  if (wantedCount) parts.push(plural(wantedCount, "want"));
  if (otherStamps) parts.push(plural(otherStamps, "stamp"));
  if (answer.issues.length) parts.push(plural(answer.issues.length, "issue"));
  if (answer.copies.length) parts.push(plural(answer.copies.length, "copy", "copies"));
  return parts.join(", ");
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function fill<T>(
  target: { section: HTMLElement; rows: HTMLElement },
  items: T[],
  toRow: (item: T) => HTMLElement
): void {
  target.rows.replaceChildren(...items.map(toRow));
  target.section.hidden = items.length === 0;
}

/** The shell every row shares: a link into the app, opened in a tab of its own. */
function rowLink(url: string, title: string, sub: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "row";
  a.href = url;
  a.target = "_blank";
  a.rel = "noreferrer noopener";
  a.title = url;

  const main = document.createElement("div");
  main.className = "main";
  const titleEl = document.createElement("div");
  titleEl.className = "title";
  titleEl.textContent = title;
  const subEl = document.createElement("div");
  subEl.className = "sub";
  subEl.textContent = sub;
  main.append(titleEl, subEl);
  a.appendChild(main);
  return a;
}

/**
 * A row of the **Wants** section: one open want, led by what is being looked for.
 *
 * The want is the headline and the stamp is underneath it, which is the opposite of every other row
 * here and is the point — this section answers *what am I still after*, and the stamp is which one.
 * One row per want, never a stamp with a count: a stamp wanted mint and wanted used is two decisions.
 */
function wantRow({ stamp, want }: WantedRow): HTMLElement {
  const numbers = stamp.catalogNumbers.join(" · ");
  const a = rowLink(
    stamp.url,
    wantAxesLabel(want) || "Wanted",
    detail([
      numbers || stamp.name || "Unnamed stamp",
      numbers ? stamp.name : null,
      stamp.areaName,
      // How far along this want already is — the figure that stops a second purchase of something
      // already ordered, said on the row rather than in the chip.
      wantProgressLabel(want),
    ])
  );
  a.classList.add("want-row", want.priority);
  a.querySelector(".title")?.classList.add("sought");

  const marks = document.createElement("div");
  marks.className = "marks";

  const priority = document.createElement("span");
  priority.className = `want ${want.priority}`;
  priority.textContent = WANT_PRIORITY_LABEL[want.priority];
  marks.appendChild(priority);
  marks.appendChild(heldChip(stamp));

  a.appendChild(marks);
  return a;
}

/** A stamp that is on no want list — everything the catalogue knows, and what is held of it. */
function stampRow(stamp: SearchStamp): HTMLElement {
  const numbers = stamp.catalogNumbers.join(" · ");
  const a = rowLink(
    stamp.url,
    numbers || stamp.name || "Unnamed stamp",
    detail([
      numbers ? stamp.name : null,
      stamp.subtype && !stamp.subtype.isDefault ? stamp.subtype.name : null,
      stamp.hasVariants ? "has variants" : null,
      stamp.areaName,
      stamp.issueName ? `${stamp.issueName}${stamp.issueYear ? ` (${stamp.issueYear})` : ""}` : null,
      stamp.issuedYear ? String(stamp.issuedYear) : null,
    ])
  );
  a.appendChild(heldChip(stamp));
  return a;
}

/** What is held of a stamp. Present on both kinds of stamp row: a want row needs it because holding
 *  a copy does not close a want — the two are the upgrade case, side by side. */
function heldChip(stamp: SearchStamp): HTMLElement {
  const held = document.createElement("span");
  const anything = stamp.copies > 0 || stamp.variantCopies > 0;
  held.className = `held${anything ? " yes" : ""}`;
  held.textContent = holdingLabel(stamp);
  return held;
}

function issueRow(issue: SearchIssue): HTMLElement {
  return rowLink(issue.url, issue.name || "Unnamed issue", issue.year ? String(issue.year) : "");
}

function copyRow(copy: SearchCopy): HTMLElement {
  const numbers = copy.catalogNumbers.join(" · ");
  const a = rowLink(
    copy.url,
    numbers || copy.stampName || `Copy #${copy.itemNo}`,
    detail([
      numbers ? copy.stampName : null,
      copy.issueName,
      copy.conditionName,
      copy.formatName,
      copy.locationRef ? `filed ${copy.locationRef}` : null,
    ])
  );
  const marks = document.createElement("div");
  marks.className = "marks";

  const no = document.createElement("span");
  no.className = "held nums";
  no.textContent = `#${String(copy.itemNo).padStart(5, "0")}`;
  marks.appendChild(no);

  // What the copy is *for* (#550), in the inventory row's own chips: which piece this is answers half
  // the question at an auction, and whether it is a keeper, already for sale or trade material
  // answers the other half — without which the collector opens the copy to find out.
  const dispositions = copyDispositions(copy);
  if (dispositions.length > 0) {
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const d of dispositions) {
      const chip = document.createElement("span");
      chip.className = `disp ${d.token}`;
      chip.textContent = d.label;
      chips.appendChild(chip);
    }
    marks.appendChild(chips);
  }

  a.appendChild(marks);
  return a;
}

/** Join the parts of a row's second line, dropping whatever this row has nothing to say about. */
function detail(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

// ── Opening ──────────────────────────────────────────────────────────────────

// What the collector selected, handed over by the service worker in the URL. It is put in the box
// rather than searched for silently, so the first thing on screen is what is actually being asked.
const initialQuery = new URLSearchParams(location.search).get("q") ?? "";

// Escape closes the window, as it does in the match and capture windows: this has no address bar,
// nothing here is unsaved, and the collector is going back to the page they selected from.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.close();
});

void (async () => {
  queryEl.value = initialQuery;
  await refreshProfile();
  // Select the text as well as filling it: the common correction is to retype the whole reference,
  // and the second most common is to trim it, which needs the caret in it either way.
  queryEl.focus();
  queryEl.select();
  if (initialQuery.trim()) await search();
  else setStatus("Type what to look for.");
})();
