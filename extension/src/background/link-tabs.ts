// Tabs the Assistant opened for a **Link** (#1380): which marketplace tab was opened from which
// Stamporama tab, and for which stamp.
//
// The match handoff (#423) ends at `opened` — what happens in the match window is the collector's own
// work, reported on the doorbell to every instance tab rather than to the handoff. So nothing in the
// worker is still waiting when the match is finally written, and the write itself names only a
// stamp. This record is what turns "a match was written from tab 41" into "the Link opened in tab 41
// is done, and the collector came from tab 12".
//
// In `chrome.storage.local` for `pending-listings.ts`'s reason: the collector may take minutes in the
// match window, and an MV3 worker is unloaded after seconds of quiet. Only a tab opened here is ever
// recorded, which is what keeps a tab the collector opened themselves from ever being closed.

const STORAGE_KEY = "linkTabs";

/** How long an opened search still counts as a Link waiting for its match — `pending-listings.ts`'s
 *  own horizon, for the same reason: long enough for a session, finite so a tab left open for days is
 *  not closed out from under a collector who has long since made it theirs. */
const TTL_MS = 12 * 60 * 60 * 1000;

export interface LinkTab {
  /** The marketplace tab the search was opened in. The record's key. */
  tabId: number;
  /** The Stamporama tab that handed the stamp over — where the collector is sent back to. */
  instanceTabId: number | null;
  /** The stamp the Link was pressed on, or null where the page did not say (a page predating #1380). */
  stampId: string | null;
  /** When the search was opened, epoch ms. Only ever compared against {@link TTL_MS}. */
  openedAt: number;
}

// ── Pure list operations ─────────────────────────────────────────────────────

export function pruneLinkTabs(list: readonly LinkTab[], now: number): LinkTab[] {
  return list.filter((t) => now - t.openedAt < TTL_MS);
}

/** Record `entry`, replacing whatever that tab held — a tab id is reused only once its tab is gone. */
export function upsertLinkTab(list: readonly LinkTab[], entry: LinkTab): LinkTab[] {
  return [...list.filter((t) => t.tabId !== entry.tabId), entry];
}

export function withoutLinkTab(list: readonly LinkTab[], tabId: number): LinkTab[] {
  return list.filter((t) => t.tabId !== tabId);
}

export function findLinkTab(list: readonly LinkTab[], tabId: number): LinkTab | null {
  return list.find((t) => t.tabId === tabId) ?? null;
}

/**
 * Whether the stamps a write just linked finish this Link.
 *
 * A search page routinely holds more than the one stamp it was opened for, and **Write** links every
 * row the matcher settled on its own — so a match landing on a neighbour is not the job done, and the
 * tab stays open for the stamp that is still owed. A record that names no stamp takes the first match
 * written from its tab, which is the only reading it has.
 */
export function linkTabFinished(entry: LinkTab, writtenStampIds: readonly string[]): boolean {
  if (writtenStampIds.length === 0) return false;
  return entry.stampId === null || writtenStampIds.includes(entry.stampId);
}

// ── Storage ──────────────────────────────────────────────────────────────────

async function readAll(): Promise<LinkTab[]> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const stored = data[STORAGE_KEY];
    return Array.isArray(stored) ? (stored as LinkTab[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(list: LinkTab[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: list });
  } catch {
    // A Link whose record could not be stored simply leaves its tab open, which is what it did before.
  }
}

/** Remember a search opened for a Link, pruning anything stale on the way through. */
export async function rememberLinkTab(entry: LinkTab): Promise<void> {
  const pruned = pruneLinkTabs(await readAll(), entry.openedAt);
  await writeAll(upsertLinkTab(pruned, entry));
}

export async function getLinkTab(tabId: number, now: number): Promise<LinkTab | null> {
  return findLinkTab(pruneLinkTabs(await readAll(), now), tabId);
}

export async function forgetLinkTab(tabId: number): Promise<void> {
  const list = await readAll();
  if (!findLinkTab(list, tabId)) return;
  await writeAll(withoutLinkTab(list, tabId));
}
