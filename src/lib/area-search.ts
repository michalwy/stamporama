import { foldForSearch } from "./fold-for-search";

/** The fields of an area the tree search reads — `CollectionAreaData` satisfies it. */
export interface AreaSearchNode {
  id: string;
  parentId: string | null;
  name: string;
  /** The name used in listing titles (#210); searched as well as `name`. */
  titleName: string | null;
}

export interface AreaSearchResult {
  /** The areas whose name or title name contains what was typed. */
  matchIds: Set<string>;
  /**
   * The areas the narrowed tree draws: every match plus each match's ancestors, so a match is always
   * seen under the branch it belongs to. The ancestors that are not matches themselves are drawn
   * dimmed — the rule the checklist filter on the stamp tree follows (#531).
   */
  shownIds: Set<string>;
}

/**
 * The area filter's search (#1436): which areas match `query`, and which are drawn to show them.
 * Case and diacritics are folded on both sides (`gdansk` finds *Gdańsk*), and both the name and the
 * title name are compared. A blank query is **no search** and answers `null` — the full tree —
 * rather than a result matching everything, so the caller cannot mistake one for the other.
 *
 * The search narrows what is **drawn** and nothing else: the selection is the caller's and is never
 * read or written here, so an area selected before the search stays selected while hidden.
 */
export function searchAreas(
  areas: readonly AreaSearchNode[],
  query: string
): AreaSearchResult | null {
  const needle = foldForSearch(query.trim());
  if (!needle) return null;

  const byId = new Map(areas.map((a) => [a.id, a]));
  const matchIds = new Set<string>();
  const shownIds = new Set<string>();

  for (const area of areas) {
    const matches =
      foldForSearch(area.name).includes(needle) ||
      (area.titleName !== null && foldForSearch(area.titleName).includes(needle));
    if (!matches) continue;
    matchIds.add(area.id);

    // Walk up until an ancestor already drawn — everything above it is drawn too. The `shownIds`
    // guard also ends the walk on a malformed parent cycle rather than spinning on it.
    let current: AreaSearchNode | undefined = area;
    while (current && !shownIds.has(current.id)) {
      shownIds.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }

  return { matchIds, shownIds };
}

/**
 * The match in hand after an arrow key (#1436). `order` is the matches in the order the tree draws
 * them; `current` is the one in hand, or `null` for none. Stepping from none lands on the first
 * match going down and the last going up; stepping past either end stays put, so holding a key
 * does not wrap the highlight round to the other end of a long tree out of sight.
 */
export function stepAreaMatch(
  order: readonly string[],
  current: string | null,
  direction: 1 | -1
): string | null {
  if (order.length === 0) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at < 0) return direction === 1 ? order[0] : order[order.length - 1];
  const next = Math.min(order.length - 1, Math.max(0, at + direction));
  return order[next];
}
