// What the app does with the whitespace around text the collector types (#1357).
//
// A stray space before or after a value is invisible on screen and then shows up everywhere the
// value is used: it changes how a name sorts, it defeats a search for the same text typed cleanly,
// it makes two otherwise identical names look different, and it reaches listing titles on
// marketplaces. Nothing about it is ever intended, so it is removed rather than reported.
//
// **Only the ends.** Line breaks and indentation *inside* a longer text are left exactly as typed —
// a description, an album template or a listing text is not reflowed by this rule. `String.trim()`
// is precisely that, and it counts a non-breaking space as whitespace too, which is what pasting
// from a web page tends to leave behind.
//
// **A value of only whitespace becomes the empty string**, and from there every field's existing
// answer to *empty* applies unchanged: a required one refuses it, an optional one stores its own
// notion of nothing. The rule deliberately stops short of turning `""` into `NULL` itself — for
// `CollectionAreaVendor.areaPrefix` the two are different statements (`area-prefix.ts`: `''` is the
// stated *no prefix here*, `NULL` is *inherit*), and a blanket conversion would silently merge them.
// Trimming alone is enough for what #1357 asks: *typed spaces* and *empty* stop being two states.
//
// The rule is applied in two places and nowhere else. The field applies it **when the collector
// leaves it**, so what is on screen is what is stored (`shared/text-input.tsx`, the same shape
// `NumericInput` gives an amount, #1231). The database applies it **on the way in**, for every
// write by every path (`prisma-text-trim.ts`), so a value that never passed a field — an import, a
// form submitted without the field ever being blurred — cannot land untrimmed either.

/**
 * The whitespace around a typed value, removed. Interior whitespace — line breaks, indentation,
 * the spaces between words — is untouched.
 */
export function trimTextInput(value: string): string {
  return value.trim();
}

/**
 * True when a value says nothing: empty, or nothing but whitespace. What a required field refuses
 * and an optional one stores as its own nothing.
 */
export function isBlankTextInput(value: string): boolean {
  return trimTextInput(value) === "";
}

/**
 * A search box's text as it arrives in a URL, trimmed, with a search that says nothing reported as
 * no search at all (#1357).
 *
 * The box itself is a {@link trimTextInput}-settling field like any other, but a list searches
 * **while it is being typed in** — the debounce fires long before the field is left — so a trailing
 * space would reach the query and, under `contains`, find fewer rows than the same text typed
 * cleanly. Reading the parameter through here is what makes the two searches the same search.
 */
export function readSearchParam(
  params: URLSearchParams,
  key = "search"
): string | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  return trimTextInput(raw) || undefined;
}
