// A Facebook post's formatting (#1772): the template is written in Markdown, limited to what
// Facebook's group post editor offers — bold, italic, a heading and a subheading, bulleted and
// numbered lists, a quote — and the post comes out twice: as HTML, which the kit shows and puts on
// the clipboard's `text/html` so Facebook's editor pastes it formatted, and as plain text with no
// markup symbols, for the clipboard's `text/plain` and any field that takes no formatting.
//
// Two rules shape it:
//
// - **Only what Facebook offers is formatting.** Everything else Markdown knows — links, code, rules,
//   tables, raw HTML, a third heading level — is switched off in the lexer, so it stays as typed
//   rather than turning into markup Facebook would drop or mangle — and the walk below writes no
//   tag but the ones Facebook takes, whatever the lexer hands it.
// - **A placeholder's value is text, never formatting.** The template is lexed with each value
//   standing as one private-use character, and the value is put back only once the markup is
//   settled — so `**{title}**` makes the title bold, and a title with an asterisk in it is still a
//   title with an asterisk in it.
//
// Pure and DOM-free like `description-format.ts` (same `marked`, ADR-0019): the HTML here is built
// from escaped text only, and the client still sanitises it before it is shown or copied.

import { Marked, type Token, type Tokens } from "marked";
import { escapeHtml } from "./description-format";
import type { FacebookPostPart } from "./facebook-post-rules";

/** What the post becomes once formatted. */
export interface FormattedFacebookPost {
  /** The post as HTML, for the screen and the clipboard's `text/html` — still to be sanitised. */
  html: string;
  /** The post as plain text: the formatting's symbols gone, its line breaks kept. */
  plain: string;
}

/** The formatting a template may use, for the editor to list (#1772). */
export const FACEBOOK_POST_FORMATTING: readonly { syntax: string; label: string }[] = [
  { syntax: "**bold**", label: "bold" },
  { syntax: "*italic*", label: "italic" },
  { syntax: "# ", label: "heading" },
  { syntax: "## ", label: "subheading" },
  { syntax: "- ", label: "list" },
  { syntax: "1. ", label: "numbered list" },
  { syntax: "> ", label: "quote" },
];

/** The deepest heading Facebook's editor offers: a heading and a subheading. */
const MAX_HEADING_DEPTH = 2;

// Supplementary Private Use Area-A: never typed, never in a value, one code point per placeholder.
const SENTINEL_BASE = 0xf0000;
const SENTINEL_END = 0xffffd;
const SENTINEL = /([\u{F0000}-\u{FFFFD}])/u;
const SENTINELS = /[\u{F0000}-\u{FFFFD}]/gu;

const off = () => undefined;

/** `marked` with everything Facebook's editor does not offer switched off — an `undefined` from a
 *  tokenizer is "not this", so the text falls through to a paragraph and stays as typed. */
const facebookMarkdown = new Marked({
  gfm: false,
  tokenizer: {
    heading(src: string) {
      const hashes = /^ {0,3}(#{1,6})(?=[ \t]|\n|$)/.exec(src);
      return hashes && hashes[1].length > MAX_HEADING_DEPTH ? undefined : false;
    },
    code: off,
    fences: off,
    hr: off,
    html: off,
    def: off,
    lheading: off,
    table: off,
    tag: off,
    link: off,
    reflink: off,
    codespan: off,
    del: off,
    autolink: off,
    url: off,
  },
});

/**
 * Format a post from its parts (`renderFacebookPostParts`): the template's own text read as Markdown,
 * the placeholders' values inserted as text.
 */
export function formatFacebookPost(parts: readonly FacebookPostPart[]): FormattedFacebookPost {
  const values: string[] = [];
  let source = "";
  for (const part of parts) {
    if (!part.value) {
      // A private-use character in the template itself would pose as a value; it shows as nothing.
      source += part.text.replace(SENTINELS, "");
    } else if (SENTINEL_BASE + values.length <= SENTINEL_END) {
      source += String.fromCodePoint(SENTINEL_BASE + values.length);
      values.push(part.text);
    }
  }
  if (!source.trim()) return { html: "", plain: "" };
  const tokens = facebookMarkdown.lexer(source);
  return { html: blocksHtml(tokens, values), plain: blocksPlain(tokens, values) };
}

// --- HTML -----------------------------------------------------------------------------------------

function blocksHtml(tokens: readonly Token[], values: readonly string[]): string {
  return tokens.map((t) => blockHtml(t, values)).join("");
}

function blockHtml(token: Token, values: readonly string[]): string {
  switch (token.type) {
    case "heading": {
      const t = token as Tokens.Heading;
      return `<h${t.depth}>${inlineHtml(t.tokens, values)}</h${t.depth}>`;
    }
    case "paragraph":
      return `<p>${inlineHtml((token as Tokens.Paragraph).tokens, values)}</p>`;
    case "text": {
      // A tight list item's text: inline tokens when the lexer split it, else the text itself.
      const t = token as Tokens.Text;
      return t.tokens ? inlineHtml(t.tokens, values) : textHtml(t.text, values);
    }
    case "list": {
      const t = token as Tokens.List;
      const tag = t.ordered ? "ol" : "ul";
      return `<${tag}>${t.items.map((item) => `<li>${blocksHtml(item.tokens, values)}</li>`).join("")}</${tag}>`;
    }
    case "blockquote":
      return `<blockquote>${blocksHtml((token as Tokens.Blockquote).tokens, values)}</blockquote>`;
    case "space":
      return "";
    default:
      return `<p>${textHtml(token.raw, values)}</p>`;
  }
}

function inlineHtml(tokens: readonly Token[] | undefined, values: readonly string[]): string {
  return (tokens ?? [])
    .map((token) => {
      switch (token.type) {
        case "strong":
          return `<strong>${inlineHtml((token as Tokens.Strong).tokens, values)}</strong>`;
        case "em":
          return `<em>${inlineHtml((token as Tokens.Em).tokens, values)}</em>`;
        case "br":
          return "<br>";
        case "escape":
        case "text":
          return textHtml((token as Tokens.Text).text, values);
        default:
          return textHtml(token.raw, values);
      }
    })
    .join("");
}

/** Text escaped, each value put back escaped, and every line break a `<br>` — a pressed Enter in a
 *  template, or in a value, is a line break in the post, as it is in the source. */
function textHtml(text: string, values: readonly string[]): string {
  return text
    .split(SENTINEL)
    .map((piece) => escapeHtml(sentinelValue(piece, values) ?? piece))
    .join("")
    .replace(/\n/g, "<br>");
}

// --- Plain text -----------------------------------------------------------------------------------

/**
 * Blocks as plain text, each on its own lines, separated as the template separates them: a block
 * that followed on the next line still does, one after a blank line still has the blank line.
 */
function blocksPlain(tokens: readonly Token[], values: readonly string[], indent = ""): string {
  let out = "";
  let pending = 0;
  for (const token of tokens) {
    if (token.type === "space") {
      pending += newlines(token.raw);
      continue;
    }
    const text = blockPlain(token, values, indent);
    if (out) out += "\n".repeat(Math.max(1, pending));
    out += text;
    pending = trailingNewlines(token.raw);
  }
  return out;
}

function blockPlain(token: Token, values: readonly string[], indent: string): string {
  switch (token.type) {
    case "heading":
    case "paragraph":
      return indentLines(inlinePlain((token as Tokens.Heading | Tokens.Paragraph).tokens, values), indent);
    case "text": {
      const t = token as Tokens.Text;
      return indentLines(t.tokens ? inlinePlain(t.tokens, values) : textPlain(t.text, values), indent);
    }
    case "list": {
      const t = token as Tokens.List;
      const first = typeof t.start === "number" ? t.start : 1;
      return t.items
        .map((item, i) => {
          const marker = t.ordered ? `${first + i}. ` : "• ";
          const body = blocksPlain(item.tokens, values, indent + " ".repeat(marker.length));
          return indent + marker + body.slice(indent.length + marker.length);
        })
        .join(t.loose ? "\n\n" : "\n");
    }
    case "blockquote":
      return blocksPlain((token as Tokens.Blockquote).tokens, values, indent);
    default:
      return indentLines(textPlain(token.raw, values), indent);
  }
}

function inlinePlain(tokens: readonly Token[] | undefined, values: readonly string[]): string {
  return (tokens ?? [])
    .map((token) => {
      switch (token.type) {
        case "strong":
        case "em":
          return inlinePlain((token as Tokens.Strong | Tokens.Em).tokens, values);
        case "br":
          return "\n";
        case "escape":
        case "text":
          return textPlain((token as Tokens.Text).text, values);
        default:
          return textPlain(token.raw, values);
      }
    })
    .join("");
}

function textPlain(text: string, values: readonly string[]): string {
  return text
    .split(SENTINEL)
    .map((piece) => sentinelValue(piece, values) ?? piece)
    .join("");
}

// --- Helpers --------------------------------------------------------------------------------------

/** The value a sentinel stands for, or null when `piece` is ordinary text. */
function sentinelValue(piece: string, values: readonly string[]): string | null {
  const code = piece.codePointAt(0);
  if (code === undefined || piece.length !== 2 || code < SENTINEL_BASE || code > SENTINEL_END) return null;
  return values[code - SENTINEL_BASE] ?? "";
}

function indentLines(text: string, indent: string): string {
  return indent ? text.replace(/^/gm, indent) : text;
}

function newlines(raw: string): number {
  return (raw.match(/\n/g) ?? []).length;
}

function trailingNewlines(raw: string): number {
  return (/\n*$/.exec(raw)?.[0] ?? "").length;
}
