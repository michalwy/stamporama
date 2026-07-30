// Turn the Stamporama links a marketplace prints as plain text into real, readable links (#417).
//
// Colnect renders a listing's **private note** as text inside one element — no anchor, whatever the
// note says — so the `{offerUrl}` a listing text carries there (#415) has to be copied or selected
// by hand to be followed. The whole point of putting it there was to get from the listing in front
// of you to the offer behind it in one click.
//
// Two rules shape everything here:
//
//   • **Origin decides whether**, never the path. A URL is rewritten only when its origin is one of
//     the instances the collector registered with this extension. That is the safety story: an
//     extension that turns arbitrary text on a third-party page into links is a phishing vector, and
//     "an address I hold a token for" is the only definition of ours that cannot be spoofed by page
//     content. It is also what makes the long `/c/<slug>/offers/<cuid>` already sitting in published
//     notes and the short `/o/<slug>/<no>` (#416) one case rather than two.
//
//   • **Path decides what it says.** A bare URL is not something anyone wants to read, so the link
//     renders as the Stamporama mark plus a label — `Offer #42` where the address carries a number,
//     and a plain `Stamporama offer` where it carries a cuid, which is worth no one's eyes.
//
// Pure DOM work: no `chrome.*`, so it is unit-tested against `linkedom` like the platform modules.

/** Marks an anchor this module produced, so a second pass leaves it alone. A note element is
 * re-read whenever the page is (re-)processed, and wrapping a wrapped link would nest anchors. */
const MARKER_ATTR = "data-stamporama-link";

/** What the rewritten link renders as: the label, and the offer number when the address carries
 * one. Exported for the tests and for whatever later wants to identify the offer (a tooltip). */
export interface InstanceLinkLabel {
  text: string;
  offerNo: number | null;
}

/**
 * How one instance URL should read. `/o/<slug>/<no>` (#416) states an offer number, so the link
 * says it; the canonical `/c/<slug>/offers/<cuid>` states an id, which is not worth reading, so the
 * link only says what it is. Anything else on the instance — a link a collector wrote by hand into
 * the note — falls back to the bare instance name rather than pretending to know what it points at.
 */
export function instanceLinkLabel(url: URL): InstanceLinkLabel {
  const short = /^\/o\/[^/]+\/(\d+)\/?$/.exec(url.pathname);
  if (short) {
    const offerNo = Number(short[1]);
    if (Number.isSafeInteger(offerNo)) return { text: `Offer #${offerNo}`, offerNo };
  }
  if (/^\/c\/[^/]+\/offers\/[^/]+\/?$/.test(url.pathname)) {
    return { text: "Stamporama offer", offerNo: null };
  }
  return { text: "Stamporama", offerNo: null };
}

/** The origin of a registered profile's base URL, or null when it is not a usable URL — a stored
 * value is whatever was typed into the options form, so it is parsed rather than trusted. */
function originOf(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return null;
  }
}

/** The registered origins, de-duplicated: several profiles commonly name one instance (two
 * collections on the same server), and the set is what a URL is tested against. */
export function registeredOrigins(baseUrls: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of baseUrls) {
    const origin = originOf(raw);
    if (origin) out.add(origin);
  }
  return out;
}

/** Matches an http(s) URL inside a run of text. Trailing punctuation is left out of the match — a
 * note ending "…/o/main/42." means the sentence to stop there, not the address to include a dot. */
const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

/**
 * Replace every registered-instance URL inside `root`'s text with a labelled link.
 *
 * Returns how many links were made — zero being the normal outcome on the overwhelming majority of
 * pages, and the reason this is safe to run on all of them. Text inside an existing anchor is
 * skipped, so a site that already linked something keeps its own markup, and so a second run is a
 * no-op.
 *
 * `iconUrl` is drawn beside the label; passing null renders the label alone, which is what keeps
 * this function free of any assumption about how the icon reaches the page.
 */
export function linkifyInstanceUrls(
  root: Element | null | undefined,
  origins: ReadonlySet<string>,
  iconUrl: string | null
): number {
  if (!root || origins.size === 0) return 0;

  const doc = root.ownerDocument;
  // Collected first: rewriting a text node while walking the tree invalidates the walk.
  const targets: Text[] = [];
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data || !text.data.includes("://")) continue;
    if (text.parentElement?.closest("a")) continue;
    targets.push(text);
  }

  let made = 0;
  for (const text of targets) {
    const fragment = doc.createDocumentFragment();
    let last = 0;
    for (const match of text.data.matchAll(URL_RE)) {
      const raw = match[0];
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        continue;
      }
      if (!origins.has(url.origin)) continue;

      const before = text.data.slice(last, match.index);
      if (before) fragment.appendChild(doc.createTextNode(before));
      fragment.appendChild(buildLink(doc, url, raw, iconUrl));
      last = match.index + raw.length;
      made += 1;
    }
    if (last === 0) continue; // nothing of ours in this run — leave the node exactly as it was
    const tail = text.data.slice(last);
    if (tail) fragment.appendChild(doc.createTextNode(tail));
    text.parentNode?.replaceChild(fragment, text);
  }
  return made;
}

/** The anchor itself: the mark, the label, and the real address on `title` — the URL stops being
 * visible, so hovering has to be able to answer where this actually goes. */
function buildLink(doc: Document, url: URL, href: string, iconUrl: string | null): HTMLAnchorElement {
  const { text } = instanceLinkLabel(url);
  const a = doc.createElement("a");
  a.setAttribute(MARKER_ATTR, "");
  a.href = href;
  a.title = href;
  // Colnect's own page keeps its tab: the note is read while working through listings, and losing
  // that place to follow a link is exactly the friction this is here to remove.
  a.target = "_blank";
  a.rel = "noreferrer noopener";
  a.style.whiteSpace = "nowrap";

  if (iconUrl) {
    const img = doc.createElement("img");
    img.src = iconUrl;
    img.alt = "";
    img.width = 14;
    img.height = 14;
    img.style.verticalAlign = "-2px";
    img.style.marginRight = "0.25em";
    a.appendChild(img);
  }
  a.appendChild(doc.createTextNode(text));
  return a;
}
