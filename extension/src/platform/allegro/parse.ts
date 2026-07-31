import type { CaptureResult, CapturedLot } from "../capture";

// Reading one allegro.pl auction page (#355). Pure DOM → data, unit-tested like every other module.
//
// **Everything is read from the page's own JSON, never from its markup.** Allegro renders the offer
// through `opbox` boxes, each of which ships its data beside it as `<script type="application/json">`
// — and every class name in the rendered HTML is hashed per build (`mli8_k4`, `msa3_z4`), so a
// selector written against one is broken by the next deployment and broken *silently*, which for a
// capture means a lot recorded with a missing bid. The JSON keys are the site's own API vocabulary
// and change on a different, much slower clock.
//
// Three blobs carry what a lot needs, found by **shape** rather than by position, since the box ids
// are opaque and per-page:
//
//   • the one with a `biddingSection` → the closing instant, the current figure, its currency, and
//     how many people are bidding;
//   • the one with a `sellerName` → who is selling;
//   • the JSON-LD `Product` → the title (and `sku`, the offer id, as a fallback for the URL).
//
// The auction test is `biddingSection.visible`: a fixed-price *Kup teraz* offer carries the very
// same section with `visible: false` and a null `endingDate`. That is why a refusal here names what
// the page is rather than what the parser failed at.

/** Allegro's own host. Subdomains are matched too (`allegrolokalnie.pl` is deliberately **not** —
 *  it is a different marketplace with different pages). */
function isAllegroHost(host: string): boolean {
  return host === "allegro.pl" || host.endsWith(".allegro.pl");
}

/**
 * True when `url` is an offer page: `/oferta/…` (a listing in its own right) or `/produkt/…` (the
 * product page an offer is shown through, which carries the identical buy-box). Both are pages a
 * single auction is bid on, which is what capture is about.
 */
export function matchesAllegroListingUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol) || !isAllegroHost(parsed.hostname)) return false;
  return /^\/(oferta|produkt)\//.test(parsed.pathname);
}

/** Every `<script type="application/json">` on the page, parsed and unparseable ones dropped. */
function jsonBlobs(doc: Document): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const script of Array.from(doc.querySelectorAll('script[type="application/json"]'))) {
    try {
      const parsed = JSON.parse(script.textContent ?? "");
      if (parsed && typeof parsed === "object") out.push(parsed as Record<string, unknown>);
    } catch {
      // A blob we cannot read is one of dozens on the page; the ones we need are found by shape.
    }
  }
  return out;
}

interface BiddingSection {
  visible?: unknown;
  endingDate?: unknown;
  popularityLabel?: unknown;
  currentPrice?: { formatted?: unknown; currency?: unknown } | null;
}

/** The buy-box's bidding data, by shape: the one blob carrying a `biddingSection` object. */
function findBiddingSection(doc: Document): BiddingSection | null {
  for (const blob of jsonBlobs(doc)) {
    const section = blob.biddingSection;
    if (section && typeof section === "object") return section as BiddingSection;
  }
  return null;
}

/** The seller's name, from the blob that states one. */
function findSellerName(doc: Document): string | null {
  for (const blob of jsonBlobs(doc)) {
    const name = blob.sellerName;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

/** The JSON-LD `Product`, which is where the title is stated cleanly — `document.title` carries
 *  Allegro's own suffixes ("• Cena • Opinie - Allegro") and the page heading is markup. */
function findLdProduct(doc: Document): { name?: unknown; sku?: unknown } | null {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const parsed = JSON.parse(script.textContent ?? "");
      if (parsed && typeof parsed === "object" && parsed["@type"] === "Product") return parsed;
    } catch {
      // Same as above: found by shape, so an unreadable one costs nothing.
    }
  }
  return null;
}

/**
 * The offer id in `url`: the trailing digits of an `/oferta/…-<id>` slug, or the `offerId` parameter
 * a `/produkt/…` page carries. This is the listing's identity — a re-capture finds the lot already
 * tracking it by this and nothing else.
 */
export function allegroOfferId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const fromQuery = parsed.searchParams.get("offerId");
  if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;
  const fromPath = /^\/oferta\/(?:.*?-)?(\d{6,})$/.exec(parsed.pathname);
  return fromPath ? fromPath[1] : null;
}

/**
 * The address to record for a captured lot: always the canonical `/oferta/<id>` form of it.
 *
 * A product page's address describes a *product* several sellers offer and carries the offer in a
 * query parameter; a slug carries a title that changes when the seller edits it. The id form is the
 * shortest thing that is unambiguously this listing, and Allegro redirects it to the full slug when
 * the collector follows it.
 */
export function allegroListingUrl(offerId: string): string {
  return `https://allegro.pl/oferta/${offerId}`;
}

/** A price as Allegro formats it (`"107,00 zł"`, non-breaking spaces and all) → a decimal string. */
export function parseAllegroAmount(formatted: unknown): string | null {
  if (typeof formatted !== "string") return null;
  const cleaned = formatted.replace(/[\s ]/g, "");
  const match = /(\d+(?:[.,]\d{1,2})?)/.exec(cleaned);
  return match ? match[1].replace(",", ".") : null;
}

/** How many people are bidding, off `"6 osób licytuje"`. Absent — or a label about something else,
 *  which is what a fixed-price offer's `"9 osób kupiło tę ofertę"` is — reads as none. */
export function parseAllegroBidderCount(label: unknown): number | null {
  if (typeof label !== "string" || !/licytuj/i.test(label)) return null;
  const match = /(\d+)/.exec(label);
  return match ? Number(match[1]) : null;
}

/**
 * Read the auction in `doc`.
 *
 * The one judgement made here is **whether the figure on the page is a bid or an opening price**,
 * and it is made from the bidder count: with nobody bidding, Allegro still prints "Aktualna cena",
 * but nobody has offered it and a lot recorded at that figure would cost the parcel money it does
 * not owe (#351 — a lot nobody has bid on costs nothing whatever it opens at). The collector sees
 * both fields in the capture window and can move the figure if the page said something odd.
 */
export function captureAllegroLot(doc: Document, url: string): CaptureResult {
  const offerId = allegroOfferId(url) ?? offerIdFromLd(doc);
  if (!offerId) {
    return {
      ok: false,
      reason: "not-a-listing",
      message: "This page carries no Allegro offer number. Open the auction's own page and try again.",
    };
  }

  const bidding = findBiddingSection(doc);
  const endingDate = bidding && typeof bidding.endingDate === "string" ? bidding.endingDate : null;
  if (!bidding || bidding.visible !== true || !endingDate) {
    return {
      ok: false,
      reason: "not-an-auction",
      message:
        "This is a fixed-price offer, not an auction. Only lots that are being bid on are tracked — buy it and record it as a purchase instead.",
    };
  }

  const bidderCount = parseAllegroBidderCount(bidding.popularityLabel);
  const amount = parseAllegroAmount(bidding.currentPrice?.formatted);
  const currency =
    typeof bidding.currentPrice?.currency === "string" ? bidding.currentPrice.currency : null;
  const ld = findLdProduct(doc);

  const lot: CapturedLot = {
    platformOfferId: offerId,
    url: allegroListingUrl(offerId),
    title: typeof ld?.name === "string" && ld.name.trim() ? ld.name.trim() : null,
    // Allegro's *Numer oferty* is the only number printed on a listing, and it is what a collector
    // quotes when they refer to one — so it fills the lot's own number, exactly as a house sale's
    // lot number would.
    lotNo: offerId,
    sellerName: findSellerName(doc),
    endsAt: endingDate,
    startingPrice: bidderCount ? null : amount,
    currentBid: bidderCount ? amount : null,
    currency,
    bidderCount,
  };
  return { ok: true, lot };
}

/** The offer id as the JSON-LD states it, for a page reached by an address we could not read one
 *  from. Deliberately a fallback: the URL is where a listing's identity is normally written. */
function offerIdFromLd(doc: Document): string | null {
  const sku = findLdProduct(doc)?.sku;
  return typeof sku === "string" && /^\d+$/.test(sku) ? sku : null;
}
