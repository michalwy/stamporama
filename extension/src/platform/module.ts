import type { ExtractedItem } from "./types";
import type { PlatformListing } from "./listing";
import type { PlatformCapture } from "./capture";
import type { PlatformOrders } from "./orders";

// The interface a marketplace-specific module implements to plug into the neutral shell. Colnect is
// the first module (#249); Delcampe/Allegro/… follow.
//
// A module is a set of **halves**, each optional, because a marketplace is worth different things to
// a collector and none is worth all of them:
//
//   • **extraction** (#249) — a catalogue page read for the stamps on it, to match against ours;
//   • **listing** (#408) — a sale form navigated to and filled, stopping before submit;
//   • **capture** (#355) — one auction page read as the lot it is, for the watchlist;
//   • **orders** (#612) — a marketplace's own seller screens read for the orders on them.
//
// A module carrying only one of them is a **complete** module, and the surface that wanted another
// simply does not offer it: a read-only marketplace offers no **List via Assistant** (#407), and one
// that is only ever bid on — Allegro — is never asked to match a catalogue or to post a sale. Which
// module carries which half is `moduleReports()`, so no surface hard-codes ids.
export interface PlatformModule {
  /** Stable id, e.g. "colnect". Also what `Contact.platformModule` stores (#406/#355). */
  id: string;
  /** Human-facing name, e.g. "Colnect". */
  name: string;
  /** How this module reads a catalogue page, when it does. Absent = not a marketplace we match
   *  stamps against. */
  extraction?: PlatformExtraction;
  /** How this module posts a listing, when it can (#408/#410). */
  listing?: PlatformListing;
  /** How this module reads one auction listing for the watchlist (#355). */
  capture?: PlatformCapture;
  /** How this module reads the seller's own sold orders (#612). Absent = a marketplace whose sales
   *  are recorded here by hand. */
  orders?: PlatformOrders;
}

/** The extraction half: pure DOM → data, with no knowledge of profiles or matching. */
export interface PlatformExtraction {
  /** True when this module can extract from the given page URL. */
  matches(url: string): boolean;
  /** Extract every item on the page. Pure; throws only on unexpected DOM. */
  extract(doc: Document): ExtractedItem[];
}

/** A module that carries the extraction half, narrowed. */
export type ExtractionCapableModule = PlatformModule & { extraction: PlatformExtraction };
/** A module that carries the listing half, with `listing` narrowed to present. */
export type ListingCapableModule = PlatformModule & { listing: PlatformListing };
/** A module that carries the capture half, narrowed. */
export type CaptureCapableModule = PlatformModule & { capture: PlatformCapture };
/** A module that carries the orders half, narrowed. */
export type OrdersCapableModule = PlatformModule & { orders: PlatformOrders };

/** True when `module` can read a catalogue page, and narrows it. */
export function canExtract(module: PlatformModule): module is ExtractionCapableModule {
  return module.extraction !== undefined;
}

/** True when `module` can list, and narrows it. These four are the only places an optional half is
 *  tested, so the shell never reads `module.listing?.` and quietly does nothing. */
export function canList(module: PlatformModule): module is ListingCapableModule {
  return module.listing !== undefined;
}

/** True when `module` can capture a lot, and narrows it. */
export function canCapture(module: PlatformModule): module is CaptureCapableModule {
  return module.capture !== undefined;
}

/** True when `module` can read a seller's own orders, and narrows it (#612). */
export function canReadOrders(module: PlatformModule): module is OrdersCapableModule {
  return module.orders !== undefined;
}
