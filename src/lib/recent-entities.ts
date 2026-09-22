// Recently visited entities (#599): the short list of records the collector has just been looking
// at, so getting back to one is a click rather than a re-search.
//
// It is the **other half of the quick-jump box** (#431). That box answers "take me to the thing I
// am holding the number of"; this list answers "take me back to the thing I was just on", which is
// the far commoner journey and the one that costs the most today — a copy reached through a
// filtered list, an offer reached through three screens, both gone the moment the next thing is
// opened.
//
// Pure (no React, no Prisma, no storage): a detail screen records a visit, the sidebar reads the
// list, and what a *visit* is — how entries are deduped, ordered and capped — is stated once here so
// a unit test can hold it.
//
// **A visit is not a fact about the collection**, which is why none of this reaches the database: it
// is a fact about one person's browsing, worth exactly as much as the browser it happened in. It
// therefore lives in localStorage per collection, beside the other view preferences (#115/#275), and
// costs no write on every page view and no pruning job.

/** The entities a visit is recorded for — the seven that have a screen of their own.
 *
 * Deliberately *not* the quick-jump prefix set (`QuickJumpEntity`): that one is about which records
 * carry a short number, this one about which have somewhere to go back **to**. A stamp has a detail
 * page but no number; an auction lot has a number but is read on its sale's screen, and that sale
 * is what gets recorded. */
export type RecentEntityKind =
  | "item"
  | "stamp"
  | "issue"
  | "offer"
  | "purchase"
  | "sale"
  | "auctionSale"
  | "trade";

/** How one record of a kind is named. Also the set of kinds a stored entry may carry. */
export const RECENT_ENTITY_LABELS: Record<RecentEntityKind, string> = {
  item: "Copy",
  stamp: "Stamp",
  issue: "Issue",
  offer: "Offer",
  purchase: "Purchase",
  sale: "Sale",
  auctionSale: "Auction sale",
  trade: "Trade",
};

/** The heading a kind's group carries in the panel (#1370).
 *
 * Purchases are headed by the list they live on, *Intake documents*, because that list also holds
 * the opening balances (#1323) and a heading reading *Purchases* over one of those would be wrong. */
export const RECENT_ENTITY_GROUP_HEADINGS: Record<RecentEntityKind, string> = {
  item: "Copies",
  stamp: "Stamps",
  issue: "Issues",
  offer: "Offers",
  purchase: "Intake documents",
  sale: "Sales",
  auctionSale: "Auction sales",
  trade: "Trades",
};

/** One visited record.
 *
 * The entry is **self-contained** — it carries the address and the words to draw, not an id to look
 * up. A panel that had to fetch seven records to render seven lines would be a query on every page
 * of the app for a list that is only ever glanced at, and a deleted record would make it fail
 * rather than simply offer a link that 404s once and drops out. */
export interface RecentEntity {
  kind: RecentEntityKind;
  /** The record's id, unique within its kind — what a repeat visit is recognised by. */
  id: string;
  /** Where to go. Collection-relative already resolved by the recording screen. */
  href: string;
  /** What the record is called, in its own screen's words ("Purchase #7", "Copy #123"). */
  label: string;
  /** The line under it — the detail that tells two same-named records apart. Optional. */
  sublabel?: string;
  /** When it was visited, epoch milliseconds. */
  at: number;
}

/** How many entries each kind keeps (#1370).
 *
 * The cap is **per kind**, not over the whole list. One shared cap (twelve, until #1370) let a
 * working session spent on one kind of thing fill the list on its own: after a dozen offers every
 * entry was an offer, and the stamp one was on half an hour earlier had been pushed out — so the
 * list helped only with the thing being done right now, the one place a jump list is least needed.
 * Kept per kind, another offer can displace only an older offer.
 *
 * Three, because the panel shows every kind at once: eight kinds of three is already twenty-four
 * rows, and "what I was just on" is not a list meant to be read. */
export const RECENT_ENTITY_GROUP_LIMIT = 3;

/** Keep at most `limit` entries of each kind, in the order given, dropping the later ones. */
function capPerKind(list: readonly RecentEntity[], limit: number): RecentEntity[] {
  const counts = new Map<RecentEntityKind, number>();
  const kept: RecentEntity[] = [];
  for (const e of list) {
    const n = counts.get(e.kind) ?? 0;
    if (n >= limit) continue;
    counts.set(e.kind, n + 1);
    kept.push(e);
  }
  return kept;
}

/**
 * Record a visit against the list as it stands, returning the new list.
 *
 * Most recent first, one entry per record, capped **per kind** — a visit displaces only an older
 * entry of its own kind. A revisit **moves** its entry to the front rather than adding a second —
 * the list is of records, not of visits, and a page kept open and returned to would otherwise fill
 * it on its own.
 *
 * The label is taken from the *new* visit, so a record renamed since it was last seen reads by its
 * current name.
 */
export function recordRecentEntity(
  list: readonly RecentEntity[],
  entry: RecentEntity,
  limit: number = RECENT_ENTITY_GROUP_LIMIT
): RecentEntity[] {
  const rest = list.filter((e) => !(e.kind === entry.kind && e.id === entry.id));
  return capPerKind([entry, ...rest], Math.max(0, limit));
}

/** One kind's entries, as the panel shows them under a heading. */
export interface RecentEntityGroup {
  kind: RecentEntityKind;
  /** Most recently visited first. Never empty. */
  entries: RecentEntity[];
}

/**
 * Split a most-recent-first list into its kinds (#1370), the groups ordered by their most recent
 * visit — so the kind of thing just worked on is on top. A kind with no entries has no group.
 *
 * The list stays one flat, most-recent-first array in storage; grouping is how it is *shown*, so a
 * stored list from before the groups reads straight into them.
 */
export function groupRecentEntities(list: readonly RecentEntity[]): RecentEntityGroup[] {
  const groups = new Map<RecentEntityKind, RecentEntity[]>();
  for (const e of list) {
    const entries = groups.get(e.kind);
    if (entries) entries.push(e);
    else groups.set(e.kind, [e]);
  }
  return [...groups].map(([kind, entries]) => ({ kind, entries }));
}

function isRecentEntity(value: unknown): value is RecentEntity {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<RecentEntity>;
  return (
    typeof e.kind === "string" &&
    e.kind in RECENT_ENTITY_LABELS &&
    typeof e.id === "string" &&
    e.id !== "" &&
    typeof e.href === "string" &&
    e.href.startsWith("/") &&
    typeof e.label === "string" &&
    (e.sublabel === undefined || typeof e.sublabel === "string") &&
    typeof e.at === "number" &&
    Number.isFinite(e.at)
  );
}

/**
 * Read a stored list, dropping anything that is not one.
 *
 * Tolerant on purpose: this is browser storage written by an older version of the app, and the
 * worst outcome of a shape that has moved on must be a shorter list, never a sidebar that throws.
 * An `href` is required to be **relative** — an absolute one is a link off this app, which nothing
 * here writes and which is not something a stored preference gets to introduce.
 */
export function parseRecentEntities(raw: string | null): RecentEntity[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return capPerKind(parsed.filter(isRecentEntity), RECENT_ENTITY_GROUP_LIMIT);
}

/** Write a list back out. */
export function serializeRecentEntities(list: readonly RecentEntity[]): string {
  return JSON.stringify(list);
}
