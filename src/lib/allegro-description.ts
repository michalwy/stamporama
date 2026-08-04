/**
 * A listing description, rewritten into the markup Allegro actually accepts (#477).
 *
 * Pure, no DOM, no dependency. This exists because Allegro's description field is **not** an HTML
 * field: `description.sections[].items[].content` takes a closed list of tags — `<p>`, `<h1>`,
 * `<h2>`, `<ul>`, `<ol>`, `<li>`, `<b>` — with **no attributes at all**, and everything must sit
 * inside one of the block tags. Anything else is a `422` naming the field and nothing more.
 *
 * Our descriptions do not look like that and should not have to. They are written in three formats
 * (#319) and rendered by one shared renderer (`descriptionToUnsafeHtml`), which is what the offer
 * screen shows and what the clipboard carries: `plain` comes out as `<p style="white-space:pre-wrap">`
 * — an attribute, refused — and `markdown` comes out as `<strong>`, `<em>`, `<a href>` and `<h3>`,
 * none of which is on Allegro's list. So the conversion happens here, at the one point that knows the
 * text is going to Allegro, rather than by narrowing what a collector may write.
 *
 * The rules are **lossy on purpose and never destructive**: a tag Allegro does not take is dropped
 * and *its text is kept*. A link becomes its own words, italics become plain words, an `<h4>` becomes
 * an `<h2>`. Nothing a collector typed disappears; only markup Allegro would have refused does.
 */

/** What Allegro takes inside a description item — the whole specification this module implements.
 *  Bold is the only inline tag, and it is handled by the emitter rather than named here. */
type BlockTag = "p" | "h1" | "h2" | "li";
type ListTag = "ul" | "ol";

/** How a tag we render maps onto one Allegro takes. `null` means **drop the tag, keep the text**. */
function canonicalTag(tag: string): BlockTag | ListTag | "b" | "br" | null {
  switch (tag) {
    case "b":
    case "strong":
      return "b";
    case "h1":
      return "h1";
    // Allegro has two heading levels. A deeper one is still a heading, and flattening it to the
    // lowest available one keeps the structure the collector wrote — dropping it would fold a
    // sub-heading into the paragraph after it.
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "h2";
    case "p":
    case "div":
    case "blockquote":
    case "pre":
      return "p";
    case "ul":
      return "ul";
    case "ol":
      return "ol";
    case "li":
      return "li";
    case "br":
      return "br";
    default:
      return null;
  }
}

type Token =
  | { kind: "text"; value: string }
  | { kind: "open"; tag: string; selfClosing: boolean }
  | { kind: "close"; tag: string };

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;

/**
 * Split markup into tags and the text between them.
 *
 * Deliberately a scanner and not a parser: the input is markup this app rendered a moment ago from
 * the collector's own text, it is never executed anywhere, and the receiving end validates it again.
 * A real parser would mean a dependency and an ADR for a job whose whole output is seven tag names.
 */
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  for (let match = TAG_RE.exec(html); match !== null; match = TAG_RE.exec(html)) {
    if (match.index > index) tokens.push({ kind: "text", value: html.slice(index, match.index) });
    const tag = match[2].toLowerCase();
    tokens.push(
      match[1] === "/"
        ? { kind: "close", tag }
        : { kind: "open", tag, selfClosing: match[3] === "/" }
    );
    index = match.index + match[0].length;
  }
  if (index < html.length) tokens.push({ kind: "text", value: html.slice(index) });
  return tokens;
}

/** Text between tags, with the one thing that is not markup left alone: entities. `&amp;` came out of
 *  our own escaping and must reach Allegro as it is, so nothing is decoded and nothing is re-escaped
 *  — a bare `<` cannot occur here, the scanner having taken every one of them as a tag. */
function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ");
}

/** Whether a rendered block says anything. A block whose text is only spaces is markup left over from
 *  a blank line and is dropped rather than published as an empty paragraph. */
function hasWords(parts: readonly string[]): boolean {
  return parts.join("").replace(/<\/?b>/g, "").trim().length > 0;
}

/**
 * Rewrite one rendered description into Allegro's subset.
 *
 * The emitter keeps exactly as much state as the grammar has: which block is open, whether a list is
 * open, and how deep the bold is. Everything else — an unknown tag, a stray `</p>`, a `<b>` never
 * closed — resolves by the same rule, which is that **the text survives and the markup does not**.
 *
 * @returns the markup, or null when the description holds no words at all.
 */
export function toAllegroDescriptionHtml(html: string): string | null {
  const out: string[] = [];
  /** The list being built, and the `<li>`s collected for it. */
  let list: { tag: ListTag; items: string[] } | null = null;
  let block: { tag: BlockTag; parts: string[] } | null = null;
  let bold = 0;

  function closeBlock(): void {
    if (!block) return;
    const parts = [...block.parts];
    // A `<b>` the source never closed is closed here rather than carried into the next block, where
    // it would bold the rest of the listing.
    for (let open = bold; open > 0; open -= 1) parts.push("</b>");
    bold = 0;
    if (hasWords(parts)) {
      const rendered = `<${block.tag}>${parts.join("").trim()}</${block.tag}>`;
      if (block.tag === "li" && list) list.items.push(rendered);
      else out.push(rendered);
    }
    block = null;
  }

  function closeList(): void {
    closeBlock();
    if (!list) return;
    // A list nothing landed in is not a list. Emitting `<ul></ul>` is one more thing for Allegro to
    // refuse and nothing for a buyer to read.
    if (list.items.length > 0) out.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
    list = null;
  }

  function openBlock(tag: BlockTag): void {
    closeBlock();
    block = { tag, parts: [] };
  }

  /** Text needs somewhere to live: inside a list that is an `<li>`, outside one a `<p>`. This is what
   *  makes loose text — a markdown paragraph, a stray line — valid rather than dropped. */
  function ensureBlock(): void {
    if (!block) openBlock(list ? "li" : "p");
  }

  for (const token of tokenize(html)) {
    if (token.kind === "text") {
      const text = normalizeText(token.value);
      if (!text.trim()) {
        // Whitespace between blocks is layout, not content; inside one it is a word gap.
        if (block) block.parts.push(text);
        continue;
      }
      ensureBlock();
      block!.parts.push(text);
      continue;
    }

    const tag = canonicalTag(token.tag);
    if (tag === null) continue; // Dropped; whatever it wrapped is still coming through as text.

    if (token.kind === "open") {
      switch (tag) {
        case "br":
          // Allegro has no line break. A break inside a paragraph therefore becomes a paragraph —
          // which is what a break in a description means to read anyway.
          if (block) {
            const current = block.tag;
            closeBlock();
            openBlock(current);
          }
          break;
        case "b":
          ensureBlock();
          if (bold === 0) block!.parts.push("<b>");
          bold += 1;
          break;
        case "ul":
        case "ol":
          closeList();
          list = { tag, items: [] };
          break;
        case "li":
          closeBlock();
          // An `<li>` outside a list is a paragraph: publishing a bare one is invalid, and the words
          // in it are not.
          block = { tag: list ? "li" : "p", parts: [] };
          break;
        default:
          closeList();
          openBlock(tag);
          break;
      }
      continue;
    }

    switch (tag) {
      case "b":
        if (bold > 0) {
          bold -= 1;
          if (bold === 0) block?.parts.push("</b>");
        }
        break;
      case "ul":
      case "ol":
        closeList();
        break;
      default:
        closeBlock();
        break;
    }
  }

  closeList();
  return out.length > 0 ? out.join("") : null;
}
