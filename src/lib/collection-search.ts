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
import { buildPrimaryVendorByAreaMap } from "./pricing";
import { sortPhotos } from "./photos";
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
  conditions: CollectionSearchAxisValue[];
  certificates: CollectionSearchAxisValue[];
  formats: CollectionSearchAxisValue[];
  priority: WantPriority;
  here: number;
  coming: number;
}

/**
 * One value an acceptance axis (or a copy's own axis) takes, said **twice**.
 *
 * `abbr` is what a chip reads — `MNH`, `PC`, `Pair` — because a want accepting four conditions and
 * two certificates is six chips on one row, and six spelled-out names is a paragraph. `name` is what
 * the chip's hover says, since an abbreviation is only a handle for a collector who already knows
 * the dictionary, and this window is read at an auction by someone comparing it against a listing
 * written in somebody else's words. A dictionary row with no abbreviation falls back to its name in
 * both, exactly as `loadStampWantSummaries` does.
 */
export interface CollectionSearchAxisValue {
  abbr: string;
  name: string;
}

/**
 * One catalog number as a row's chip draws it, the **primary** catalog's marked.
 *
 * A label alone cannot say which of three numbers is the one the collector thinks in (#181/#357):
 * `Fi·PL 45I`, `Mi·PL 43` and `Yt·PL 89` are one stamp read out of three catalogues, and which one
 * leads depends on the area's primary catalog rather than on the order they happen to be stored in.
 * So the ordering is done here — primary first — and the flag travels with it, because the window
 * draws the leading chip differently rather than merely putting it first.
 */
export interface CollectionSearchCatalogLabel {
  label: string;
  isPrimary: boolean;
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
  /** Formatted catalog labels, primary catalog first (`[{ label: "Mi·PL 200", isPrimary: true }]`). */
  catalogNumbers: CollectionSearchCatalogLabel[];
  /** The stamp's lead **catalog** photo (#137), or null — front → back → extras, the ordering every
   *  other list row's thumbnail takes. Metadata is not sent: the id is what the collection-scoped
   *  serving route addresses the bytes by, and the caller is the one holding the token. */
  photoId: string | null;
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
  /** Where the stamp sits in the collection's areas, and which set it is from — the same three
   *  facts a stamp row states, because a copy row is asked the same "which stamp is this?" first. */
  areaName: string | null;
  issueName: string | null;
  issueYear: number | null;
  catalogNumbers: CollectionSearchCatalogLabel[];
  /** The copy's own lead photo (#112), falling back to its stamp's catalog photo (#137) when it has
   *  none. The window is opened to recognise a stamp rather than to audit which copies have been
   *  photographed, and a thumbnail column empty on most rows is worse than the catalogue picture. */
  photoId: string | null;
  condition: CollectionSearchAxisValue;
  /** Null is "no certificate" (ADR-0006 §2), which the row leaves unsaid rather than chipping. */
  certificate: CollectionSearchAxisValue | null;
  /** Null is *single* (ADR-0020) — no such dictionary row exists, so there is nothing to draw. */
  format: CollectionSearchAxisValue | null;
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
  // Every stamp a row on this page is about — the matched catalogue rows *and* the stamps the copies
  // are of, which are not the same set: a copy is found by its shelf reference or its own notes
  // while its stamp matched nothing, and its row still wants the catalogue's picture.
  const photoStampIds = [...new Set([...stampIds, ...copyPage.items.map((i) => i.stampId)])];

  const [counts, wants, catalog, axes, stampPhotos, stampNumbers] = await Promise.all([
    loadStampCopyCounts(collectionId, stampIds),
    loadStampWantSummaries(collectionId, stampIds),
    makeCatalogLabeller(collectionId, vendors),
    loadAxisDictionaries(collectionId),
    loadStampLeadPhotos(photoStampIds),
    // The matched stamps' numbers as **pairs**, which the picker's own answer has already resolved
    // to strings — and a string cannot be ordered by vendor. Read again rather than widening the
    // picker's row: what leads a chip row is this window's question, not the picker's.
    stampIds.length > 0
      ? prisma.stamp.findMany({
          where: { id: { in: stampIds } },
          select: {
            id: true,
            catalogNumbers: { select: { catalogVendorId: true, number: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  const numbersByStamp = new Map(stampNumbers.map((s) => [s.id, s.catalogNumbers]));

  return {
    query: text,
    stamps: stampHits.map((s) => ({
      stampId: s.stampId,
      name: s.name,
      issuedYear: s.issuedYear,
      areaName: s.areaName,
      issueName: s.issueName,
      issueYear: s.issueYear,
      catalogNumbers: catalog.labelFor(
        s.areaId,
        s.issueId,
        numbersByStamp.get(s.stampId) ?? []
      ),
      photoId: stampPhotos.get(s.stampId) ?? null,
      subtype: s.subtype,
      hasVariants: s.hasVariants,
      isVariant: s.isVariant,
      copies: counts.direct.get(s.stampId)?.total ?? 0,
      variantCopies: counts.variant.get(s.stampId)?.total ?? 0,
      wants: toSearchWants(wants.get(s.stampId), axes),
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
      areaName: item.areaId ? (catalog.areaName.get(item.areaId) ?? null) : null,
      issueName: item.issueName,
      issueYear: item.issueYear,
      catalogNumbers: catalog.labelFor(item.areaId, item.issueId, item.catalogNumbers),
      photoId: item.photos[0]?.id ?? stampPhotos.get(item.stampId) ?? null,
      condition: {
        abbr: item.conditionAbbreviation || item.conditionName,
        name: item.conditionName,
      },
      certificate: item.certificateStatusId
        ? (axes.certificate.get(item.certificateStatusId) ?? null)
        : null,
      format: item.formatId
        ? {
            abbr: item.formatAbbreviation || item.formatName || "?",
            name: item.formatName ?? "?",
          }
        : null,
      locationRef: item.locationRef,
      inCollection: item.inCollection,
      forSale: item.forSale,
      forTrade: item.forTrade,
      path: `${base}/inventory/${item.id}`,
    })),
  };
}

/**
 * The **lead** photo of each of `stampIds`, front → back → extras (#137).
 *
 * One read for the page rather than a relation on each of three searches: two of them (the picker's,
 * the Copies list's) are shared with screens that do not draw this window's thumbnail, and the third
 * is looked up by stamp id anyway.
 */
async function loadStampLeadPhotos(stampIds: string[]): Promise<Map<string, string>> {
  const lead = new Map<string, string>();
  if (stampIds.length === 0) return lead;
  const photos = await prisma.photo.findMany({
    where: { stampId: { in: stampIds } },
    select: { id: true, stampId: true, role: true, sortOrder: true },
  });
  const byStamp = new Map<string, typeof photos>();
  for (const p of photos) {
    if (!p.stampId) continue; // the column is nullable in general; the filter above cannot return one
    const list = byStamp.get(p.stampId);
    if (list) list.push(p);
    else byStamp.set(p.stampId, [p]);
  }
  for (const [stampId, list] of byStamp) {
    const first = [...list].sort((a, b) =>
      sortPhotos(
        { role: normalizePhotoRole(a.role), sortOrder: a.sortOrder },
        { role: normalizePhotoRole(b.role), sortOrder: b.sortOrder }
      )
    )[0];
    if (first) lead.set(stampId, first.id);
  }
  return lead;
}

/** The three roles `sortPhotos` ranks; anything else sorts with the extras. */
function normalizePhotoRole(role: string | null): "front" | "back" | "main" | null {
  return role === "front" || role === "back" || role === "main" ? role : null;
}

/** What a copy's and a want's axis chips read, by id. Loaded whole — these are dictionaries of a
 *  handful of rows each, and a page of ten copies would otherwise be ten joins for two words. */
interface AxisDictionaries {
  condition: Map<string, CollectionSearchAxisValue>;
  certificate: Map<string, CollectionSearchAxisValue>;
  format: Map<string, CollectionSearchAxisValue>;
}

async function loadAxisDictionaries(collectionId: string): Promise<AxisDictionaries> {
  const [conditions, certificates, formats] = await Promise.all([
    prisma.stampCondition.findMany({
      where: { collectionId },
      select: { id: true, name: true, abbreviation: true },
    }),
    prisma.certificateStatus.findMany({
      where: { collectionId },
      select: { id: true, name: true, abbreviation: true },
    }),
    prisma.stampFormat.findMany({
      where: { collectionId },
      select: { id: true, name: true, abbreviation: true },
    }),
  ]);
  const index = (rows: { id: string; name: string; abbreviation: string | null }[]) =>
    new Map(rows.map((r) => [r.id, { abbr: r.abbreviation || r.name, name: r.name }]));
  return {
    condition: index(conditions),
    certificate: index(certificates),
    format: index(formats),
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
function toSearchWants(
  summary: StampWantSummary | undefined,
  axes: AxisDictionaries
): CollectionSearchWants | null {
  if (!summary || summary.openCount === 0) return null;
  // The summary states each axis as prose (`"MNH, MH, MNG"`, `"Certificate: any"`) for the app's own
  // popover; a row of chips needs the values apart, so they are rebuilt from the **ids** the same
  // summary carries. An empty acceptance set stays an empty list rather than becoming an "any"
  // label here: a blank axis and an unanswered one mean opposite things (ADR-0032 §1), and which
  // words say so is the window's business.
  const values = <T extends string | null>(
    ids: readonly T[],
    dictionary: Map<string, CollectionSearchAxisValue>,
    noneLabel: string
  ): CollectionSearchAxisValue[] =>
    ids.map((id) =>
      id === null
        ? { abbr: noneLabel, name: noneLabel }
        : (dictionary.get(id) ?? { abbr: "?", name: "?" })
    );

  return {
    openCount: summary.openCount,
    topPriority: summary.topPriority,
    wants: summary.entries.map((entry) => ({
      conditions: values(entry.acceptance.conditionIds, axes.condition, "None"),
      // `null` is a member of these two rather than the absence of one (ADR-0032 §3): "no
      // certificate" (ADR-0006 §2) and "single" (ADR-0020), neither of which is a dictionary row.
      certificates: values(entry.acceptance.certificateStatusIds, axes.certificate, "No cert."),
      formats: values(entry.acceptance.formatIds, axes.format, "Single"),
      priority: entry.priority,
      // `toSort` folds into *here*: a copy arrived but unfiled is one in hand, and the distinction
      // the want list draws — sorted vs. on the desk — decides nothing while standing at an auction.
      here: entry.copies.held + entry.copies.toSort,
      coming: entry.copies.ordered + entry.copies.inTransit,
    })),
  };
}

/** What the page needs to draw a row's catalog chips and name its area. */
interface CatalogLabelling {
  labelFor: (
    areaId: string | null,
    issueId: string | null,
    numbers: readonly { catalogVendorId: string; number: string }[]
  ) => CollectionSearchCatalogLabel[];
  /** Area names by id — the copies' read model carries only the id, and a copy row says where its
   *  stamp sits exactly as a stamp row does. */
  areaName: Map<string, string>;
}

/**
 * Build the labeller that turns stored catalog numbers into the labels the collector reads
 * (`"Mi·PL 200"`), the area's primary catalog first.
 *
 * The Copies list read model carries the raw `{ vendorId, number }` pairs and resolves the display
 * on the client; a row here has to be recognisable from the number that was searched for, so the
 * same resolution — vendor abbreviation + effective area prefix, with the issue's override (#377)
 * winning — happens once for the page rather than per row.
 *
 * The **ordering** is the same question the pickers' `orderedCatalogLabels` answers (#357/#181): a
 * stamp read out of three catalogues has one number its collector thinks in, and it is the one the
 * area's primary catalog names. It is resolved server-side here because the window is a plain page
 * with no area tree of its own to resolve it against.
 */
async function makeCatalogLabeller(
  collectionId: string,
  vendors: readonly { id: string; abbreviation: string }[]
): Promise<CatalogLabelling> {
  const [areaRows, issuePrefixes, primaryVendorByArea] = await Promise.all([
    prisma.collectionArea.findMany({
      where: { collectionId },
      select: {
        id: true,
        name: true,
        parentId: true,
        catalogPrefix: true,
        collectionAreaVendors: { select: { catalogVendorId: true, areaPrefix: true } },
      },
    }),
    loadIssuePrefixMap(collectionId),
    buildPrimaryVendorByAreaMap(collectionId),
  ]);
  const abbrOf = new Map(vendors.map((v) => [v.id, v.abbreviation]));
  const nodes = buildAreaPrefixNodes(areaRows);

  return {
    areaName: new Map(areaRows.map((a) => [a.id, a.name])),
    labelFor: (areaId, issueId, numbers) => {
      const primaryVendorId = areaId ? (primaryVendorByArea.get(areaId) ?? null) : null;
      const ordered = primaryVendorId
        ? [
            ...numbers.filter((cn) => cn.catalogVendorId === primaryVendorId),
            ...numbers.filter((cn) => cn.catalogVendorId !== primaryVendorId),
          ]
        : [...numbers];
      return ordered.map((cn) => ({
        label: formatCatalogNumber(
          abbrOf.get(cn.catalogVendorId) ?? "",
          effectivePrefixFor(areaId, cn.catalogVendorId, nodes, issueId, issuePrefixes),
          cn.number
        ),
        // An area with no primary catalog marks none of them: pretending the first stored number is
        // the leading one would put a stamp's identity in the order rows happen to come back in.
        isPrimary: primaryVendorId !== null && cn.catalogVendorId === primaryVendorId,
      }));
    },
  };
}
