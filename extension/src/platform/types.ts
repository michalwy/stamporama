// Shared data shapes between a platform module (extractor) and the matching client. Deliberately
// aligned with the Stamporama matcher endpoint's request/response (#250) so no translation is needed.

/** One catalog reference printed on a marketplace page: a catalog abbreviation and its number. The
 *  number may carry a country/area prefix verbatim (e.g. "PL 200") — the server folds it. */
export interface CatalogRef {
  catalog: string;
  number: string;
}

/** The six attributes a Colnect catalogue page prints about a stamp (#71/#739), as printed. Keyed
 *  exactly as the instance names them, so nothing translates on the way. */
export interface ExtractedAttributes {
  denomination?: string;
  perforation?: string;
  color?: string;
  watermark?: string;
  paper?: string;
  printing?: string;
}

/** One item extracted from a marketplace page. `platformItemId` becomes the stamp's Colnect ID. */
export interface ExtractedItem {
  platformItemId: string;
  name?: string;
  catalogRefs: CatalogRef[];
  /** The date of issue as the page prints it — `"1945-01-22"`, `"1945-01"` or `"1945"` (#655).
   *  Sent verbatim: the instance parses it and decides what it means for the stamp it matched. */
  issuedOn?: string;
  /**
   * What the page states about the stamp itself (#739), each value **verbatim**: its denomination
   * and perforation as printed, and the colour, watermark, paper and printing method as Colnect
   * words. The instance decides what they mean — the four dictionary ones through the collection's
   * own mapping — for the same reason `issuedOn` travels unparsed: two readings of one page is one
   * too many.
   *
   * Absent on a page that states none, and on a card that carries none. An attribute the page omits
   * is **not** a statement that the stamp has none, so it is left out rather than sent as empty.
   */
  attributes?: ExtractedAttributes;
  /** Issuing country, when stated. The counterpart of our collecting area, near enough to compare. */
  country?: string;
  /** Absolute URL of the card's thumbnail as found in the page, when it has one. */
  imageUrl?: string;
  /** The thumbnail re-encoded as a `data:` URL, captured from the already-rendered image in the
   *  page. Preferred over {@link imageUrl} for display: the extension page is a different origin,
   *  where hotlinking may be refused. Absent when capture wasn't possible (see the content script). */
  imageData?: string;
}
