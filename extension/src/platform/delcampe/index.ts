import type { PlatformModule } from "../module";
import { matchesDelcampeSoldItemsUrl, readDelcampeOrders } from "./orders";

// The Delcampe platform module (#612) — the first to carry the **orders** half, and the first to
// carry only that.
//
// Everything else Delcampe needs from this app already happens inside it. There is no listing half
// because Delcampe is listed to by uploading a CSV this app writes (#610), not by an extension
// filling a form — which is exactly why `Contact.platformModule` naming Delcampe (#608) has always
// been a marker rather than a promise about listing (#471). There is no extraction half, Delcampe
// being a marketplace rather than a catalogue to match our stamps against, and no capture half:
// these are the collector's own sales, not somebody else's auctions to bid on.
//
// What was missing is the far end of a sale. #611 reads Delcampe's active-items export and learns
// every listing's own id, and a listing that later drops out of that file has come down — sold,
// ended, or pulled, which the file does not say. The order screens do, and they are where the
// collector already is when they pack the parcel.
export const delcampeModule: PlatformModule = {
  id: "delcampe",
  name: "Delcampe",
  orders: {
    matches: matchesDelcampeSoldItemsUrl,
    read: readDelcampeOrders,
  },
};
