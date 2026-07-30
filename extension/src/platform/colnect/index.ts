import type { PlatformModule } from "../module";
import { extractColnect, matchesColnectUrl } from "./parse";
import { colnectListing } from "./listing";

// The Colnect platform module (#249): the first module plugged into the neutral shell (#253), and
// the first to carry both halves (#408) — DOM extraction (`parse.ts`) and listing (`listing.ts`).
// Neither knows anything about profiles or matching.
export const colnectModule: PlatformModule = {
  id: "colnect",
  name: "Colnect",
  matches: matchesColnectUrl,
  extract: extractColnect,
  listing: colnectListing,
};
