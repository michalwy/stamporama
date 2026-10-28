import type { SearchField } from "./search-fields";

// The fields the Stamps list's search box can be narrowed to (#2240) — what the box searched before
// it could be narrowed, named as the collector knows them. `buildStampListWhere` reads them; only the
// Stamps list sends them, so the pickers and every other way into a stamp search keep every field.
//
// Pure, and apart from `stamps.ts`, so the client can name the fields without importing Prisma.

export const STAMP_SEARCH_FIELDS = [
  { key: "stampName", label: "Stamp name" },
  { key: "issueName", label: "Issue name" },
  { key: "catalogNumber", label: "Catalogue number" },
  { key: "denomination", label: "Denomination" },
  { key: "perforation", label: "Perforation" },
] as const satisfies readonly SearchField[];

export type StampSearchField = (typeof STAMP_SEARCH_FIELDS)[number]["key"];

export const STAMP_SEARCH_FIELD_KEYS: readonly StampSearchField[] = STAMP_SEARCH_FIELDS.map(
  (f) => f.key
);
