// Extension preferences (chrome.storage.local). Kept apart from the connection profile: a profile
// says *where* we talk to, these say *how the extension behaves*.

const MATCH_ON_LOAD = "matchOnLoad";
export const CATALOG_BACKFILL = "catalogBackfill";

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

/**
 * Whether a matched stamp should also be filled with the catalog numbers Colnect prints for
 * catalogs it has none of (#280). Default on — it is the point of matching against a catalogue that
 * knows more numbers than we do. The instance only ever fills *missing* catalogs, never overwrites,
 * so leaving it on cannot change a number you entered yourself.
 */
export async function getCatalogBackfill(): Promise<boolean> {
  const data = await chrome.storage.local.get(CATALOG_BACKFILL);
  return data[CATALOG_BACKFILL] !== false;
}

export async function setCatalogBackfill(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [CATALOG_BACKFILL]: enabled });
}
