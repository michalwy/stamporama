/**
 * Whether the sidebar is folded to its icon rail (#2505) — the pure half, beside the hook that reads
 * the browser (`shared/use-sidebar-fold.ts`).
 *
 * **Remembered on this browser, not per collection and not on the server.** How much room a sidebar
 * may take is a fact about the window in front of the collector, not about the collection or the
 * work — the opposite of a pin (#2504), which is about the work and so lives on the server.
 *
 * **Only an explicit choice is stored.** With nothing stored, a narrow window folds the sidebar by
 * itself and a wide one shows it whole; once the collector has folded or unfolded it by hand, that
 * choice wins at every width.
 */

/** The localStorage key. One per browser, deliberately without a collection id. */
export const SIDEBAR_FOLD_KEY = "stamporama:sidebar-folded";

/**
 * Below this window width, in CSS pixels, the sidebar folds by itself while nothing is stored. At
 * 1100 the expanded sidebar's 15rem still leaves a list ~860px; any narrower and the screen beside
 * it has to give up columns.
 */
export const SIDEBAR_AUTO_FOLD_MAX_WIDTH = 1100;

/** The media query that says the window is narrow enough to fold the sidebar by itself. */
export const NARROW_WINDOW_QUERY = `(max-width: ${SIDEBAR_AUTO_FOLD_MAX_WIDTH - 0.02}px)`;

/**
 * The stored choice, read back tolerantly: `true` folded, `false` unfolded, `null` no choice made.
 * Anything else — storage from another build, a hand-edited value — counts as no choice, so it falls
 * back on the window's width rather than pinning the sidebar either way.
 */
export function parseSidebarFold(raw: string | null): boolean | null {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

/** What is written for a choice made by hand. */
export function serializeSidebarFold(folded: boolean): string {
  return folded ? "1" : "0";
}

/** Folded or not: the collector's own choice where there is one, the window's width where not. */
export function isSidebarFolded(stored: boolean | null, narrowWindow: boolean): boolean {
  return stored ?? narrowWindow;
}

/**
 * The shortcut that folds and unfolds the sidebar: ⌘\ on a Mac, Ctrl+\ elsewhere — either modifier
 * is taken, since the collector reaches for whichever their keyboard has. Read by the key's
 * position (`code`) as well as by what it types, so a layout that puts another character on that
 * key still toggles. Shift and Alt are left alone: a chord that adds them means something else.
 */
export function isSidebarFoldShortcut(e: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return false;
  return e.key === "\\" || e.code === "Backslash";
}
