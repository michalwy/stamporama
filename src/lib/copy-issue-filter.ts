import type { ItemIssueRef, ItemListItem } from "@/lib/items";

/**
 * The Copies list's issue filter (#2308): a copy's row shows every copy of its issue, so the rest of
 * a set can join it in one offer.
 *
 * Kept apart from the panel so the unit suite can hold the row's issues and the click's update to
 * the same rules without React.
 */

/** The address-bar parameter the filter lives in — the one every Copies route already reads. Kept
 *  in the page address so the view reloads and links, and **not remembered**: once removed it is
 *  gone, like the search it replaces. */
export const ISSUE_FILTER_PARAM = "issueId";

/**
 * The issues a copy's row offers *Show this issue's copies* for, each once, in the order the row
 * reports them: every issue its stamp is filed in, or — on a multi-stamp copy, which is a copy of
 * none of its stamps (ADR-0044 §3) — every issue any of the stamps it carries is filed in.
 */
export function copyIssues(
  item: Pick<ItemListItem, "multiStamp" | "issues" | "carriedStamps">
): ItemIssueRef[] {
  const all = item.multiStamp ? item.carriedStamps.flatMap((entry) => entry.issues) : item.issues;
  return all.filter((issue, i) => all.findIndex((other) => other.id === issue.id) === i);
}

/**
 * The one write the action makes: the issue takes the search's place, and nothing else is named, so
 * every other filter keeps narrowing — the copies of that issue that can go into the offer.
 */
export function showIssueCopiesUpdate(issueId: string): Record<string, string> {
  return { search: "", [ISSUE_FILTER_PARAM]: issueId };
}
