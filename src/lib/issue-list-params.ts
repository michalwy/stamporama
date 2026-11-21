import { CATALOG_SCOPE_PARAM, parseCatalogScope } from "./catalog-search-scope";
import { readYearFilter } from "./list-area-year-filter";
import { appendTagFilterParams, tagFilterFromParams, type TagFilterOpts } from "./tag-filter";
import {
  appendIssueFormatParam,
  ISSUE_FORMAT_FILTER_PARAM,
  parseIssueFormatIds,
} from "./issue-format-filter";
import { parseSearchFields, readListSearchParams, SEARCH_FIELDS_PARAM } from "./search-fields";
import { ISSUE_SEARCH_FIELD_KEYS, type IssueSearchField } from "./issue-search-fields";

// Which issues the Issues list is showing, as a query string — written by the screen, read by the
// server, in one module so the two cannot spell a filter two ways (#2664).
//
// The list's own route reads its rows through it, and so does the run that wants everything missing
// across the issues the list shows: that run is promised to cover *the issues the list currently
// shows*, and the one way to keep that promise is for both to be handed the same string and to read
// it with the same function. Only the narrowing travels here — paging, sort and the price column
// change how the rows are drawn, never which rows there are.

/** The narrowing of the Issues list, as the screen holds it. */
export interface IssueListScope extends TagFilterOpts {
  /** The selected area with its sub-areas, as the list includes them. */
  areaIds?: string[];
  /** The search box's text, double quotes included (#2545) — the reader takes them off. */
  search?: string;
  /** Vendor + bare number parsed out of the search text (#289). */
  searchCatalogVendorId?: string;
  searchCatalogNumber?: string;
  /** The fields the search box matches (#2239); absent is every field. */
  searchFields?: IssueSearchField[];
  catalogVendorId?: string;
  catalogNumber?: string;
  /** The catalogues a number is searched in (#2529); absent is every one. */
  catalogScope?: string[];
  /** The issue format filter (#2440). */
  issueFormatIds?: string[];
  /** One year, "none", or a span (#2258), as the year rail writes it. */
  year?: string;
}

/** The narrowing read back, in the shape `IssueListFilterOpts` takes it. */
export interface IssueListScopeOpts extends TagFilterOpts {
  areaIds?: string[];
  search?: string;
  searchExact?: true;
  searchCatalogVendorId?: string;
  searchCatalogNumber?: string;
  searchFields?: IssueSearchField[];
  catalogVendorId?: string;
  catalogScope?: string[];
  catalogNumber?: string;
  issueFormatIds?: string[];
  year?: number | "none";
  yearFrom?: number;
  yearTo?: number;
}

/** Writes the list's narrowing onto `params`. */
export function appendIssueListScopeParams(params: URLSearchParams, scope: IssueListScope): void {
  if (scope.areaIds && scope.areaIds.length > 0) params.set("areaIds", scope.areaIds.join(","));
  if (scope.search) params.set("search", scope.search);
  if (scope.searchCatalogVendorId) params.set("searchCatalogVendorId", scope.searchCatalogVendorId);
  if (scope.searchCatalogNumber) params.set("searchCatalogNumber", scope.searchCatalogNumber);
  if (scope.searchFields) params.set(SEARCH_FIELDS_PARAM, scope.searchFields.join(","));
  if (scope.catalogVendorId) params.set("catalogVendorId", scope.catalogVendorId);
  if (scope.catalogNumber) params.set("catalogNumber", scope.catalogNumber);
  if (scope.catalogScope) params.set(CATALOG_SCOPE_PARAM, scope.catalogScope.join(","));
  appendTagFilterParams(params, scope);
  appendIssueFormatParam(params, scope.issueFormatIds);
  if (scope.year) params.set("year", scope.year);
}

/** Reads the list's narrowing off a query string — the inverse of {@link appendIssueListScopeParams}. */
export function readIssueListScopeParams(sp: URLSearchParams): IssueListScopeOpts {
  const areaIds = sp.get("areaIds");
  return {
    ...(areaIds ? { areaIds: areaIds.split(",") } : {}),
    // Double quotes taken off and read as an exact search (#2545).
    ...readListSearchParams(sp),
    searchCatalogVendorId: sp.get("searchCatalogVendorId") || undefined,
    searchCatalogNumber: sp.get("searchCatalogNumber") || undefined,
    searchFields: parseSearchFields(sp.get(SEARCH_FIELDS_PARAM), ISSUE_SEARCH_FIELD_KEYS),
    catalogVendorId: sp.get("catalogVendorId") || undefined,
    catalogScope: parseCatalogScope(sp.get(CATALOG_SCOPE_PARAM)),
    catalogNumber: sp.get("catalogNumber") || undefined,
    ...tagFilterFromParams(sp),
    issueFormatIds: parseIssueFormatIds(sp.get(ISSUE_FORMAT_FILTER_PARAM)),
    ...readYearFilter(sp.get("year")),
  };
}
