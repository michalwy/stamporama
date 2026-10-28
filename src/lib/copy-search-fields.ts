import type { SearchField } from "./search-fields";

// The fields the Copies list's search box can be narrowed to (#2238) — what the box searched before
// it could be narrowed, named as the collector knows them. `buildItemWhere` reads them; only the
// Copies list sends them, so the agent API, the pickers and quick-jump keep searching every field.
//
// Pure, and apart from `items.ts`, so the client can name the fields without importing Prisma.

export const COPY_SEARCH_FIELDS = [
  { key: "stampName", label: "Stamp name" },
  { key: "issueName", label: "Issue name" },
  { key: "catalogNumber", label: "Catalogue number" },
  { key: "locationRef", label: "Location ref" },
  { key: "copyNumber", label: "Copy number" },
] as const satisfies readonly SearchField[];

export type CopySearchField = (typeof COPY_SEARCH_FIELDS)[number]["key"];

export const COPY_SEARCH_FIELD_KEYS: readonly CopySearchField[] = COPY_SEARCH_FIELDS.map(
  (f) => f.key
);
