// Extension preferences (chrome.storage.local). Kept apart from the connection profile: a profile
// says *where* we talk to, these say *how the extension behaves*.

const MATCH_ON_LOAD = "matchOnLoad";

/**
 * Whether to match a supported page automatically as it loads, so the toolbar badge can report how
 * many stamps need action. Default on. It is switchable because it changes the extension's posture:
 * with it off nothing leaves the browser until the window is opened, with it on every Colnect page
 * you visit reaches your instance (read-only — the dry-run never writes).
 */
export async function getMatchOnLoad(): Promise<boolean> {
  const data = await chrome.storage.local.get(MATCH_ON_LOAD);
  return data[MATCH_ON_LOAD] !== false;
}

export async function setMatchOnLoad(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [MATCH_ON_LOAD]: enabled });
}
