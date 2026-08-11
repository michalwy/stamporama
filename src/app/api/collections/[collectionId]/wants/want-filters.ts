import { isWantPriority, type WantListFilters, type WantPriority } from "@/lib/wants";

// One parser for the list route and the year-facet route beside it (#532). Shared so a facet can
// never be counted against a different question than the page it sits next to — the two routes
// differ only in that the facets ignore the year, which the domain layer handles.

/** A comma-separated list parameter, emptied of blanks. Absent and empty both mean "no filter". */
function list(params: URLSearchParams, key: string): string[] | undefined {
  const raw = params.get(key);
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function parseWantListFilters(params: URLSearchParams): WantListFilters {
  const status = params.get("status");
  const offset = Number(params.get("offset") ?? "0");

  return {
    status: status === "open" || status === "closed" || status === "all" ? status : "all",
    priorities: list(params, "priorities")?.filter((p): p is WantPriority => isWantPriority(p)),
    conditionIds: list(params, "conditionIds"),
    areaIds: list(params, "areaIds"),
    year: params.get("year") ?? undefined,
    issueId: params.get("issueId") ?? undefined,
    stampId: params.get("stampId") ?? undefined,
    search: params.get("search") ?? undefined,
    // A junk offset is page one, not an error: the parameter is ours, and a 400 here would break
    // scrolling over something nobody typed.
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
  };
}
