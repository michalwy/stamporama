// Shared data shapes between a platform module (extractor) and the matching client. Deliberately
// aligned with the Stamporama matcher endpoint's request/response (#250) so no translation is needed.

/** One catalog reference printed on a marketplace page: a catalog abbreviation and its number. The
 *  number may carry a country/area prefix verbatim (e.g. "PL 200") — the server folds it. */
export interface CatalogRef {
  catalog: string;
  number: string;
}

/** One item extracted from a marketplace page. `platformItemId` becomes the stamp's Colnect ID. */
export interface ExtractedItem {
  platformItemId: string;
  name?: string;
  catalogRefs: CatalogRef[];
  /** The date of issue as the page prints it — `"1945-01-22"`, `"1945-01"` or `"1945"` (#655).
   *  Sent verbatim: the instance parses it and decides what it means for the stamp it matched. */
  issuedOn?: string;
  /** Issuing country, when stated. The counterpart of our collecting area, near enough to compare. */
  country?: string;
  /** Absolute URL of the card's thumbnail as found in the page, when it has one. */
  imageUrl?: string;
  /** The thumbnail re-encoded as a `data:` URL, captured from the already-rendered image in the
   *  page. Preferred over {@link imageUrl} for display: the extension page is a different origin,
   *  where hotlinking may be refused. Absent when capture wasn't possible (see the content script). */
  imageData?: string;
}
