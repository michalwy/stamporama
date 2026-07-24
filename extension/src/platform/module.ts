import type { ExtractedItem } from "./types";

// The interface a marketplace-specific module implements to plug into the neutral shell. Colnect is
// the first module (#249); Delcampe/Allegro/… can follow. A module is pure DOM → data: it declares
// which pages it handles and extracts structured refs, with no knowledge of profiles or matching.
export interface PlatformModule {
  /** Stable id, e.g. "colnect". */
  id: string;
  /** Human-facing name, e.g. "Colnect". */
  name: string;
  /** True when this module can extract from the given page URL. */
  matches(url: string): boolean;
  /** Extract every item on the page. Pure; throws only on unexpected DOM. */
  extract(doc: Document): ExtractedItem[];
}
