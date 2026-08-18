import "server-only";
import { prisma } from "./db";
import {
  type DelcampeCategoryRow,
  delcampeCategoryRow,
  parseDelcampeCategoryPage,
} from "./delcampe-category-catalog-rules";
import { DELCAMPE_PLATFORM_MODULE } from "./platform-modules";
import { DELCAMPE_CATEGORY_SEED, DELCAMPE_CATEGORY_SEED_READ_AT } from "./delcampe-category-seed";

// Delcampe's own category tree, kept locally so an id arrives with a name (#609; ADR-0035 §4).
//
// **Why this exists at all.** The Easy Uploader file wants `category_id` and nothing else. Delcampe's
// REST API — which could be asked what `7945` is called — is behind the paid API Pass this
// integration deliberately does not buy (ADR-0034), so the only readable statement of the tree is the
// public list Delcampe's own help centre sends sellers to. Without it the picker would be a number
// field, and the collector would be back to the spreadsheet #609 exists to retire.
//
// **What it is not.** It is a dictionary, not a mapping: nothing here says what a *stamp* should be
// listed as — that is the register's answer and it is learned (`platform-category.ts`). Losing this
// table costs names on a screen and nothing else.
//
// **How it is filled.** A polite walk of the Stamps subtree, once a day, and only on an instance that
// has actually named a Delcampe platform. Two things keep it from being a scrape of any size:
//
//   - a page that expanded a heading's children **in place** has already answered for that heading's
//     own page, and the parser reports only the links it did not expand — which is the difference
//     between roughly 260 requests and roughly a thousand;
//   - requests are sequential and spaced, and Delcampe's own rate limiting is taken as an instruction
//     rather than as an error to retry through: a pass that is refused stops, keeps what it read, and
//     leaves the previous snapshot standing.
//
// The tree changes rarely — Delcampe announces new categories a handful of times a year — so a
// snapshot that is a day old is a snapshot that is right, and one that is a week old (because the
// walk kept being refused) is still far better than a number field.

/** Where the walk starts, and what every path begins with. */
const ROOT_PATH = "/en_GB/collectables/category-id/stamps/";
const ROOT_TRAIL = ["Stamps"];
const ORIGIN = "https://www.delcampe.net";

/** How long between requests. Chosen against the site's own behaviour rather than picked round:
 *  a walk at ~150 ms was refused with 429 inside a minute, and this is the pace at which it is not.
 *  Roughly 260 pages then costs about five minutes, once a day, on an instance that lists there. */
const REQUEST_SPACING_MS = 1_200;

/** How long to wait out a 429 before trying that one page again, and how many refusals end the pass.
 *  A refusal is Delcampe saying *not now*, and the honest answer is to stop and keep yesterday's
 *  snapshot — not to keep asking more slowly until something gives. */
const RATE_LIMIT_BACKOFF_MS = 30_000;
const RATE_LIMIT_GIVE_UP = 3;

/** A hard ceiling on the walk, so a tree that grew a cycle — or markup that starts linking sideways —
 *  cannot turn a nightly refresh into an unbounded crawl of somebody else's site. */
const MAX_PAGES = 600;

const USER_AGENT = "Stamporama/1.0 (self-hosted stamp collection manager; category list refresh)";

export interface DelcampeCatalogRefresh {
  /** Rows read. Not necessarily rows stored — see {@link complete}. */
  read: number;
  pagesRead: number;
  /** Whether the walk finished. Only a complete pass may delete: a pass cut short by a refusal has
   *  no opinion about the categories it never reached, and treating it as one would empty the picker
   *  of everything below the page it stopped at. */
  complete: boolean;
  /** Why it stopped short, in words, for the panel that offers **Refresh now**. */
  message: string | null;
}

/** One page, or null where the walk should stop. */
async function fetchPage(path: string): Promise<{ html: string } | { rateLimited: true } | null> {
  const response = await fetch(ORIGIN + path, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    // The catalogue is this app's own snapshot; Next's fetch cache has nothing to add and would
    // quietly hand a refresh the page it read yesterday.
    cache: "no-store",
  });
  if (response.status === 429) return { rateLimited: true };
  if (!response.ok) return null;
  return { html: await response.text() };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Walk Delcampe's Stamps subtree and return every category it states.
 *
 * Sequential on purpose. Parallelism here would be this app deciding it may take as much of somebody
 * else's site at once as its connection allows, for data that changes a few times a year.
 */
export async function crawlDelcampeCategories(): Promise<{
  rows: DelcampeCategoryRow[];
  pagesRead: number;
  complete: boolean;
  message: string | null;
}> {
  const rows = new Map<string, DelcampeCategoryRow>();
  const seen = new Set<string>();
  const queue: { path: string; trail: string[] }[] = [{ path: ROOT_PATH, trail: ROOT_TRAIL }];
  let pagesRead = 0;
  let refusals = 0;
  let first = true;

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next.path)) continue;
    seen.add(next.path);

    if (pagesRead >= MAX_PAGES) {
      return {
        rows: [...rows.values()],
        pagesRead,
        complete: false,
        message: `Stopped after ${MAX_PAGES} pages — Delcampe's list is larger than this walk expects.`,
      };
    }

    if (!first) await sleep(REQUEST_SPACING_MS);
    first = false;

    let page: Awaited<ReturnType<typeof fetchPage>>;
    try {
      page = await fetchPage(next.path);
    } catch (err) {
      return {
        rows: [...rows.values()],
        pagesRead,
        complete: false,
        message: err instanceof Error ? err.message : "Delcampe's category list could not be read.",
      };
    }

    if (page && "rateLimited" in page) {
      refusals += 1;
      if (refusals >= RATE_LIMIT_GIVE_UP) {
        return {
          rows: [...rows.values()],
          pagesRead,
          complete: false,
          message:
            "Delcampe asked us to slow down, so the walk stopped. What was already known is kept, " +
            "and the next daily pass carries on from a clean start.",
        };
      }
      // The page was never read, so it goes back on the queue rather than being skipped.
      seen.delete(next.path);
      queue.unshift(next);
      await sleep(RATE_LIMIT_BACKOFF_MS);
      continue;
    }

    pagesRead += 1;
    // A page that answered with something other than a category list — a redirect, an error page —
    // is one page that said nothing, not a reason to abandon the walk.
    if (!page) continue;

    const parsed = parseDelcampeCategoryPage(page.html);
    for (const entry of parsed.entries) {
      const row = delcampeCategoryRow(entry, next.trail);
      rows.set(row.id, row);
    }
    for (const link of parsed.links) {
      if (!link.href.includes("/category-id/stamps")) continue;
      queue.push({ path: link.href, trail: [...next.trail, ...link.trail, link.name] });
    }
  }

  return { rows: [...rows.values()], pagesRead, complete: true, message: null };
}

/**
 * Read Delcampe's list and store it.
 *
 * A **complete** pass replaces the table outright; a pass cut short only refreshes what it managed to
 * read. A category Delcampe retired therefore stops arriving and stops being offered — while an offer
 * already prepared keeps the name it was given, that being a display snapshot on the offer rather
 * than a lookup (ADR-0025 §3).
 */
export async function refreshDelcampeCategories(): Promise<DelcampeCatalogRefresh> {
  // One pass at a time, for the whole process. Two are easy to start — the daily timer firing while
  // somebody is watching **Read it now**, or a second click on it — and two walks of the same site at
  // once is exactly the traffic the pacing exists to avoid. The second caller waits for the first
  // rather than being refused: it asked for the list to be current, and when the first finishes it is.
  const running = inFlight();
  if (running) return running;
  const pass = runRefresh().finally(() => rememberPass(null));
  rememberPass(pass);
  return pass;
}

const globalPass = globalThis as unknown as {
  __stamporamaDelcampeRefresh?: Promise<DelcampeCatalogRefresh> | null;
};

function inFlight(): Promise<DelcampeCatalogRefresh> | null {
  return globalPass.__stamporamaDelcampeRefresh ?? null;
}

function rememberPass(next: Promise<DelcampeCatalogRefresh> | null): void {
  globalPass.__stamporamaDelcampeRefresh = next;
}

async function runRefresh(): Promise<DelcampeCatalogRefresh> {
  const { rows, pagesRead, complete, message } = await crawlDelcampeCategories();
  const refreshedAt = new Date();

  if (complete && rows.length > 0) {
    // A complete pass **is** the whole list, so it is written as one: empty the table and insert,
    // inside a single transaction. Under Postgres's MVCC a reader mid-refresh sees yesterday's rows
    // right up to the commit and today's after it, never an empty picker — which a delete outside a
    // transaction, or seven thousand upserts, would both expose. It is also the difference between
    // one statement per thousand rows and one per row.
    await prisma.$transaction([
      prisma.delcampeCategory.deleteMany({}),
      ...chunk(rows, 1_000).map((batch) =>
        prisma.delcampeCategory.createMany({
          data: batch.map((row) => ({ id: row.id, name: row.name, path: row.path, refreshedAt })),
        })
      ),
    ]);
  } else {
    // A pass cut short has no opinion about what it never reached, so it only refreshes what it read
    // and deletes nothing. Upserts here rather than an insert, the rows being a subset that overlaps
    // whatever is already stored.
    for (const row of rows) {
      await prisma.delcampeCategory.upsert({
        where: { id: row.id },
        create: { id: row.id, name: row.name, path: row.path, refreshedAt },
        update: { name: row.name, path: row.path, refreshedAt },
      });
    }
  }

  remember(null);
  return { read: rows.length, pagesRead, complete, message };
}

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Whether any collection on this instance has named a Delcampe platform. The refresh is somebody
 *  else's site, so an instance that does not list there does not walk it. */
export async function anyCollectionListsOnDelcampe(): Promise<boolean> {
  const contact = await prisma.contact.findFirst({
    where: { platform: true, platformModule: DELCAMPE_PLATFORM_MODULE },
    select: { id: true },
  });
  return contact !== null;
}

/**
 * Every category the picker searches: what a refresh stored, or the checked-in snapshot until one
 * has.
 *
 * Read whole and searched in memory, because the search is over **word starts within a path** and
 * that is not a query SQL answers well — and because the alternative to holding it is re-reading
 * seven thousand rows on every keystroke.
 *
 * Held on `globalThis` for the reason every long-lived object in this app is (`db.ts`): `next dev`
 * re-evaluates a module on each edit, and a cache pinned to the module is a cache that leaks a copy
 * per edit. Invalidated by what the refresh writes — the row count and the newest `refreshedAt` —
 * rather than by a timer, so a pass finishing is what replaces it and nothing goes stale on its own.
 */
export async function readDelcampeCategories(): Promise<DelcampeCategoryRow[]> {
  const status = await delcampeCategoryCatalogStatus();
  // The snapshot is a **fallback, never a merge**: once a pass has stored anything, the stored rows
  // are the answer. Two sources blended would make "why is this category still offered?"
  // unanswerable, and a category Delcampe retired is a thing the collector should see disappear.
  if (status.source === "bundled") return DELCAMPE_CATEGORY_SEED;

  const stamp = `${status.count}|${status.lastRefreshedAt ?? ""}`;
  const held = cache();
  if (held?.stamp === stamp) return held.rows;

  const rows = await prisma.delcampeCategory.findMany({
    orderBy: { path: "asc" },
    select: { id: true, name: true, path: true },
  });
  remember({ stamp, rows });
  return rows;
}

const globalCache = globalThis as unknown as {
  __stamporamaDelcampeCategories?: { stamp: string; rows: DelcampeCategoryRow[] } | null;
};

function cache(): { stamp: string; rows: DelcampeCategoryRow[] } | null {
  return globalCache.__stamporamaDelcampeCategories ?? null;
}

function remember(next: { stamp: string; rows: DelcampeCategoryRow[] } | null): void {
  globalCache.__stamporamaDelcampeCategories = next;
}

/** How current the catalogue is, for the sentence Settings → Delcampe states above **Read it now**.
 *  A snapshot this app shipped with and a list it read itself are different things and read
 *  differently — one is dated by a release, the other by a pass. */
export interface DelcampeCatalogStatus {
  count: number;
  /** When the stored list was last read from Delcampe, or null while none has been. */
  lastRefreshedAt: string | null;
  /** Whether the picker is working from a stored pass or from the checked-in snapshot. */
  source: "read" | "bundled";
}

export async function delcampeCategoryCatalogStatus(): Promise<DelcampeCatalogStatus> {
  const [count, latest] = await Promise.all([
    prisma.delcampeCategory.count(),
    prisma.delcampeCategory.findFirst({
      orderBy: { refreshedAt: "desc" },
      select: { refreshedAt: true },
    }),
  ]);
  if (count === 0) {
    return {
      count: DELCAMPE_CATEGORY_SEED.length,
      lastRefreshedAt: DELCAMPE_CATEGORY_SEED_READ_AT,
      source: "bundled",
    };
  }
  return { count, lastRefreshedAt: latest?.refreshedAt.toISOString() ?? null, source: "read" };
}

/** How old a snapshot has to be before a pass is worth making. Under a day, so the daily timer
 *  always finds it stale, and comfortably over the gap between two boots — a dev server restarting
 *  every few minutes must not walk somebody else's site every few minutes. */
const STALE_AFTER_MS = 20 * 60 * 60 * 1000;

/**
 * The daily pass, and the one made shortly after boot.
 *
 * Three things it declines to do, each of which is the reason it can be scheduled at all: it does
 * nothing on an instance that has not named a Delcampe platform (the walk is somebody else's site,
 * and an instance that does not list there has no business reading it), nothing while the snapshot
 * is younger than {@link STALE_AFTER_MS} (so a restart is not a crawl), and nothing to the stored
 * rows when a pass is cut short.
 */
export async function refreshDelcampeCategoriesIfStale(): Promise<DelcampeCatalogRefresh | null> {
  if (!(await anyCollectionListsOnDelcampe())) return null;
  const status = await delcampeCategoryCatalogStatus();
  // The checked-in snapshot is never "fresh enough": it is as old as the release, and the first pass
  // on a new instance is what turns it into something current.
  if (
    status.source === "read" &&
    status.lastRefreshedAt &&
    Date.now() - Date.parse(status.lastRefreshedAt) < STALE_AFTER_MS
  ) {
    return null;
  }
  return refreshDelcampeCategories();
}
