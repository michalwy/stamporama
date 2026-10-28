import type { SearchField } from "./search-fields";

// The fields the auction Sales list's search box can be narrowed to (#2245) — what the box searched
// before it could be narrowed (#484), named as the collector knows them. `saleSearchWhere` reads
// them; only the Sales list sends them.
//
// Seller and platform are two fields, not one: they are two parties, and a seller whose name holds
// the platform's (or the other way round) is exactly the match the ticks exist to leave out.
//
// Pure, and apart from `auctions.ts`, so the client can name the fields without importing Prisma.

export const AUCTION_SALE_SEARCH_FIELDS = [
  { key: "name", label: "Sale name" },
  { key: "url", label: "Catalogue URL" },
  { key: "seller", label: "Seller" },
  { key: "platform", label: "Platform" },
] as const satisfies readonly SearchField[];

export type AuctionSaleSearchField = (typeof AUCTION_SALE_SEARCH_FIELDS)[number]["key"];

export const AUCTION_SALE_SEARCH_FIELD_KEYS: readonly AuctionSaleSearchField[] =
  AUCTION_SALE_SEARCH_FIELDS.map((f) => f.key);
