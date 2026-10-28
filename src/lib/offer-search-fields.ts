import type { SearchField } from "./search-fields";

// The fields the Offers list's search box can be narrowed to (#2242) — what the box searched before
// it could be narrowed (#465), named as the collector knows them. `offerSearchWhere` reads them;
// only the Offers list sends them, so every other way into the search keeps matching every field.
//
// Pure, and apart from `offers.ts`, so the client can name the fields without importing Prisma.

export const OFFER_SEARCH_FIELDS = [
  { key: "title", label: "Title" },
  { key: "offerNumber", label: "Offer number" },
  { key: "catalogNumber", label: "Catalogue number" },
  { key: "locationRef", label: "Location ref" },
  { key: "listingUrl", label: "Listing URL" },
] as const satisfies readonly SearchField[];

export type OfferSearchField = (typeof OFFER_SEARCH_FIELDS)[number]["key"];

export const OFFER_SEARCH_FIELD_KEYS: readonly OfferSearchField[] = OFFER_SEARCH_FIELDS.map(
  (f) => f.key
);
