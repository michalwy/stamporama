import "server-only";
import { prisma } from "./db";
import { searchStampsForPicker } from "./stamps";
import { searchIssues } from "./issues";
import { listItemsPaginated } from "./items";
import { loadStampCopyCounts } from "./copy-counts";
import { loadStampWantSummaries, type StampWantSummary } from "./wants";
import type { WantPriority } from "./want-rules";
import { formatCatalogNumber, parseCatalogSearch } from "./catalog-number";
import { buildAreaPrefixNodes, effectivePrefixFor } from "./area-prefix";
import { loadIssuePrefixMap } from "./issue-prefix";
import type { SubtypeLabel } from "./variant-classification";

// One text, three answers: "have I got this?" asked from outside the app (#529).
//
// The Assistant's context menu sends a catalog number selected on an auction listing — or any other
// text — and this is what it lands on. Nothing here decides what *matches*: the stamp half is the
// inventory picker's own search (#104/#73), the issue half is the issue picker's (#73), the copy
// half is the Copies list's (#106). Three searches rather than one, because the three lists a
// collector reads already disagree about what a query means, and inventing a fourth notion here
// would answer a question none of the screens would then repeat.
//
// The *stamps* group is the one that carries the answer the collector came for: a catalog number is
// a stamp's identity, and how many copies are held hangs off the stamp rather than off the text.
// Issues and copies are the surrounding context — which set it belongs to, and which pieces in hand
// it might be.
//
// Every row states a **relative** path. The instance answers where a row is on *itself*; the origin
// is the one the caller authenticated against and is composed there (as #466's offer lookup does).
// An answer that named its own origin would be an answer that could point somewhere else.

/**
 * One open want, as a row of this window states it.
 *
 * The want list's own wording per axis (ADR-0032 §1: "any …" included, because a blank axis and an
 * unanswered one look identical and mean opposite things), because *which* condition is wanted is
 * most of the answer at an auction — a stamp held used and wanted mint is a stamp to bid on.
 *
 * The two figures are **per want**, not per stamp: `here` counts copies that would satisfy *this*
 * want and `coming` the ones already ordered or in transit for it, which is what stops a second
 * purchase of something already on its way. They are folded down from the app's four delivery
 * buckets — a copy arrived but unsorted counts as here, since it is in hand however unfiled.
 */
export interface CollectionSearchWant {
  conditions: string;
  certificate: string;
  format: string;
  priority: WantPriority;
  here: number;
  coming: number;
}

/** What a stamp's open wants say, or null when none are open. */
export interface CollectionSearchWants {
  openCount: number;
  /** The loudest of them — one row carries one chip however many wants sit behind it. */
  topPriority: WantPriority;
  wants: CollectionSearchWant[];
}

/** One stamp, with what the collection holds of it. */
export interface CollectionSearchStamp {
  stampId: string;
  name: string | null;
  issuedYear: number | null;
  areaName: string | null;
  issueName: string | null;
  issueYear: number | null;
  /** Formatted catalog labels, e.g. `["Mi·PL 200"]`. */
  catalogNumbers: string[];
  subtype: SubtypeLabel | null;
  /** True for a base stamp that has variants — the copies below may be filed on a child. */
  hasVariants: boolean;
  isVariant: boolean;
  /** Copies held of this stamp exactly (#348). Zero is the answer *"not held"*, which is as much
   *  of an answer as any other number and is why it is always present. */
  copies: number;
  /** Copies held under this stamp's variant descendants (#528) — the second figure a catalog row
   *  shows, and the one that keeps an umbrella from reading as "not held" when the pieces are
   *  filed one level down. */
  variantCopies: number;
  /**
   * The open wants recorded for this stamp (#532), or null when there are none.
   *
   * The figure this window is most often opened for. Holding a copy does not close a want, so
   * *held* and *wanted* are independent answers and the second is the one that decides a bid: a
   * stamp already in the collection may be exactly what is still being looked for in another
   * condition, and one held in quantity may be wanted by nobody. A count that only ever said how
   * many are held would answer the easier half of the question.
   */
  wants: CollectionSearchWants | null;
  path: string;
}

export interface CollectionSearchIssue {
  issueId: string;
  name: string | null;
  year: number | null;
  path: string;
}

/** One copy in hand. Deliberately lean — the question is *which piece is this*, not the copy's
 *  whole read model. */
export interface CollectionSearchCopy {
  itemId: string;
  itemNo: number;
  stampName: string | null;
  issueName: string | null;
  catalogNumbers: string[];
  conditionName: string;
  formatName: string | null;
  /** The shelf reference it is filed under (#303), or null. */
  locationRef: string | null;
  /**
   * What the copy is *for* (#99/#550) — the same three flags the inventory row wears as chips.
   *
   * A copy found from outside the app answers "have I got this?" only halfway: whether the one in
   * hand is a keeper, a duplicate already offered for sale, or trade material decides whether the
   * lot in front of the collector is worth bidding on at all. They are three independent flags and
   * not one state, exactly as they are on the copy itself — a duplicate kept in the collection until
   * it sells is both.
   */
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  path: string;
}

export interface CollectionSearchResult {
  /** What was actually searched for, trimmed — the window echoes it back into its own box. */
  query: string;
  stamps: CollectionSearchStamp[];
  issues: CollectionSearchIssue[];
  copies: CollectionSearchCopy[];
}

/** How many copies come back. The stamps group is the headline and keeps the picker's own 20; the
 *  copies are the long tail of one stamp held many times over, and a preview window is not the
 *  Copies list. */
const COPY_LIMIT = 10;

const EMPTY: Omit<CollectionSearchResult, "query"> = { stamps: [], issues: [], copies: [] };

/**
 * Search one collection's stamps, issues and copies for `query`.
 *
 * An empty query is an **empty answer**, not an error: the window opens on whatever was selected,
 * and a selection that turns out to be whitespace is nothing to report a failure about.
 */
export async function searchCollection(
  ownerId: string,
  collectionId: string,
  query: string
): Promise<CollectionSearchResult> {
  // Ownership and the slug in one read, for `resolveQuickJump`'s reason: the paths this returns are
  // addresses the collector is about to follow, and the only slug that can be right is the one
  // belonging to the collection just authorized. Asserted **before** the empty-query short-circuit,
  // so an unauthorized caller is refused whatever they asked for. The three searches below assert
  // again on their own — each is entered from elsewhere too, and neither trusts this.
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, slug: true },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  const base = `/c/${encodeURIComponent(collection.slug)}`;

  const text = query.trim();
  if (!text) return { query: text, ...EMPTY };

  // The prefixed-catalog parse the Copies list does off its own box (#146), so `"Mi PL 200"` reaches
  // the stored `"200"` here exactly as it does there. The stamp search parses the same text itself.
  const vendors = await prisma.catalogVendor.findMany({
    where: { collectionId },
    select: { id: true, abbreviation: true },
  });
  const parsed = parseCatalogSearch(text, vendors);

  const [stampHits, issueHits, copyPage] = await Promise.all([
    searchStampsForPicker(ownerId, collectionId, text),
    searchIssues(ownerId, collectionId, text),
    listItemsPaginated(ownerId, collectionId, {
      search: text,
      catalogVendorId: parsed.vendorId ?? undefined,
      catalogNumber: parsed.number || undefined,
      pageSize: COPY_LIMIT,
    }),
  ]);

  const stampIds = stampHits.map((s) => s.stampId);
  const [counts, wants] = await Promise.all([
    loadStampCopyCounts(collectionId, stampIds),
    loadStampWantSummaries(collectionId, stampIds),
  ]);

  const labelFor = await makeCopyCatalogLabeller(collectionId, vendors);

  return {
    query: text,
    stamps: stampHits.map((s) => ({
      stampId: s.stampId,
      name: s.name,
      issuedYear: s.issuedYear,
      areaName: s.areaName,
      issueName: s.issueName,
      issueYear: s.issueYear,
      catalogNumbers: s.catalogNumbers,
      subtype: s.subtype,
      hasVariants: s.hasVariants,
      isVariant: s.isVariant,
      copies: counts.direct.get(s.stampId)?.total ?? 0,
      variantCopies: counts.variant.get(s.stampId) ?? 0,
      wants: toSearchWants(wants.get(s.stampId)),
      path: `${base}/stamps/${s.stampId}`,
    })),
    issues: issueHits.map((i) => ({
      issueId: i.id,
      name: i.name,
      year: i.year,
      path: `${base}/issues/${i.id}`,
    })),
    copies: copyPage.items.map((item) => ({
      itemId: item.id,
      itemNo: item.itemNo,
      stampName: item.stampName,
      issueName: item.issueName,
      catalogNumbers: labelFor(item.areaId, item.issueId, item.catalogNumbers),
      conditionName: item.conditionName,
      formatName: item.formatName,
      locationRef: item.locationRef,
      inCollection: item.inCollection,
      forSale: item.forSale,
      forTrade: item.forTrade,
      path: `${base}/inventory/${item.id}`,
    })),
  };
}

/**
 * Narrow a catalogue row's want summary to what this window shows.
 *
 * The full summary carries the acceptance **ids** so a surface holding a concrete copy can ask
 * whether it would satisfy the want; nothing here holds one — the collector is looking at somebody
 * else's listing — so the words are kept and the ids are dropped rather than sent to a window that
 * could only mis-use them.
 */
function toSearchWants(summary: StampWantSummary | undefined): CollectionSearchWants | null {
  if (!summary || summary.openCount === 0) return null;
  return {
    openCount: summary.openCount,
    topPriority: summary.topPriority,
    wants: summary.entries.map((entry) => ({
      conditions: entry.conditions,
      certificate: entry.certificate,
      format: entry.format,
      priority: entry.priority,
      // `toSort` folds into *here*: a copy arrived but unfiled is one in hand, and the distinction
      // the want list draws — sorted vs. on the desk — decides nothing while standing at an auction.
      here: entry.copies.held + entry.copies.toSort,
      coming: entry.copies.ordered + entry.copies.inTransit,
    })),
  };
}

/**
 * Build the labeller that turns a copy's stored catalog numbers into the labels the collector reads
 * (`"Mi·PL 200"`).
 *
 * The Copies list read model carries the raw `{ vendorId, number }` pairs and resolves the display
 * on the client; a copy row here has to be recognisable from the number that was searched for, so
 * the same resolution — vendor abbreviation + effective area prefix, with the issue's override
 * (#377) winning — happens once for the page rather than per row.
 */
async function makeCopyCatalogLabeller(
  collectionId: string,
  vendors: readonly { id: string; abbreviation: string }[]
): Promise<
  (
    areaId: string | null,
    issueId: string | null,
    numbers: { catalogVendorId: string; number: string }[]
  ) => string[]
> {
  const [areaRows, issuePrefixes] = await Promise.all([
    prisma.collectionArea.findMany({
      where: { collectionId },
      select: {
        id: true,
        name: true,
        parentId: true,
        collectionAreaVendors: { select: { catalogVendorId: true, areaPrefix: true } },
      },
    }),
    loadIssuePrefixMap(collectionId),
  ]);
  const abbrOf = new Map(vendors.map((v) => [v.id, v.abbreviation]));
  const nodes = buildAreaPrefixNodes(areaRows);

  return (areaId, issueId, numbers) =>
    numbers.map((cn) =>
      formatCatalogNumber(
        abbrOf.get(cn.catalogVendorId) ?? "",
        effectivePrefixFor(areaId, cn.catalogVendorId, nodes, issueId, issuePrefixes),
        cn.number
      )
    );
}
