import { getCloseFinishedTabs } from "../core/settings";

/**
 * Close a marketplace tab the Assistant opened, now that its job is done, and put the collector back
 * on the Stamporama tab they came from (#1380). Answers whether the tab was closed.
 *
 * Every caller has already decided the job **is** done — a match saved on the stamp the Link was
 * for, a listing's URL recorded — and only for a tab it opened itself; this decides nothing but
 * whether the collector wants it (the option, on by default) and how to leave the window.
 *
 * The Stamporama tab is brought forward **before** the other one goes: closing the active tab lets
 * the browser pick a neighbour, which is rarely the offer. Every step is best-effort — a Stamporama
 * tab closed in the meantime still leaves a finished tab worth closing, and a tab the collector has
 * already closed is the same outcome reached by hand.
 */
export async function closeFinishedTab(tabId: number, returnTabId: number | null): Promise<boolean> {
  if (!(await getCloseFinishedTabs())) return false;

  if (returnTabId !== null) {
    try {
      const back = await chrome.tabs.update(returnTabId, { active: true });
      if (back?.windowId !== undefined) await chrome.windows.update(back.windowId, { focused: true });
    } catch {
      // The offer's tab is gone; the finished tab is still finished.
    }
  }
  try {
    await chrome.tabs.remove(tabId);
    return true;
  } catch {
    return false;
  }
}
