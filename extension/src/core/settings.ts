// Extension preferences (chrome.storage.local). Kept apart from the connection profile: a profile
// says *where* we talk to, these say *how the extension behaves*.

const MATCH_ON_LOAD = "matchOnLoad";
export const CATALOG_BACKFILL = "catalogBackfill";
export const ISSUE_DATE_SYNC = "issueDateSync";
const SHOW_LINKED_DECISIONS = "showLinkedDecisions";

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

/**
 * Whether a matched stamp should also take the date of issue Colnect prints, for the parts of the
 * date it has none of (#655). Default on — our stamps are commonly dated by year alone, copied from
 * their issue, while a Colnect page usually knows the day. Its own switch rather than the backfill's,
 * because wanting Colnect's numbers and wanting its dates are two separate appetites. The instance
 * only fills what is *missing*: a date component the two sides state differently is reported and
 * left alone until you settle it yourself.
 */
export async function getIssueDateSync(): Promise<boolean> {
  const data = await chrome.storage.local.get(ISSUE_DATE_SYNC);
  return data[ISSUE_DATE_SYNC] !== false;
}

export async function setIssueDateSync(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [ISSUE_DATE_SYNC]: enabled });
}

/**
 * Whether "needs your decision" also lists the rows whose every candidate stamp is already linked to
 * another Colnect item (#305). Default off: those are decisions already taken, and they otherwise
 * come back on every re-scan of the page. Persisted rather than per-window, because the answer is a
 * standing preference — the same pages get re-scanned for weeks.
 */
export async function getShowLinkedDecisions(): Promise<boolean> {
  const data = await chrome.storage.local.get(SHOW_LINKED_DECISIONS);
  return data[SHOW_LINKED_DECISIONS] === true;
}

export async function setShowLinkedDecisions(shown: boolean): Promise<void> {
  await chrome.storage.local.set({ [SHOW_LINKED_DECISIONS]: shown });
}
