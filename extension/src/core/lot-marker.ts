// The link from a marketplace listing back to the **auction lot** it is here (#575).
//
// The buying-side twin of #466's offer marker, and the same act for the opposite reason. There the
// collector is standing on a listing they are *selling* and wants its offer; here they are standing
// on an auction they are *bidding on* and want the lot — its ceiling, its composition, what they
// have already placed. Without it the only route is reading the title off Allegro and hunting the
// watchlist for it, which is exactly the moment before a bid when there is no time for that.
//
// It is a **link drawn into the page** rather than something the toolbar click offers, for #466's
// reasons twice over: that click already means *capture this as an auction lot* (#355), and this is
// the answer that decides whether to click it at all — a listing already tracked is captured again
// only to refresh its bid, and one that is not is a new lot. Knowing which is most of the value, and
// it has to be there before any click.
//
// Only one shape, unlike the offer side: a **listing page**, which is one auction. There is no
// buying-side counterpart to the seller's own assortment table — a list of auctions on Allegro is a
// search result full of strangers' listings, where a mark on the two the collector happens to track
// would be answering a question nobody asked, on markup the site rebuilds as you type.
//
// Which listing the page is about is read from its address by the capture module (#355), so nothing
// here names Allegro; whether that listing is a lot of ours is the **instance's** answer, since a
// listing being bid on and one being sold are the same URL and the same markup.
//
// Pure DOM: no `chrome.*`, so it is unit-tested against `linkedom` like the platform modules.

import { CHIP_STYLE, markerStack, pruneMarkerStack } from "./marker-shell";

/** Marks the chip, so a re-run replaces it instead of stacking a second one on the page. */
const MARKER_ATTR = "data-stamporama-lot";

/**
 * How a lot's derived outcome (ADR-0021 §4) is worded, mirrored by hand from
 * `AUCTION_LOT_OUTCOME_LABEL` as `core/decisions.ts` mirrors the matcher's answer and the search
 * window mirrors the inventory's disposition chips (#550) — the extension is a separate build with
 * no import path into the app, and a chip that read `pending` where every screen in Stamporama says
 * *Open* would be a second vocabulary for one fact.
 *
 * An outcome this build has never heard of is printed as it arrived rather than dropped: a word the
 * app added is still better than a chip that silently says nothing about how the lot ended.
 */
const OUTCOME_LABEL: Record<string, string> = {
  pending: "Open",
  won: "Won",
  lost: "Lost",
  observed: "Observed",
  cancelled: "Cancelled",
};

/** The lot as the page should name it. Every field comes from the instance's own answer — the page
 *  is told what its listing is, and states none of it itself. */
export interface LotMarkerTarget {
  /** Absolute address of the lot on the instance the extension is connected to — its sale's screen,
   *  focused on the lot, a lot having no page of its own. */
  url: string;
  /** The lot's own short number (#432) — what the chip leads with, as the offer chip leads with the
   *  offer's, because it is what the collector quotes and what the quick-jump box takes. */
  auctionLotNo: number;
  title: string;
  /** The parcel the lot sits in, which on a marketplace is the seller's open sale (#352). */
  saleName: string;
  /** How the bidding went — `pending` while the lot is still open. Shown because a listing may be
   *  re-read long after it closed, and "the lot you lost" is a different answer from "the lot you
   *  are bidding on". */
  outcome: string;
}

/** Remove the chip, if this document carries one. Exported for the re-render path and for a page
 *  whose listing stops matching. */
export function removeLotMarker(doc: Document): void {
  for (const existing of Array.from(doc.querySelectorAll(`[${MARKER_ATTR}]`))) existing.remove();
  pruneMarkerStack(doc);
}

/**
 * Draw the chip into `doc`, replacing any previous one, and return it.
 *
 * It hangs in the shared corner stack (`marker-shell.ts`) and wears the offer chip's own shape: the
 * two are the same kind of statement about the same listing — *this one is already something here* —
 * and what differs is only what it turns out to be. Returns null when there is no body to attach to,
 * a document being parsed being a normal thing to be handed.
 */
export function renderLotMarker(
  doc: Document,
  target: LotMarkerTarget,
  iconUrl: string | null
): HTMLAnchorElement | null {
  removeLotMarker(doc);
  const stack = markerStack(doc);
  if (!stack) return null;

  const outcome = OUTCOME_LABEL[target.outcome] ?? target.outcome;

  const a = doc.createElement("a");
  a.setAttribute(MARKER_ATTR, "");
  a.href = target.url;
  a.title = `${target.title} — ${target.saleName} — open in Stamporama`;
  // A new tab, always: the auction the collector is reading is the page they came from and will bid
  // on, and navigating it away to look the lot up loses their place with the clock running.
  a.target = "_blank";
  a.rel = "noreferrer noopener";
  a.style.cssText = CHIP_STYLE;

  if (iconUrl) {
    const img = doc.createElement("img");
    img.src = iconUrl;
    img.alt = "";
    img.width = 16;
    img.height = 16;
    img.style.cssText = "flex: none; width: 16px; height: 16px";
    a.appendChild(img);
  }

  const text = doc.createElement("span");
  text.style.cssText = "display: block; min-width: 0";

  const head = doc.createElement("span");
  head.style.cssText = "display: block; font-weight: 600";
  head.textContent = `Lot #${target.auctionLotNo} · ${outcome}`;

  // The sale rather than the lot's title: the title is what the page in front of the collector
  // already says, while which parcel this lands in is the fact only Stamporama holds — and it is
  // what tells one watched auction from another when several are up from the same seller.
  const name = doc.createElement("span");
  name.style.cssText =
    "display: block; color: #4b5563; overflow: hidden; text-overflow: ellipsis; white-space: nowrap";
  name.textContent = target.saleName;

  text.appendChild(head);
  text.appendChild(name);
  a.appendChild(text);
  stack.appendChild(a);
  return a;
}
