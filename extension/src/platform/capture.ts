// The **capture** half of a platform module (#355, part of #155).
//
// Extraction (#249/#253) reads a marketplace's *catalogue* pages — many stamps, each a set of
// printed catalog numbers to match against ours. Listing (#408/#410) writes a sale form. Capture is
// the third thing a marketplace page can be worth: **one listing the collector is bidding on**, read
// so that watching it does not mean retyping a URL, a title, a number, a closing time and a price.
//
// It is a half of its own rather than a shape of `extract` because the two answer different
// questions and produce different things — "which stamps are on this page" against "what is this
// one lot" — and because a module may well carry either without the other. Allegro is the first
// module to carry capture, and carries neither of the others: it is a marketplace this collection
// buys on, not a catalogue to match against or a shop to list into. That is a complete module.
//
// Like the other halves, it is **pure DOM → data**: no profiles, no instance calls, no `chrome.*`.
// Where the captured lot goes — which platform, which seller, which parcel — is the instance's
// decision (`captureAuctionLot`), because every part of that answer is a `Contact` of a collection
// the marketplace knows nothing about.

/** One auction listing, as a marketplace page states it. Deliberately the shape of the instance's
 *  own capture endpoint (#355), mirrored by hand exactly as `core/decisions.ts` mirrors the matcher
 *  response — the extension is a separate build with no import path into the app. */
export interface CapturedLot {
  /** The marketplace's own id for the listing. What makes a second capture of the same auction a
   *  bid refresh rather than a duplicate lot, since it survives slugs, redirects and share links. */
  platformOfferId: string;
  /** The address to record, as the module decided to write it — query strings and tracking
   *  parameters are not part of a listing's identity, and it is the module that knows which part of
   *  what the browser shows is the record. */
  url: string;
  title: string | null;
  /**
   * The marketplace's own number for this listing, as a collector would quote it — Allegro prints it
   * as *Numer oferty*. It is the same digits as {@link platformOfferId}, and it is carried twice on
   * purpose: one is the listing's **identity**, matched on and never shown, and the other is a
   * **number on a lot**, displayed and editable like any other. A house sale's lot number occupies
   * the same field, which is what makes the watchlist read the same however a lot got there.
   */
  lotNo: string | null;
  /** The seller as printed on the page. It is a *proposal*: the instance resolves it against the
   *  collection's own contacts, and the collector can correct it before anything is written, because
   *  the name a marketplace shows is not reliably the contact they trade under. */
  sellerName: string | null;
  /** When bidding closes, as an ISO instant. Required — a watchlist is ordered and aged against it,
   *  and it is the one field a lot cannot be honestly invented without. */
  endsAt: string;
  /** What the listing opened at, when the page says so and nobody has bid yet. A record, never a
   *  cost: a lot nobody has bid on costs nothing whatever it opens at. */
  startingPrice: string | null;
  /** What it stands at, once somebody has bid. Null and `startingPrice` set are the same page in its
   *  two states, and the pair is never both. */
  currentBid: string | null;
  /** The currency the figures are printed in, for the window to show beside them. The lot's own
   *  currency is the sale's (#350) and is not decided here. */
  currency: string | null;
  /** How many bidders the page reports, when it says. Shown to the collector as the reason the
   *  figure was read as a bid rather than as an opening price. */
  bidderCount: number | null;
}

/** Why a page a module handles nonetheless yields no lot. Each is a sentence the collector reads in
 *  the capture window, so each names what is true of the page rather than what the parser did. */
export interface CaptureRefusal {
  reason: "not-a-listing" | "not-an-auction" | "incomplete";
  message: string;
}

export type CaptureResult = { ok: true; lot: CapturedLot } | { ok: false } & CaptureRefusal;

/** The capture half of a module: recognise a listing page, and read the one lot it is about. */
export interface PlatformCapture {
  /** True when `url` is a page this module can read a single listing from. Broader than the
   *  extraction half's `matches`: a marketplace's offer pages and its catalogue pages are different
   *  parts of one site, and a module may handle only one of them. */
  isListingUrl(url: string): boolean;
  /**
   * The marketplace's own id for the listing `url` names, from the address alone — the same value
   * {@link CapturedLot.platformOfferId} carries, read without the page.
   *
   * It is its own method rather than a by-product of {@link PlatformCapture.capture} because the
   * two are asked at different moments: the capture reads a page the collector clicked the toolbar
   * on, while "which listing is this?" is asked *as the page loads*, before anything has been
   * clicked and whatever the page turns out to be. A fixed-price offer — which capture refuses, and
   * which is exactly what the collector's own listings usually are (#466) — still has an id.
   *
   * Null when the address states none, which is not an error: a listing reached through a form post
   * or a shortened link is simply not identifiable from its URL.
   */
  listingId(url: string): string | null;
  /**
   * Read the listing in `doc`, or say why there is none to read.
   *
   * A refusal is a normal outcome, not an error: a fixed-price offer is a perfectly good page that
   * is simply not a lot to bid on, and telling the collector that is more use than a lot with an
   * invented closing time. Throws only on unexpected DOM.
   */
  capture(doc: Document, url: string): CaptureResult;
}
