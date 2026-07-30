import type { ExtractedItem } from "./types";
import type { PlatformListing } from "./listing";

// The interface a marketplace-specific module implements to plug into the neutral shell. Colnect is
// the first module (#249); Delcampe/Allegro/… can follow.
//
// A module has **two halves** (#408). Extraction is pure DOM → data: it declares which pages it
// handles and extracts structured refs, with no knowledge of profiles or matching. Listing is the
// symmetric second half — navigate to a sale form, fill it from a neutral listing task, stop before
// submit — and it is **optional**: a module that only reads a marketplace is a complete module, and
// the platform it serves simply offers no **List via Assistant** (#407).
export interface PlatformModule {
  /** Stable id, e.g. "colnect". Also what `Contact.platformModule` stores (#406). */
  id: string;
  /** Human-facing name, e.g. "Colnect". */
  name: string;
  /** True when this module can extract from the given page URL. */
  matches(url: string): boolean;
  /** Extract every item on the page. Pure; throws only on unexpected DOM. */
  extract(doc: Document): ExtractedItem[];
  /** How this module posts a listing, when it can (#408/#410). Absent = extraction only. */
  listing?: PlatformListing;
}

/** A module that carries the listing half, with `listing` narrowed to present. */
export type ListingCapableModule = PlatformModule & { listing: PlatformListing };

/** True when `module` can list, and narrows it. The one place the optional half is tested, so the
 *  shell never reads `module.listing?.` and quietly does nothing. */
export function canList(module: PlatformModule): module is ListingCapableModule {
  return module.listing !== undefined;
}
