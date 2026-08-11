import { useState } from "react";

/**
 * Collapsed-by-default expansion state for a **grouped list** — the Copies list's duplicate (#372),
 * filing (#421) and issue (#424) groupings — plus the Expand all / Collapse all control over it
 * (#538). The state lives at the panel level so one screen has one rule, exactly as `useCardExpansion`
 * (#382) does for the lot / set cards on the detail screens.
 *
 * It is deliberately **not** `useCardExpansion`. That hook opens a card that *appears while the
 * screen is open*, because on a detail screen a new card was created here and is what the collector
 * is looking at. A grouped list is cursor-scrolled: its rows appear because the collector scrolled,
 * and every one of them fetches its own members when opened — a page of forty groups arriving
 * pre-expanded would be four hundred copies nobody asked for.
 *
 * The state is therefore a **mode plus its exceptions**, not a set of open ids:
 *
 *  - `expandAll` is what the control last set, and `overrides` holds the rows toggled by hand since.
 *  - A group loaded *after* Expand all is pressed comes in expanded, which is what "expand all" means
 *    on a list whose end has not been reached yet — the alternative is a control that quietly stops
 *    applying at the scroll position it was pressed at.
 *  - `allExpanded` is read over the ids currently loaded, so the label always describes what is on
 *    screen.
 *
 * `resetKey` drops the state when the list becomes a different list — switching grouping mode above
 * all. Carrying `expandAll` from one grouping to another would open every group of a list the
 * collector has not even looked at yet.
 */
export interface GroupExpansion {
  isExpanded(id: string): boolean;
  toggle(id: string): void;
  /** True when every currently-loaded group is open — what the Expand all / Collapse all control reads. */
  allExpanded: boolean;
  toggleAll(): void;
}

interface ExpansionState {
  key: string;
  expandAll: boolean;
  /** Groups toggled by hand since the mode was last set — the exceptions to it. */
  overrides: Set<string>;
}

export function useGroupExpansion(ids: string[], resetKey: string): GroupExpansion {
  const [state, setState] = useState<ExpansionState>(() => ({
    key: resetKey,
    expandAll: false,
    overrides: new Set(),
  }));

  // Adjusting state during render (the documented pattern) rather than in an effect, so the new
  // list never renders one frame under the old list's expansion.
  const current =
    state.key === resetKey ? state : { key: resetKey, expandAll: false, overrides: new Set<string>() };
  if (current !== state) setState(current);

  const isExpanded = (id: string) => current.overrides.has(id) !== current.expandAll;
  const allExpanded = ids.length > 0 && ids.every(isExpanded);

  return {
    isExpanded,
    allExpanded,
    toggle: (id) =>
      setState((prev) => {
        const overrides = new Set(prev.overrides);
        if (overrides.has(id)) overrides.delete(id);
        else overrides.add(id);
        return { ...prev, overrides };
      }),
    // Clears the exceptions: the control is a statement about the whole list, so the rows toggled by
    // hand before it was pressed are exactly what it overrules.
    toggleAll: () => setState({ key: resetKey, expandAll: !allExpanded, overrides: new Set() }),
  };
}
