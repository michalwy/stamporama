import type { SearchField } from "./search-fields";

// The fields the Sales list's search box can be narrowed to (#2243, on #2238's control) — what the
// box searched before it could be narrowed (#193), named as the collector knows them. The sold
// copies' stamp name and catalogue number are two fields, as on the Copies list. `saleSearchWhere`
// reads them; only the Sales list sends them.
//
// Pure, and apart from `sales.ts`, so the client can name the fields without importing Prisma.

export const SALE_SEARCH_FIELDS = [
  { key: "buyer", label: "Buyer" },
  { key: "platform", label: "Platform" },
  { key: "orderNumber", label: "Order number" },
  { key: "stampName", label: "Stamp name" },
  { key: "catalogNumber", label: "Catalogue number" },
] as const satisfies readonly SearchField[];

export type SaleSearchField = (typeof SALE_SEARCH_FIELDS)[number]["key"];

export const SALE_SEARCH_FIELD_KEYS: readonly SaleSearchField[] = SALE_SEARCH_FIELDS.map(
  (f) => f.key
);
