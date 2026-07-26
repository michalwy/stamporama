/**
 * The format a listing description is written in (#319) — plain text, HTML or Markdown — and the
 * conversion of a description into the HTML that shows what the platform will show (ADR-0019).
 *
 * Marketplaces disagree about what their description field accepts, so the format is configured per
 * platform (next to the description template it applies to, #210) and seeded onto each offer created
 * there, where it stays editable. The private note (#267) has no format: it is a note to self, and
 * the platforms that offer one treat it as plain text.
 *
 * This module is **pure and DOM-free** so it can be unit-tested under `node:test`. It deliberately
 * stops one step short of anything renderable: {@link descriptionToUnsafeHtml} produces HTML but
 * does not sanitise it, and callers must go through the client renderer
 * (`shared/rendered-description.tsx`), which does.
 */

import { marked } from "marked";

/** The formats a platform's description field can be configured as. */
export const DESCRIPTION_FORMATS = ["plain", "html", "markdown"] as const;
export type DescriptionFormat = (typeof DESCRIPTION_FORMATS)[number];

/** What a platform (and so a new offer) starts as — plain text is what every field accepts. */
export const DEFAULT_DESCRIPTION_FORMAT: DescriptionFormat = "plain";

export const DESCRIPTION_FORMAT_LABELS: Record<DescriptionFormat, string> = {
  plain: "Plain text",
  html: "HTML",
  markdown: "Markdown",
};

/** One line per format for the platform form, saying what the collector is choosing. */
export const DESCRIPTION_FORMAT_HINTS: Record<DescriptionFormat, string> = {
  plain: "Line breaks are kept; nothing is interpreted as markup.",
  html: "The description is HTML — the platform's field takes tags.",
  markdown: "Written in Markdown; the formatted version is its rendered HTML.",
};

/** Narrow a stored / submitted value to a known format, falling back to plain text. */
export function normalizeDescriptionFormat(raw: string | null | undefined): DescriptionFormat {
  const value = (raw ?? "").trim().toLowerCase();
  return (DESCRIPTION_FORMATS as readonly string[]).includes(value)
    ? (value as DescriptionFormat)
    : DEFAULT_DESCRIPTION_FORMAT;
}

/** Escape the five characters that would otherwise be read as markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Turn a description into the HTML that shows what the platform will show.
 *
 * **The result is not sanitised** — with the `html` format it is the collector's own markup
 * verbatim, and Markdown may carry inline HTML through. Never inject this into the page directly;
 * render it through `RenderedDescription`, which sanitises first (ADR-0019 §2).
 *
 * - `plain` — escaped and wrapped in a `pre-wrap` paragraph, so it reads exactly as the textarea
 *   does. Included so every format takes the same path rather than the renderer branching.
 * - `html` — passed through as written.
 * - `markdown` — through `marked`, with `breaks` on: a description is prose typed into a textarea,
 *   where a pressed Enter means a line break rather than a paragraph continuation.
 */
export function descriptionToUnsafeHtml(
  text: string | null | undefined,
  format: DescriptionFormat
): string {
  const source = text ?? "";
  if (!source.trim()) return "";
  switch (format) {
    case "html":
      return source;
    case "markdown":
      // `async: false` keeps the synchronous overload — the renderer runs during render, and there
      // is nothing asynchronous configured to wait for.
      return marked.parse(source, { async: false, breaks: true, gfm: true });
    case "plain":
      return `<p style="white-space:pre-wrap">${escapeHtml(source)}</p>`;
  }
}

/**
 * What a sanitised description may contain: the markup a listing actually uses, and nothing that
 * can execute or navigate on its own. Exported as data so the allowlist itself is assertable in a
 * test; the client renderer hands it to DOMPurify.
 */
export const DESCRIPTION_ALLOWED_TAGS = [
  "p", "br", "hr", "div", "span",
  "b", "strong", "i", "em", "u", "s", "del", "ins", "mark", "small", "sub", "sup",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "blockquote", "pre", "code",
  "a", "img",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
] as const;

export const DESCRIPTION_ALLOWED_ATTR = ["href", "src", "alt", "title", "target", "rel", "align"] as const;

/**
 * Whether a description has anything to render at all. Blank and whitespace-only read the same:
 * there is nothing to show, and nothing to copy.
 */
export function hasDescriptionContent(text: string | null | undefined): boolean {
  return !!text?.trim();
}
