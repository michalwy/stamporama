import type { PlatformModule } from "../module";
import { extractColnect, matchesColnectUrl } from "./parse";
import { colnectListing } from "./listing";
import { matchesColnectTransactionUrl, readColnectOrders } from "./orders";

// The Colnect platform module (#249): the first module plugged into the neutral shell (#253), and
// the one that carries every half a catalogue-and-shop marketplace has — DOM extraction
// (`parse.ts`, #408), listing (`listing.ts`, #408) and, since #698, the far end of a sale
// (`orders.ts`): Colnect's own transaction screens, read for the order the collector is packing.
// None of them knows anything about profiles or matching. It carries no capture half (#355):
// Colnect is a shop, and its sales are not bid on.
export const colnectModule: PlatformModule = {
  id: "colnect",
  name: "Colnect",
  extraction: { matches: matchesColnectUrl, extract: extractColnect },
  listing: colnectListing,
  orders: { matches: matchesColnectTransactionUrl, read: readColnectOrders },
};
