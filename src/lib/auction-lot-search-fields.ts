import type { SearchField } from "./search-fields";

// The fields the auction lot list's search box can be narrowed to (#2244, the control #2238 built)
// — what the box searched before it could be narrowed (#484), named as the collector knows them.
// `lotSearchWhere` reads them; only the lot list sends them, so the agent API keeps searching every
// field.
//
// Pure, and apart from `auctions.ts`, so the client can name the fields without importing Prisma.

export const AUCTION_LOT_SEARCH_FIELDS = [
  { key: "titleNotes", label: "Title and notes" },
  { key: "houseLotNo", label: "House lot number" },
  { key: "listingUrl", label: "Listing address" },
  { key: "lotNo", label: "Lot number" },
  { key: "sale", label: "Sale, seller, platform" },
] as const satisfies readonly SearchField[];

export type AuctionLotSearchField = (typeof AUCTION_LOT_SEARCH_FIELDS)[number]["key"];

export const AUCTION_LOT_SEARCH_FIELD_KEYS: readonly AuctionLotSearchField[] =
  AUCTION_LOT_SEARCH_FIELDS.map((f) => f.key);
