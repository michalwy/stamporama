import type { PlatformModule } from "../module";
import { capturePhilasearchLot, matchesPhilasearchLotUrl, philasearchLotId } from "./parse";

// The Philasearch platform module (#742) — the second to carry the **capture** half, and like
// Allegro's first version it carries nothing else: Philasearch is where this collection bids on
// houses' lots, not a catalogue to match against or a shop to list into.
//
// What differs from Allegro is what a lot page can state. A house's sale takes written bids, so the
// page shows the opening figure and the collector's own bid, never a standing one — which is why
// `figures` says so, and why the parcel is the house's named sale rather than a seller's basket.
export const philasearchModule: PlatformModule = {
  id: "philasearch",
  name: "Philasearch",
  capture: {
    isListingUrl: matchesPhilasearchLotUrl,
    listingId: philasearchLotId,
    capture: capturePhilasearchLot,
    figures: { currentBid: false, myBid: true },
  },
};
