import type { PlatformModule } from "../module";
import { captureAllegroLot, matchesAllegroListingUrl } from "./parse";

// The Allegro platform module (#355) — the first to carry the **capture** half, and the first to
// carry only one half at all.
//
// It has no extraction half: Allegro is not a catalogue to match our stamps against, and reading a
// seller's own numbering off a listing title is exactly the guess the matcher exists to avoid. It
// has no listing half either — nothing here posts a sale to Allegro. What it is for is the other
// direction: one auction the collector is bidding on, read off its page so that watching it does not
// mean retyping four fields.
export const allegroModule: PlatformModule = {
  id: "allegro",
  name: "Allegro",
  capture: {
    isListingUrl: matchesAllegroListingUrl,
    capture: captureAllegroLot,
  },
};
