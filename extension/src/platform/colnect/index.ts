import type { PlatformModule } from "../module";
import { extractColnect, matchesColnectUrl } from "./parse";
import { colnectListing } from "./listing";

// The Colnect platform module (#249): the first module plugged into the neutral shell (#253), and
// the one that carries both of the halves a catalogue-and-shop marketplace has (#408) — DOM
// extraction (`parse.ts`) and listing (`listing.ts`). Neither knows anything about profiles or
// matching. It carries no capture half (#355): Colnect is a shop, and its sales are not bid on.
export const colnectModule: PlatformModule = {
  id: "colnect",
  name: "Colnect",
  extraction: { matches: matchesColnectUrl, extract: extractColnect },
  listing: colnectListing,
};
