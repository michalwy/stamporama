// **Asking Colnect for a list export** (#690) — the request behind the *Export list* button, so the
// refresh loop does not need a file the collector downloads, finds and uploads by hand.
//
// Established by reading the site on 2026-08-26 (minified `https://colnect.com/s/m.115.js`,
// `Inventory.exportCsvInvList`), the same way the write in `list-write.ts` was. **None of this is
// documented or supported by Colnect** and it may change without notice, which is why the shape is
// stated here, pure and unit-tested, and why {@link readColnectListExportAnswer} has a *this is not
// an export* branch rather than a hopeful cast.
//
// Unlike `list-write.ts` this **reads**: it asks for the file Colnect's own button asks for, and
// nothing in a Colnect account changes. It shares that file's one hard rule all the same — the call
// is authenticated by session cookie alone, so it can only ever be issued same-origin from a
// colnect.com page in the collector's own browser (ADR-0042).
//
// Colnect's own button:
//
// ```
// POST /<lang>/collectors/request_list_export
// FormData: cat=<module> & list=<list id> & incl_var=<"true"|"false">
// → JSON { url }                      // where the CSV is
// → JSON { response } / { error }     // why there isn't one
// ```

/**
 * Colnect's category for stamps **as this endpoint keys it** — the module *name*, read off
 * `.list_name[data-module]` on the collector's own lists page.
 *
 * Deliberately not the `"20"` that `POST /item/col` wants (`list-write.ts`): the same site keys the
 * same category two different ways on two different calls, and a shared constant would be a single
 * name for two facts that are only equal by accident.
 */
export const COLNECT_EXPORT_MODULE = "stamps";

/**
 * Whether the export should include variants.
 *
 * Always false, and not a parameter: Colnect only offers the *Include variants* / *Exclude variants*
 * menu for modules other than stamps — a stamps row gets a plain button that passes `false`. Sending
 * anything else would be asking for a file Colnect's own screen cannot ask for.
 */
const INCLUDE_VARIANTS = "false";

/** Colnect's fallback language, and this repo's: every URL in `colnect-link.ts` is built `/en/…`. */
const DEFAULT_LANG = "en";

/**
 * The two-letter language a Colnect URL is under, or `en`.
 *
 * The endpoint is language-prefixed and the page's own prefix is the honest answer: a collector
 * whose Colnect is Polish browses `/pl/…`, and a request hard-coded to `/en/` would be this
 * extension deciding what language somebody else's account is in. Colnect derives it the same way
 * (`CT.urlBase` reads it back off `location`), which a content script cannot do directly — page
 * globals are in the other world — so it is read off the path instead.
 */
export function colnectLangFromPath(pathname: string): string {
  const match = /^\/([a-z]{2})(?:\/|$)/i.exec(pathname);
  return match ? match[1].toLowerCase() : DEFAULT_LANG;
}

/** Where the request goes. Relative for `list-write.ts`'s reason: a content script that built an
 *  absolute Colnect URL would be one edit away from posting somewhere else entirely.
 *
 *  The language goes back through {@link colnectLangFromPath}, so anything that is not a two-letter
 *  code lands on `en` rather than in the path — a page whose prefix was misread must ask Colnect a
 *  question in English, never a question about some other part of the site. */
export function colnectListExportPath(lang: string): string {
  return `/${colnectLangFromPath(`/${lang}`)}/collectors/request_list_export`;
}

/**
 * The form fields for one list's export.
 *
 * Returned as plain entries rather than as a `FormData`: this file has to be readable in `node
 * --test`, and what matters about the request is the three names and what goes in them.
 *
 * `list` is Colnect's own list id — the very `lt` everything else in the track is keyed by
 * (2 Collection, 3 Swap, 4 Wish, 5 Sell, or a custom list's own number), which is what
 * `.list_name[data-id]` carries.
 */
export function colnectListExportFields(lt: number): [string, string][] {
  return [
    ["cat", COLNECT_EXPORT_MODULE],
    ["list", String(lt)],
    ["incl_var", INCLUDE_VARIANTS],
  ];
}

/** What Colnect answered: where the file is, or why there is none. */
export type ColnectListExportAnswer =
  | { ok: true; url: string }
  | { ok: false; message: string };

/**
 * Read the JSON answer.
 *
 * Colnect's own handler takes `url` and otherwise shows `response || error` to the collector, so
 * both are read and passed on as they came — a sentence from the site itself says far more about a
 * list that cannot be exported (a limit, a private list, a session that lapsed) than any wording
 * invented here would.
 *
 * Anything else is *not an export*, said plainly. This is an undocumented endpoint: the shape it
 * answers in today is the shape asserted in `test:unit`, and the day it changes should read as a
 * refusal rather than as an empty snapshot replacing a good one.
 */
export function readColnectListExportAnswer(payload: unknown): ColnectListExportAnswer {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, message: "Colnect did not answer with an export." };
  }
  const answer = payload as Record<string, unknown>;
  const url = typeof answer.url === "string" ? answer.url.trim() : "";
  if (url) return { ok: true, url };

  const stated =
    (typeof answer.response === "string" && answer.response.trim()) ||
    (typeof answer.error === "string" && answer.error.trim()) ||
    "";
  return {
    ok: false,
    message: stated || "Colnect answered without an export file and without saying why.",
  };
}

/**
 * What to call the file that comes back, for the sentence the report screen prints about a snapshot
 * ("… rows from *this*").
 *
 * Colnect's URL already names it, and its own name is the one the collector would have seen in their
 * downloads folder had they pressed the button themselves — so the two routes into a snapshot
 * describe it the same way. A URL that names nothing usable falls back to the list, which at least
 * says which export this was.
 */
export function colnectExportFileName(url: string, lt: number): string {
  const path = url.split(/[?#]/, 1)[0];
  const last = path.slice(path.lastIndexOf("/") + 1).trim();
  const name = decodeURIComponent(last).replace(/[/\\]/g, "");
  return name || `colnect-list-${lt}.csv`;
}
