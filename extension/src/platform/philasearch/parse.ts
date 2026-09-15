import type { CaptureResult, CapturedLot } from "../capture";

// Reading one philasearch.com lot page (#742). Pure DOM → data, unit-tested like every other module.
//
// Philasearch is an **aggregator of auction houses**, and that decides almost everything here. A lot
// is a house's lot in a house's sale — `Lot 9850` in *Christoph Gärtner 66th Auction* — listed
// through Philasearch, which takes **written bids** on the house's behalf. So the page states no
// standing bid at all: only the figure the lot opens at (*Minimum bid*, or *Opening bid* beside an
// estimate) and, once the collector has bid, **their own** bid (*Your current bid*). The first is the
// lot's `startingPrice`, the second its `myBid`, and `currentBid` is never filled from here — a
// commission bid is a proxy maximum rather than a price the lot stands at, and recording it as one
// would make every sale total read the collector's own ceiling as the market.
//
// Unlike Allegro there is no JSON on the page to read, so this reads markup — but **structure, never
// wording**. The same page exists in English and German (`Minimum bid` / `Ausruf`, `Lot` / `Los`) and
// its figures are re-formatted in the browser (`150.00 EUR` arrives as `150 EUR`), so what is matched
// on is the handful of hooks the site's own scripts use: `#posdetail-purchase` for the bidding box,
// `data-localized-number-type="currency"` for its amounts, `span.has-tip` for the time zone of the
// close, `data-modal="right_of_revocation"` for the house's name, and the `gebot` field for whether
// the lot can be bid on at all.

/** Philasearch's own host, with or without `www`. Its sister sites (numissearch, antiquessearch) are
 *  other catalogues with other lots and are deliberately not matched. */
function isPhilasearchHost(host: string): boolean {
  return host === "philasearch.com" || host === "www.philasearch.com";
}

/** The lot's identity in a lot page's path: `/<lang>/cat/<category>/lot/<house>-A<sale>-<lot>`. */
const LOT_PATH = /\/lot\/(\d+-A[^/-]+-[^/?#]+?)\/?$/;

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Philasearch's own id for the lot `url` names — `9081-A66-9850`: the house, the sale and the lot,
 * which is what the site itself files the lot under (`data-order-no`). Unlike the house's lot number
 * it is unique across every sale on the site, which is what lets a re-capture recognise the lot.
 */
export function philasearchLotId(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed || !isPhilasearchHost(parsed.hostname)) return null;
  const match = LOT_PATH.exec(parsed.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/** True when `url` is a single lot's page on philasearch.com. */
export function matchesPhilasearchLotUrl(url: string): boolean {
  return philasearchLotId(url) !== null;
}

/**
 * The address to record: the lot page as the collector opened it, minus the query and fragment the
 * site appends while browsing a search. The language segment is kept — it is the page the collector
 * reads — and the lot id ends the path either way, which is where a re-capture looks for it.
 */
export function philasearchLotUrl(url: string): string {
  const parsed = new URL(url);
  return `https://www.philasearch.com${parsed.pathname.replace(/\/$/, "")}`;
}

/**
 * An amount as the page prints it → a two-decimal string, or null.
 *
 * The page's scripts localise every figure for the reader, so one lot reads `1,500.00 EUR`,
 * `1.500,00 EUR`, `1 500 EUR` or `150 EUR` depending on who is looking. Where both separators appear
 * the later one is the decimal point; a lone separator followed by exactly three digits groups
 * thousands, since no currency here is quoted to three decimals.
 */
export function parsePhilasearchAmount(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /\d[\d.,\s  ']*/.exec(text);
  if (!match) return null;
  let digits = match[0].replace(/[\s  ']/g, "").replace(/[.,]+$/, "");
  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const grouping = decimal === "." ? "," : ".";
    digits = digits.split(grouping).join("").replace(decimal, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const separator = lastDot >= 0 ? "." : ",";
    const parts = digits.split(separator);
    digits = parts.length === 2 && parts[1].length !== 3 ? parts.join(".") : parts.join("");
  }
  const value = Number(digits);
  return Number.isFinite(value) ? value.toFixed(2) : null;
}

/** The three-letter currency printed after an amount (`150 EUR`), or null. */
export function parsePhilasearchCurrency(text: string | null | undefined): string | null {
  const match = /\b([A-Z]{3})\b/.exec(text ?? "");
  return match ? match[1] : null;
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/**
 * A close as the page prints it → an ISO instant, or null.
 *
 * The wall-clock text is the house's own local time (`Thursday October 15th, 2026, 08:00` in English,
 * `Donnerstag 15.10.2026, 08:00` in German) and the offset is stated beside it, in the tooltip of the
 * zone abbreviation (`Europe/Berlin GMT +2:00`). Both are needed: a house in Buenos Aires closes at
 * 19:00 its time, which is midnight in Warsaw and the next day. A date with no time — the end of an
 * after-auction sale is stated that way — is not a close to age a watchlist against, and reads null.
 */
export function parsePhilasearchClose(wallClock: string, zoneTitle: string): string | null {
  const offset = /GMT\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/.exec(zoneTitle);
  if (!offset) return null;
  const offsetMinutes =
    (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3] ?? "0"));

  let year: number, month: number, day: number, hour: number, minute: number;
  const numeric = /(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(wallClock);
  const worded = /([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(
    wallClock
  );
  if (numeric) {
    [day, month, year, hour, minute] = numeric.slice(1).map(Number);
  } else if (worded && MONTHS[worded[1].toLowerCase()]) {
    month = MONTHS[worded[1].toLowerCase()];
    [day, year, hour, minute] = worded.slice(2).map(Number);
  } else {
    return null;
  }
  const utc = Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60_000;
  const instant = new Date(utc);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The text an element's own leading text nodes carry, stopping at its first child element — how an
 *  amount is read without the `(app. 649 PLN)` conversion printed underneath it. */
function leadingText(el: Element | null): string {
  if (!el) return "";
  let out = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== 3) break;
    out += node.textContent ?? "";
  }
  return out.replace(/\s+/g, " ").trim();
}

/** The close's wall-clock text: the text nodes immediately before the zone abbreviation, inside the
 *  same parent. Some houses wrap it in a bold `div` and some print it straight into the box. */
function closeWallClock(zone: Element): string {
  let out = "";
  for (let node = zone.previousSibling; node && node.nodeType === 3; node = node.previousSibling) {
    out = (node.textContent ?? "") + out;
  }
  return out.replace(/\s+/g, " ").trim();
}

const TITLE_DESCRIPTION_LENGTH = 90;

/**
 * A name for the lot. The page has no title as such: the heading carries the house's lot number and
 * its **category** (`Poland`), and the description beneath it opens with what the lot is. The two
 * together read as a name in a watchlist row — `Poland — 1918/2005, mint and used collection in eight
 * brown Safe albums…` — where the category alone would name forty lots the same.
 */
function lotTitle(doc: Document): string | null {
  const heading = doc.querySelector("h1");
  const category = text(heading?.querySelector("span"));
  const block = doc.querySelector("[data-lot-block]");
  const description = text(block?.parentElement?.parentElement?.querySelector("p"));
  let head = description;
  if (head.length > TITLE_DESCRIPTION_LENGTH) {
    const cut = head.slice(0, TITLE_DESCRIPTION_LENGTH);
    head = `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : cut.length)}…`;
  }
  if (category && head) return `${category} — ${head}`;
  return category || head || null;
}

/**
 * Read the lot in `doc`.
 *
 * A lot is capturable while it **can be bid on**, and the page says so structurally: the bidding box
 * carries the maximum-bid field (`gebot`) exactly while bids are taken. An after-auction sale — the
 * house selling what went unsold, first come first served, at the opening figure — carries the same
 * box without it, and is refused naming what it is, as Allegro's *Kup teraz* is.
 */
export function capturePhilasearchLot(doc: Document, url: string): CaptureResult {
  const lotId = philasearchLotId(url) ?? doc.querySelector("[data-lot-block]")?.getAttribute("data-lot-block") ?? null;
  const box = doc.getElementById("posdetail-purchase");
  if (!lotId || !box) {
    return {
      ok: false,
      reason: "not-a-listing",
      message: "This page is not a single Philasearch lot. Open the lot's own page and try again.",
    };
  }

  if (!box.querySelector('input[name="gebot"]')) {
    return {
      ok: false,
      reason: "not-an-auction",
      message:
        "This lot is not open for bidding — an after-auction sale, or a sale that has closed. Only lots that are still being bid on are tracked.",
    };
  }

  const zone = box.querySelector("span.has-tip");
  const endsAt = zone ? parsePhilasearchClose(closeWallClock(zone), zone.getAttribute("title") ?? "") : null;
  if (!endsAt) {
    return {
      ok: false,
      reason: "incomplete",
      message: "The closing time on this page could not be read. Reload the lot and try again.",
    };
  }

  // The opening figure is the one amount in the box's large type; the estimate some houses print
  // above it is a range without a currency hook, and the collector's own bid is a smaller `span`.
  const opening = box.querySelector('.text-2xl [data-localized-number-type="currency"]');
  const openingText = leadingText(opening);
  const own = box.querySelector('span[data-localized-number-type="currency"]');

  const heading = doc.querySelector("h1");
  const lotNo = /^\S+\s+(\S+)/.exec(leadingText(heading))?.[1] ?? null;

  const lot: CapturedLot = {
    platformOfferId: lotId,
    url: philasearchLotUrl(url),
    title: lotTitle(doc),
    // The **house's** number, as printed in its catalogue — the number a collector quotes, and the
    // one a lot added by hand to a house sale already carries. Not the listing's identity: `Lot 1`
    // is in every sale there is.
    lotNo,
    // Philasearch prints the house's name only inside its legal notices; the revocation notice is the
    // one every house has and the one that names the house rather than its company registration.
    sellerName: text(doc.querySelector('[data-modal="right_of_revocation"] h3')) || null,
    saleName: text(doc.querySelector(".toolbar span.text-lg")) || null,
    endsAt,
    startingPrice: parsePhilasearchAmount(openingText),
    currentBid: null,
    myBid: own ? parsePhilasearchAmount(text(own)) : null,
    currency: parsePhilasearchCurrency(openingText),
    bidderCount: null,
  };
  return { ok: true, lot };
}
