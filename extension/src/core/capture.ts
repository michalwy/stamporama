// The instance's answer to a captured lot (#355), mirrored by hand exactly as `decisions.ts` mirrors
// the matcher response — the extension is a separate build with no import path into the app.
//
// What the window shows is this object twice: once as a **preview** (`dryRun`, before the collector
// presses Save) and once as the **outcome**. Both come out of the same server function, so the
// preview can never describe something the save would not do.

export interface CaptureOutcome {
  /** `created` wrote a new lot; `refreshed` found the lot already tracking this listing and
   *  re-recorded its bid. */
  outcome: "created" | "refreshed";
  /** Null in a preview of a `created` — nothing exists yet. */
  lotId: string | null;
  saleId: string | null;
  /** The parcel this lot belongs to, named as the collection names it. */
  saleName: string;
  saleCurrency: string;
  /** True when this capture starts the seller's parcel rather than joining an open one. */
  saleCreated: boolean;
  sellerId: string | null;
  sellerName: string;
  /** True when the page's seller matches no contact of the collection and one is created for them. */
  sellerCreated: boolean;
  platformName: string;
  /** What the lot carried before a refresh, so the window can say whether the price moved. */
  previousBid: string | null;
}
