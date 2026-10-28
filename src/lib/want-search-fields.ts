import type { SearchField } from "./search-fields";

// The fields the Want list's search box can be narrowed to (#2241, on #2238's control) — what the
// box searched before it could be narrowed, named as on the Copies list where the two share a field.
// `buildWantListWhere` reads them; only the Want list sends them, so every other caller keeps
// searching every field.
//
// Pure, and apart from `wants.ts` (which is `server-only`), so the client can name the fields.

export const WANT_SEARCH_FIELDS = [
  { key: "stampName", label: "Stamp name" },
  { key: "issueName", label: "Issue name" },
  { key: "catalogNumber", label: "Catalogue number" },
  { key: "note", label: "Note" },
] as const satisfies readonly SearchField[];

export type WantSearchField = (typeof WANT_SEARCH_FIELDS)[number]["key"];

export const WANT_SEARCH_FIELD_KEYS: readonly WantSearchField[] = WANT_SEARCH_FIELDS.map(
  (f) => f.key
);
