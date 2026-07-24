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
}
