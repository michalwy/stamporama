import {
  assignProfileColors,
  getProfileStore,
  normalizeBaseUrl,
  profileSubtitle,
  setActiveProfileId,
  type Profile,
} from "../core/profile";
import type { SearchRequest, SearchResponse } from "../core/messages";
import {
  copyDispositions,
  holdingLabel,
  isEmptyAnswer,
  wantAxisChips,
  wantedRows,
  wantProgressLabel,
  WANT_PRIORITY_LABEL,
  type SearchAnswer,
  type SearchCatalogLabel,
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
    forgetPhotos();
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
  fill(sections.copies, answer.copies, copyRow);
  fill(
    sections.stamps,
    answer.stamps.filter((s) => !s.wants),
    stampRow
  );
  fill(sections.issues, answer.issues, issueRow);

  setStatus(
    isEmptyAnswer(answer)
      ? `Nothing in this collection matches “${answer.query}”.`
      : `${countLabel(answer, wanted.length)} for “${answer.query}”.`
  );
  showWantLede(answer.stamps, wanted.length);
  // Last, and never awaited: a picture is worth waiting for only once the answer is on screen.
  hydrateThumbs();
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
  // In the sections' own order, so the line reads as a table of contents for what is below it. The
  // stamp count is the rest — wants and stamps must add up to what is actually on screen, or the
  // line describes a different search.
  const otherStamps = answer.stamps.filter((s) => !s.wants).length;
  if (wantedCount) parts.push(plural(wantedCount, "want"));
  if (answer.copies.length) parts.push(plural(answer.copies.length, "copy", "copies"));
  if (otherStamps) parts.push(plural(otherStamps, "stamp"));
  if (answer.issues.length) parts.push(plural(answer.issues.length, "issue"));
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

/**
 * The shell every row shares: a link into the app, opened in a tab of its own.
 *
 * Three parts in a fixed order, so a want, a copy and a stamp are read the same way: the **picture**
 * on the left, then the **identity** — catalog chips over the name over where it sits in the
 * collection — and last whatever is specific to this kind of row. A row that reordered them would be
 * a row the eye has to parse before it can compare.
 */
function rowLink(
  url: string,
  parts: {
    photoId?: string | null;
    catalogNumbers?: readonly SearchCatalogLabel[];
    /** Null where the thing has no name of its own, and then the line is **left out**: a great many
     *  stamps are never named, and *Unnamed stamp* on every one of them is a column of words that
     *  says nothing. The catalog chips above are the identity; the name is what is added when there
     *  is one. */
    title: string | null;
    sub: string;
  }
): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "row";
  a.href = url;
  a.target = "_blank";
  a.rel = "noreferrer noopener";
  a.title = url;

  if (parts.photoId !== undefined) a.appendChild(thumb(parts.photoId));

  const main = document.createElement("div");
  main.className = "main";
  if (parts.catalogNumbers?.length) main.appendChild(catalogChips(parts.catalogNumbers));
  if (parts.title) {
    const titleEl = document.createElement("div");
    titleEl.className = "title";
    titleEl.textContent = parts.title;
    main.appendChild(titleEl);
  }
  const subEl = document.createElement("div");
  subEl.className = "sub";
  subEl.textContent = parts.sub;
  main.appendChild(subEl);
  a.appendChild(main);
  return a;
}

/** The picture's placeholder. The bytes need an `Authorization` header, which an `<img src>` cannot
 *  carry, so `hydrateThumbs` fills it in afterwards; a row with no picture keeps the column, so the
 *  text of every row still lines up. */
function thumb(photoId: string | null): HTMLElement {
  const img = document.createElement("img");
  img.className = "thumb";
  img.alt = "";
  if (photoId) img.dataset.photo = photoId;
  return img;
}

/** A row's catalog numbers, the area's primary catalog leading and drawn louder. */
function catalogChips(numbers: readonly SearchCatalogLabel[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "cats";
  for (const n of numbers) {
    const chip = document.createElement("span");
    chip.className = `cat${n.isPrimary ? " primary" : ""}`;
    chip.textContent = n.label;
    wrap.appendChild(chip);
  }
  return wrap;
}

/** The row's own facts, as chips under its identity — a want's acceptance, a copy's condition. */
function factChips(chips: { label: string; title: string; kind: string }[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "facts";
  for (const c of chips) {
    const chip = document.createElement("span");
    chip.className = `axis ${c.kind}`;
    chip.textContent = c.label;
    // The full name on hover: an abbreviation is a handle for a collector who already knows the
    // dictionary, and this window is read against a listing written in somebody else's words.
    if (c.title && c.title !== c.label) chip.title = c.title;
    wrap.appendChild(chip);
  }
  return wrap;
}

/** One copy's axes as chips, leaving unsaid what the app leaves unsaid: a null certificate is *no
 *  certificate* (ADR-0006 §2) and a null format is a *single* (ADR-0020), neither of which the app's
 *  own copy row draws. */
function axisChipsFor(copy: SearchCopy): { label: string; title: string; kind: string }[] {
  const chips = [
    { label: copy.condition.abbr, title: copy.condition.name, kind: "condition" },
  ];
  if (copy.certificate) {
    chips.push({ label: copy.certificate.abbr, title: copy.certificate.name, kind: "certificate" });
  }
  if (copy.format) {
    chips.push({ label: copy.format.abbr, title: copy.format.name, kind: "format" });
  }
  return chips;
}

/** Where a stamp sits in the collection: its area, the set it belongs to, the year it was issued. */
function placeLine(place: {
  areaName: string | null;
  issueName: string | null;
  issueYear: number | null;
  issuedYear?: number | null;
}): string {
  return detail([
    place.areaName,
    place.issueName
      ? `${place.issueName}${place.issueYear ? ` (${place.issueYear})` : ""}`
      : null,
    place.issuedYear ? String(place.issuedYear) : null,
  ]);
}

// ── Thumbnails ───────────────────────────────────────────────────────────────
// The serving route is collection-scoped and token-authorized, and an `<img src>` cannot carry an
// `Authorization` header (and a token does not belong in a URL). So the bytes are fetched here with
// the header and handed to the `<img>` as an object URL, once per photo — the popup's own pattern.

// Keyed by photo id and holding the **promise**, not the URL: one stamp is routinely a want row and
// a copy row in the same answer, and caching only the finished value would fetch its picture twice
// and leak one of the two object URLs.
const photoUrls = new Map<string, Promise<string | null>>();

function loadPhoto(photoId: string): Promise<string | null> {
  const cached = photoUrls.get(photoId);
  if (cached) return cached;
  if (!profile) return Promise.resolve(null);
  const base = normalizeBaseUrl(profile.apiBaseUrl);
  const url = `${base}/api/collections/${profile.collectionId}/photos/${photoId}/thumb`;
  const token = profile.token;
  const pending = fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
    .catch(() => null);
  photoUrls.set(photoId, pending);
  return pending;
}

/** Fill in the thumbnails the last render left as empty boxes. A picture that will not come stays
 *  an empty box rather than disappearing — the column is what lines the rows up. */
function hydrateThumbs(): void {
  document.querySelectorAll<HTMLImageElement>("img.thumb[data-photo]").forEach((img) => {
    const photoId = img.dataset.photo;
    if (!photoId) return;
    void loadPhoto(photoId).then((url) => {
      if (url) img.src = url;
    });
  });
}

/** Drop every picture fetched for the collection just switched away from. They are another
 *  instance's bytes behind ids this one may well reuse, and an object URL outlives the row. */
function forgetPhotos(): void {
  for (const pending of photoUrls.values()) {
    void pending.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
  photoUrls.clear();
}

/**
 * A row of the **Wants** section: one open want.
 *
 * It is read like every other row — picture, catalog numbers, name, where it sits — and then says
 * what is specific to a want: the **acceptance**, as chips, because *which* condition is wanted is
 * the answer at an auction. One row per want, never a stamp with a count: a stamp wanted mint and
 * wanted used is two decisions.
 */
function wantRow({ stamp, want }: WantedRow): HTMLElement {
  const a = rowLink(stamp.url, {
    photoId: stamp.photoId,
    catalogNumbers: stamp.catalogNumbers,
    title: stamp.name,
    sub: placeLine(stamp),
  });
  a.classList.add("want-row", want.priority);

  const chips = wantAxisChips(want).map((c) => ({
    label: c.abbr,
    title: c.name,
    kind: c.axis,
  }));
  a.querySelector(".main")?.appendChild(factChips(chips));

  // How far along this want already is — the figure that stops a second purchase of something
  // already ordered, said on the row rather than in the chip.
  const progress = wantProgressLabel(want);
  if (progress) {
    const line = document.createElement("div");
    line.className = "sub";
    line.textContent = progress;
    a.querySelector(".main")?.appendChild(line);
  }

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
  const a = rowLink(stamp.url, {
    photoId: stamp.photoId,
    catalogNumbers: stamp.catalogNumbers,
    title: stamp.name,
    sub: placeLine(stamp),
  });

  // What separates this stamp from the sibling above it: its subtype (the collection default says
  // nothing and is left off, #340) and whether the copies of it may be filed one level down (#528).
  const subtype = stamp.subtype && !stamp.subtype.isDefault ? stamp.subtype.name : null;
  if (subtype || stamp.hasVariants) {
    a.querySelector(".main")?.appendChild(
      factChips(
        [
          subtype ? { label: subtype, title: subtype, kind: "condition" } : null,
          stamp.hasVariants ? { label: "has variants", title: "", kind: "format" } : null,
        ].filter((c): c is { label: string; title: string; kind: string } => c !== null)
      )
    );
  }

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

/** An issue has no picture of its own — the gallery on its screen is its stamps' (#137) — so this
 *  is the one row without the thumbnail column, rather than one with an empty box on every line. */
function issueRow(issue: SearchIssue): HTMLElement {
  return rowLink(issue.url, {
    title: issue.name,
    sub: issue.year ? String(issue.year) : "",
  });
}

function copyRow(copy: SearchCopy): HTMLElement {
  const a = rowLink(copy.url, {
    photoId: copy.photoId,
    catalogNumbers: copy.catalogNumbers,
    // The **stamp's** name, never the copy's number as a fallback: the number is already the first
    // chip in the marks column, and a row whose headline repeats it says one thing twice and the
    // stamp's own identity not at all.
    title: copy.stampName,
    sub: detail([
      placeLine(copy),
      copy.locationRef ? `filed ${copy.locationRef}` : null,
    ]),
  });
  // What this piece *is* — the axes that decide whether the lot in front of the collector would be
  // an upgrade on it, in the same chips a want states its acceptance in, so the two can be compared
  // across the window rather than translated.
  a.querySelector(".main")?.appendChild(factChips(axisChipsFor(copy)));

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
