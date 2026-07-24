import type { CatalogRef, ExtractedItem } from "../types";

// Colnect catalog-list DOM extraction (#249). Pure functions over a Document/Element so they run
// under a test DOM (linkedom) as well as in the content script. Structure confirmed from a real
// Poland/Year list page:
//   - each item card:            div.pl-it
//   - Colnect item-ID:           .ibox[data-xid]  (fallback: an /stamps/stamp/<ID>-… link)
//   - catalog codes:             a <dt> "Catalog codes:" whose <dd> holds
//                                <strong>Mi:</strong>PL 3690, <strong>Sn:</strong>PL 3382, …
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

/** The numeric Colnect item-ID for a card: the `data-xid`, else the id leading a stamp-page link. */
function cardItemId(card: Element): string | null {
  const xid = card.querySelector("[data-xid]")?.getAttribute("data-xid");
  if (xid && xid.trim()) return xid.trim();

  const href = card.querySelector('a[href*="/stamps/stamp/"]')?.getAttribute("href");
  const m = href?.match(/\/stamps\/stamp\/(\d+)/);
  return m ? m[1] : null;
}

/** Best-effort display name (the matcher ignores it): the stamp-page link's text or title. */
function cardName(card: Element): string | undefined {
  const a = card.querySelector('a[href*="/stamps/stamp/"]');
  const text = (a?.textContent ?? "").trim() || (a?.getAttribute("title") ?? "").trim();
  return text || undefined;
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
  return name ? { platformItemId, name, catalogRefs } : { platformItemId, catalogRefs };
}

/** Extract every item card on a Colnect list page. */
export function extractColnect(doc: Document): ExtractedItem[] {
  return Array.from(doc.querySelectorAll("div.pl-it"))
    .map(extractCard)
    .filter((i): i is ExtractedItem => i !== null);
}
