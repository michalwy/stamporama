import type { SearchField } from "./search-fields";

// The fields the Issues list's search box can be narrowed to (#2239) — what the box searched before
// it could be narrowed, named as the collector knows them. `buildIssueListWhere` reads them, and the
// row's own match (`issue-stamp-match.ts`) does too; only the Issues list sends them, so the agent
// API and the stamp picker keep searching every field.
//
// Pure, and apart from `issues.ts`, so the client can name the fields without importing Prisma.

export const ISSUE_SEARCH_FIELDS = [
  { key: "issueNumber", label: "Issue number" },
  { key: "issueName", label: "Issue name" },
  { key: "stampName", label: "Stamp name" },
  { key: "catalogNumber", label: "Catalogue number" },
] as const satisfies readonly SearchField[];

export type IssueSearchField = (typeof ISSUE_SEARCH_FIELDS)[number]["key"];

export const ISSUE_SEARCH_FIELD_KEYS: readonly IssueSearchField[] = ISSUE_SEARCH_FIELDS.map(
  (f) => f.key
);
