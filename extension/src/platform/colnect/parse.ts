import type { CatalogRef, ExtractedItem } from "../types";

// Colnect DOM extraction (#249). Pure functions over a Document/Element so they run under a test DOM
// (linkedom) as well as in the content script. Two page shapes yield items, both confirmed against
// real pages — a Poland/Year list page and a single stamp's page:
//
//   list page card:              div.pl-it
//   - Colnect item-ID:           .ibox[data-xid]  (fallback: an /stamps/stamp/<ID>-… link)
//   - catalog codes:             a <dt> "Catalog codes:" whose <dd> holds
//                                <strong>Mi:</strong>PL 3690, <strong>Sn:</strong>PL 3382, …
//
//   stamp page minor variant:    .nested_items li[data-id]  (see the section further down)
// Values are kept verbatim (prefix + number + any suffix/range/block) — see the note in the plan:
// strict full-key matching needs the area prefix inside `number`, and suffixes like "3701y",
// ranges "3706-3711", blocks "BL132" must not be coerced. "Unlisted" values are skipped.

/** True for a Colnect stamp list/catalog page. Over-matching is harmless — extraction yields [] when
 *  a page has no `div.pl-it` cards. */
export function matchesColnectUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return (host === "colnect.com" || host.endsWith(".colnect.com")) && u.pathname.includes("/stamps/");
  } catch {
    return false;
  }
}

/** Strip a single trailing comma and surrounding whitespace from a catalog value. */
function cleanValue(raw: string): string {
  return raw.replace(/\s*,\s*$/, "").trim();
}

/**
 * Parse a "Catalog codes:" `dd` into catalog refs. The `dd` interleaves `<strong>ABBR:</strong>`
 * markers with the value text that follows each, up to the next marker: walk child nodes, open a new
 * ref on each colon-terminated `<strong>`, and accumulate following text as its value. `Unlisted`
 * and empty values are skipped; everything else is kept verbatim as `number`.
 */
export function parseCatalogCodes(dd: Element): CatalogRef[] {
  const refs: CatalogRef[] = [];
  let catalog: string | null = null;
  let value = "";

  const flush = () => {
    if (catalog) {
      const number = cleanValue(value);
      if (number && number.toLowerCase() !== "unlisted") {
        refs.push({ catalog, number });
      }
    }
    catalog = null;
    value = "";
  };

  for (const node of Array.from(dd.childNodes)) {
    const el = node.nodeType === 1 ? (node as Element) : null;
    if (el && el.tagName === "STRONG") {
      const text = (el.textContent ?? "").trim();
      if (text.endsWith(":")) {
        flush();
        catalog = text.slice(0, -1).trim();
        continue;
      }
    }
    // Any non-marker node contributes to the current value (text nodes, stray inline elements).
    value += node.textContent ?? "";
  }
  flush();
  return refs;
}

/** The Colnect item-ID leading a `/stamps/stamp/<ID>-…` link inside `el`, if there is one. */
function idFromStampLink(el: Element): string | null {
  const href = el.querySelector('a[href*="/stamps/stamp/"]')?.getAttribute("href");
  const m = href?.match(/\/stamps\/stamp\/(\d+)/);
  return m ? m[1] : null;
}

/** The numeric Colnect item-ID for a card: the `data-xid`, else the id leading a stamp-page link. */
function cardItemId(card: Element): string | null {
  const xid = card.querySelector("[data-xid]")?.getAttribute("data-xid");
  if (xid && xid.trim()) return xid.trim();
  return idFromStampLink(card);
}

/** Best-effort display name (the matcher ignores it): the stamp-page link's text or title. */
function cardName(card: Element): string | undefined {
  const a = card.querySelector('a[href*="/stamps/stamp/"]');
  const text = (a?.textContent ?? "").trim() || (a?.getAttribute("title") ?? "").trim();
  return text || undefined;
}

/** First usable srcset entry ("url 1x, url2 2x" → "url"). */
function firstSrcsetUrl(srcset: string | null): string | null {
  const first = srcset?.split(",")[0]?.trim().split(/\s+/)[0];
  return first || null;
}

/**
 * The card's thumbnail URL, absolute. Tolerates lazy-loading (`data-src`/`data-original`/`srcset`)
 * and skips inline placeholders. Relative URLs resolve against the document's base; if that isn't
 * resolvable (e.g. a detached test document) the raw value is returned unchanged.
 */
function cardImageUrl(card: Element): string | undefined {
  const img = card.querySelector("img");
  if (!img) return undefined;
  // Take the first real URL among the attributes a lazy-loader might use: a not-yet-loaded image
  // typically parks an inline placeholder in `src` and keeps the true URL in `data-src`, so an
  // inline `data:` value must fall through rather than end the search.
  const raw = [
    img.getAttribute("src"),
    img.getAttribute("data-src"),
    img.getAttribute("data-original"),
    firstSrcsetUrl(img.getAttribute("srcset")),
  ].find((u): u is string => !!u && !u.startsWith("data:"));
  if (!raw) return undefined;
  const base = card.ownerDocument?.baseURI;
  try {
    return base ? new URL(raw, base).href : raw;
  } catch {
    return raw;
  }
}

/** The `dd` holding catalog codes: the one whose preceding/associated `dt` reads "Catalog codes". */
function catalogCodesDd(card: Element): Element | null {
  for (const dt of Array.from(card.querySelectorAll("dt"))) {
    if ((dt.textContent ?? "").trim().toLowerCase().startsWith("catalog codes")) {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === "DD") return dd;
    }
  }
  return null;
}

/** Extract one card, or null when it lacks an item-ID or any usable catalog ref. */
export function extractCard(card: Element): ExtractedItem | null {
  const platformItemId = cardItemId(card);
  if (!platformItemId) return null;
  const dd = catalogCodesDd(card);
  const catalogRefs = dd ? parseCatalogCodes(dd) : [];
  if (catalogRefs.length === 0) return null;
  const name = cardName(card);
  const imageUrl = cardImageUrl(card);
  return {
    platformItemId,
    catalogRefs,
    ...(name ? { name } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

// ── Variants on a single-stamp page ──────────────────────────────────────────
//
// A stamp's own page also carries catalog numbers, in two places:
//
//   • the **main stamp**, under a "Catalog codes:" dt whose dd spells the catalogs out in full and
//     without a colon (`<strong>Michel</strong> PL 389`). Those don't parse as markers, so the main
//     stamp yields nothing and is skipped — the abbreviation mapping (#248) keys off abbreviations,
//     not full names.
//   • its **minor variants**, in `.nested_items li[data-id]`, whose `.st_codes` use exactly the same
//     abbreviated markup as a list page (`<strong>Mi:</strong>PL 389U`). Those are extracted here.
//
// A variant's own Colnect id is the `data-id` on its `<li>` (its "More details" link carries it too).
// Variants have no name of their own, so one is composed from the page's stamp name plus whatever
// the row gives as its difference ("Grey red", "Split rectangle.").

/** Name for a variant row: the page's stamp name, plus what makes this row different. */
function variantName(li: Element): string | undefined {
  const stamp = (li.ownerDocument?.querySelector("#name")?.textContent ?? "").trim();
  const diff = Array.from(li.querySelectorAll(".st_diff dd"))
    .map((d) => (d.textContent ?? "").trim())
    .find(Boolean);
  return [stamp, diff].filter(Boolean).join(" — ") || undefined;
}

/** Extract one minor-variant row, or null without an id or any usable catalog ref. */
export function extractVariant(li: Element): ExtractedItem | null {
  const platformItemId = li.getAttribute("data-id")?.trim() || idFromStampLink(li);
  if (!platformItemId) return null;
  const codes = li.querySelector(".st_codes");
  const catalogRefs = codes ? parseCatalogCodes(codes) : [];
  if (catalogRefs.length === 0) return null;
  const name = variantName(li);
  const imageUrl = cardImageUrl(li);
  return {
    platformItemId,
    catalogRefs,
    ...(name ? { name } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

/**
 * Extract every item a Colnect page offers: the cards of a catalog list page, and the minor variants
 * listed on a single stamp's page. Results are deduplicated by Colnect id, so no item can be offered
 * — and written — twice from one page.
 */
export function extractColnect(doc: Document): ExtractedItem[] {
  const found = [
    ...Array.from(doc.querySelectorAll("div.pl-it")).map(extractCard),
    ...Array.from(doc.querySelectorAll(".nested_items li[data-id]")).map(extractVariant),
  ].filter((i): i is ExtractedItem => i !== null);

  const seen = new Set<string>();
  const items: ExtractedItem[] = [];
  for (const item of found) {
    if (seen.has(item.platformItemId)) continue;
    seen.add(item.platformItemId);
    items.push(item);
  }
  return items;
}
