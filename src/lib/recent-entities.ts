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

/** How a kind is named above its entries in the panel. */
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

/** How many entries are kept.
 *
 * Twelve, not fifty: this is "what I was just on", and a list long enough to need reading is one
 * more thing to search. It is also what fits under the box without the sidebar's nav scrolling
 * away. */
export const RECENT_ENTITY_LIMIT = 12;

/**
 * Record a visit against the list as it stands, returning the new list.
 *
 * Most recent first, one entry per record, capped. A revisit **moves** its entry to the front
 * rather than adding a second — the list is of records, not of visits, and a page kept open and
 * returned to would otherwise fill it on its own.
 *
 * The label is taken from the *new* visit, so a record renamed since it was last seen reads by its
 * current name.
 */
export function recordRecentEntity(
  list: readonly RecentEntity[],
  entry: RecentEntity,
  limit: number = RECENT_ENTITY_LIMIT
): RecentEntity[] {
  const rest = list.filter((e) => !(e.kind === entry.kind && e.id === entry.id));
  return [entry, ...rest].slice(0, Math.max(0, limit));
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
  return parsed.filter(isRecentEntity).slice(0, RECENT_ENTITY_LIMIT);
}

/** Write a list back out. */
export function serializeRecentEntities(list: readonly RecentEntity[]): string {
  return JSON.stringify(list);
}
