import type { PlatformModule } from "../module";
import { allegroListing } from "./listing";
import { allegroOfferId, captureAllegroLot, matchesAllegroListingUrl } from "./parse";

// The Allegro platform module (#355) — the first to carry the **capture** half, and the first to
// carry only one half at all.
//
// It has no extraction half: Allegro is not a catalogue to match our stamps against, and reading a
// seller's own numbering off a listing title is exactly the guess the matcher exists to avoid. What
// capture is for is the other direction: one auction the collector is bidding on, read off its page
// so that watching it does not mean retyping four fields.
//
// It gained a **listing** half in #493, and for a reason particular to this marketplace: Allegro has
// an API that publishes offers (#477) and refuses to do so for a private account, so the form its own
// sellers use is the path that works. The two sit side by side and neither replaces the other.
//
// The capture half also answers what a listing *is* from its address alone (`listingId`, #466),
// which is how a page the collector is **selling** on gets its link back to the offer here: the same
// id, asked of the instance instead of written into a lot.
export const allegroModule: PlatformModule = {
  id: "allegro",
  name: "Allegro",
  capture: {
    isListingUrl: matchesAllegroListingUrl,
    listingId: allegroOfferId,
    capture: captureAllegroLot,
  },
  listing: allegroListing,
};
