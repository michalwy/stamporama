// Listings that have been filled and are waiting for the collector to submit them (#412).
//
// Filling stops before Save, and the entry's URL exists only *after* Save — so between the two there
// is a wait of unknown length, in the collector's own time, on the marketplace's page. That wait is
// what this remembers: which tab holds which offer's form, which module knows the site, and where
// the answer is to be delivered.
//
// It lives in `chrome.storage.local` rather than in a worker variable for one reason: an MV3 service
// worker is unloaded after seconds of quiet, and the collector may take minutes over a form. A
// navigation wakes the worker with nothing but a tab id, and this is what turns that into meaning.
//
// Nothing here knows about Colnect, or about any marketplace: a record names a module and never a
// site.

const STORAGE_KEY = "pendingListings";

/**
 * How long a filled-but-unsubmitted form is still worth remembering. Long enough for a listing
 * session — a collector fills a form, wanders off, comes back and posts it — and finite so that a
 * form abandoned days ago cannot activate an offer the collector has since changed their mind about.
 */
const TTL_MS = 12 * 60 * 60 * 1000;

export interface PendingListing {
  /** The tab the form was opened in. The record's key: one tab holds one listing at a time. */
  tabId: number;
  /** The module that filled it, and is the only thing that can recognise its entry page (#412). */
  moduleId: string;
  moduleName: string;
  /** The sale form the task was filled into, carried so the report is the same shape as the fill's. */
  formUrl: string;
  offerId: string;
  collectionId: string;
  /** The handoff this belongs to (#409), so an answer names the request it answers. */
  requestId: string;
  /** The instance tab that handed the offer over, and its origin: how the answer gets home, and
   *  which connected instance to post to when no page is still following (#412). */
  instanceTabId: number | null;
  instanceOrigin: string | null;
  /** The filled form has been submitted. What separates a posted listing whose URL could not be read
   *  — worth reporting — from one the collector simply abandoned, which is worth nothing at all. */
  submitted: boolean;
  /** When the form was filled, epoch ms. Only ever compared against {@link TTL_MS}. */
  filledAt: number;
}

// ── Pure list operations ─────────────────────────────────────────────────────
// Kept separate from the storage calls so they can be tested without a chrome double, exactly as the
// profile store's own derivations are.

/** Drop records past {@link TTL_MS}. */
export function prunePendingListings(
  list: readonly PendingListing[],
  now: number
): PendingListing[] {
  return list.filter((p) => now - p.filledAt < TTL_MS);
}

/** Record `entry`, replacing whatever that tab held: a tab that is filled a second time is a second
 *  listing, and the first one is no longer anywhere the collector can submit it. */
export function upsertPendingListing(
  list: readonly PendingListing[],
  entry: PendingListing
): PendingListing[] {
  return [...list.filter((p) => p.tabId !== entry.tabId), entry];
}

export function withoutPendingListing(
  list: readonly PendingListing[],
  tabId: number
): PendingListing[] {
  return list.filter((p) => p.tabId !== tabId);
}

export function findPendingListing(
  list: readonly PendingListing[],
  tabId: number
): PendingListing | null {
  return list.find((p) => p.tabId === tabId) ?? null;
}

// ── Storage ──────────────────────────────────────────────────────────────────

async function readAll(): Promise<PendingListing[]> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const stored = data[STORAGE_KEY];
    return Array.isArray(stored) ? (stored as PendingListing[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(list: PendingListing[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: list });
  } catch {
    // A listing whose record could not be stored simply is not captured: the collector activates the
    // offer in Stamporama, where a blank URL is already an accepted answer.
  }
}

/** Remember a filled form, pruning anything stale on the way through. */
export async function rememberPendingListing(entry: PendingListing): Promise<void> {
  const pruned = prunePendingListings(await readAll(), entry.filledAt);
  await writeAll(upsertPendingListing(pruned, entry));
}

/** The listing this tab is waiting to have submitted, if it still counts. */
export async function getPendingListing(
  tabId: number,
  now: number
): Promise<PendingListing | null> {
  return findPendingListing(prunePendingListings(await readAll(), now), tabId);
}

export async function forgetPendingListing(tabId: number): Promise<void> {
  const list = await readAll();
  if (!findPendingListing(list, tabId)) return;
  await writeAll(withoutPendingListing(list, tabId));
}

/** Mark this tab's form as submitted (#412). A no-op when there is nothing pending: the collector may
 *  submit a form the Assistant never filled, which is theirs alone and none of our business. */
export async function markPendingListingSubmitted(tabId: number): Promise<void> {
  const list = await readAll();
  const entry = findPendingListing(list, tabId);
  if (!entry || entry.submitted) return;
  await writeAll(upsertPendingListing(list, { ...entry, submitted: true }));
}
