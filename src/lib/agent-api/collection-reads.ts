// What the collection reads answer with, and the projections that build it (#710).
//
// **Pure, and structurally typed on purpose** (`agent-api.md`, *The module layout is the Prisma-free
// split*). Everything here is a function of plain rows and returns plain objects — no Prisma, no
// `server-only`, and deliberately no `import type` from `items.ts` or `stamps.ts` either. The
// precedent is `src/lib/issue-stamp-match.ts`, which states structural types *"so it unit-tests
// without Prisma"*: the read models on the other side of that line carry sixty fields apiece, and a
// projection that named them would be unreadable as a statement of what an agent is actually told.
//
// The decisions worth a test all live here rather than in the handlers beside them: which fields
// survive, how a catalog number is spelled, that a null format and a null certificate are **absent**
// rather than invented, and that a figure never travels without the coverage counts that say how
// much of the collection is behind it.

import { agentPhotoUrl } from "./photo-url";

/**
 * Drop the keys that carry nothing.
 *
 * **`false` and `0` survive, and that is the whole of the rule.** `copies: 0` is the answer *not
 * held* and is as much of an answer as any other number (#348), and `forSale: false` is a
 * disposition the collector set. What goes is `null`, `undefined` and the empty string — a key
 * saying *there is nothing here* costs the agent context on every row and says what its absence
 * already says.
 *
 * It is the same rule the vocabulary's `label` follows (#708): omitted when absent, so a collection
 * with nothing to say pays nothing for the field.
 */
export function compact<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined || item === "") continue;
    out[key] = item;
  }
  return out as T;
}

/** A catalog label as the collection reads it, primary catalog first. */
export interface CatalogLabelRow {
  readonly label: string;
  readonly isPrimary: boolean;
}

/**
 * The catalog numbers as strings, the area's primary catalog first.
 *
 * **The order carries which one leads, and the flag is dropped.** `isPrimary` exists because the
 * app *draws* the leading chip differently (#181/#357); an agent reads a list, and a parallel array
 * of booleans is a second thing to line up for a fact the first element already states. The
 * `label` itself is the catalog identity — vendor abbreviation, the effective area prefix and the
 * number (#66/#377) — and it is what the collector would recognise.
 */
export function catalogLabels(rows: readonly CatalogLabelRow[]): string[] {
  return rows.map((row) => row.label);
}

/** The photo links for a row, or an empty list. Photos are URLs and never bytes (#706). */
export function photoUrls(
  collectionId: string,
  photos: readonly { readonly id: string }[]
): string[] {
  return photos.map((photo) => agentPhotoUrl(collectionId, photo.id));
}

/** One photo link, or null. The thumbnail variant, because a list row is a row and not a lightbox. */
export function leadPhotoUrl(collectionId: string, photoId: string | null): string | null {
  return photoId === null ? null : agentPhotoUrl(collectionId, photoId, "thumb");
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * One stamp a search matched.
 *
 * **`copies` and `variantCopies` are two answers and are never summed** (#348/#528): the first is
 * copies of this stamp exactly, the second copies filed under its variant descendants. Adding them
 * would report one copy twice on a tree whose child rows state their own figures.
 */
export interface AgentSearchStamp {
  readonly stampId: string;
  readonly name?: string;
  readonly issuedYear?: number;
  readonly area?: string;
  readonly issue?: string;
  readonly issueYear?: number;
  readonly catalogNumbers: string[];
  readonly subtype?: string;
  readonly isVariant: boolean;
  readonly hasVariants: boolean;
  readonly copies: number;
  readonly variantCopies: number;
  readonly openWants?: number;
  readonly photoUrl?: string;
  readonly path: string;
}

export interface AgentSearchIssue {
  readonly issueId: string;
  readonly name?: string;
  readonly year?: number;
  readonly path: string;
}

export interface AgentSearchCopy {
  readonly copyId: string;
  readonly itemNo: number;
  readonly stamp?: string;
  readonly area?: string;
  readonly issue?: string;
  readonly issueYear?: number;
  readonly catalogNumbers: string[];
  readonly condition: string;
  readonly certificate?: string;
  readonly format?: string;
  readonly locationRef?: string;
  readonly inCollection: boolean;
  readonly forSale: boolean;
  readonly forTrade: boolean;
  readonly photoUrl?: string;
  readonly path: string;
}

/**
 * What a search answers with.
 *
 * **Three groups rather than one tagged list, and the key is the tag.** #710 asks for results
 * *"tagged with what each one is"*, and the three searches behind this are three different searches
 * with three different notions of a match (`collection-search.ts`): the stamp half is the inventory
 * picker's, the issue half the issue picker's, the copy half the Copies list's. Merging them would
 * need a fourth notion of relevance to order one list by, which none of the three screens would then
 * repeat.
 *
 * **Each group says whether it was trimmed, and says it as *may be* rather than *is*.** The three
 * searches take a fixed number of rows and none of them counts the rest, so a group that came back
 * full is a group whose completeness is unknown — which is exactly what an agent has to be told, and
 * exactly what it cannot be told by silence (#706, *Every list response states the full `total`*).
 * Claiming a definite *there are more* would be a fact nothing here measured.
 */
export interface AgentSearchResult {
  readonly query: string;
  readonly stamps: AgentSearchStamp[];
  readonly stampsMayBeTrimmed: boolean;
  readonly issues: AgentSearchIssue[];
  readonly issuesMayBeTrimmed: boolean;
  readonly copies: AgentSearchCopy[];
  readonly copiesMayBeTrimmed: boolean;
}

/** A group is possibly trimmed exactly when it came back at the cap its search takes. */
export function mayBeTrimmed(returned: number, cap: number): boolean {
  return returned >= cap;
}

/** The axis value an agent sends back — the canonical `name`, never the abbreviation a chip reads.
 *  `name` is what `get_collection_vocabulary` says to send (#708), so a row echoing it round-trips. */
interface AxisValueRow {
  readonly name: string;
}

/** The row shape `searchCollection` states a stamp in. */
export interface SearchStampRow {
  readonly stampId: string;
  readonly name: string | null;
  readonly issuedYear: number | null;
  readonly areaName: string | null;
  readonly issueName: string | null;
  readonly issueYear: number | null;
  readonly catalogNumbers: readonly CatalogLabelRow[];
  readonly photoId: string | null;
  readonly subtype: { readonly name: string; readonly isDefault: boolean } | null;
  readonly hasVariants: boolean;
  readonly isVariant: boolean;
  readonly copies: number;
  readonly variantCopies: number;
  readonly wants: { readonly openCount: number } | null;
  readonly path: string;
}

/**
 * **The collection's default subtype renders nothing** (ADR-0010 §6): it is the row given
 * automatically to every new child, so it carries no information the variant tree did not already
 * give, and repeating it on every variant scales noise with the collection. The read models report
 * the subtype as stored and each surface drops the default; this is that drop, for this surface.
 */
export function subtypeName(
  subtype: { readonly name: string; readonly isDefault: boolean } | null
): string | null {
  return subtype && !subtype.isDefault ? subtype.name : null;
}

export function searchStamp(collectionId: string, row: SearchStampRow): AgentSearchStamp {
  return compact({
    stampId: row.stampId,
    name: row.name ?? undefined,
    issuedYear: row.issuedYear ?? undefined,
    area: row.areaName ?? undefined,
    issue: row.issueName ?? undefined,
    issueYear: row.issueYear ?? undefined,
    catalogNumbers: catalogLabels(row.catalogNumbers),
    subtype: subtypeName(row.subtype) ?? undefined,
    isVariant: row.isVariant,
    hasVariants: row.hasVariants,
    copies: row.copies,
    variantCopies: row.variantCopies,
    openWants: row.wants?.openCount ?? undefined,
    photoUrl: leadPhotoUrl(collectionId, row.photoId) ?? undefined,
    path: row.path,
  });
}

/** The row shape `searchCollection` states a copy in. */
export interface SearchCopyRow {
  readonly itemId: string;
  readonly itemNo: number;
  readonly stampName: string | null;
  readonly areaName: string | null;
  readonly issueName: string | null;
  readonly issueYear: number | null;
  readonly catalogNumbers: readonly CatalogLabelRow[];
  readonly photoId: string | null;
  readonly condition: AxisValueRow;
  readonly certificate: AxisValueRow | null;
  readonly format: AxisValueRow | null;
  readonly locationRef: string | null;
  readonly inCollection: boolean;
  readonly forSale: boolean;
  readonly forTrade: boolean;
  readonly path: string;
}

export function searchCopy(collectionId: string, row: SearchCopyRow): AgentSearchCopy {
  return compact({
    copyId: row.itemId,
    itemNo: row.itemNo,
    stamp: row.stampName ?? undefined,
    area: row.areaName ?? undefined,
    issue: row.issueName ?? undefined,
    issueYear: row.issueYear ?? undefined,
    catalogNumbers: catalogLabels(row.catalogNumbers),
    condition: row.condition.name,
    // **Absent rather than invented**, both of them. A null certificate *is* "no certificate"
    // (ADR-0006 §2) and a null format *is* the single (ADR-0020) — neither has a dictionary row, so
    // spelling one here would hand the agent a vocabulary value it could not find in
    // `get_collection_vocabulary` and could not send back. The result description says so.
    certificate: row.certificate?.name ?? undefined,
    format: row.format?.name ?? undefined,
    locationRef: row.locationRef ?? undefined,
    inCollection: row.inCollection,
    forSale: row.forSale,
    forTrade: row.forTrade,
    photoUrl: leadPhotoUrl(collectionId, row.photoId) ?? undefined,
    path: row.path,
  });
}

// ── One thing in full ────────────────────────────────────────────────────────

/**
 * A catalogue figure as this surface states one.
 *
 * `baseAmount` is the same money in the collection's own currency and is **omitted when the two
 * agree**, which is the ordinary case — a second copy of a figure already on the row is the kind of
 * field #706 names as the way to spend an agent's context on nothing.
 */
export interface AgentMoney {
  readonly amount: string;
  readonly currency: string;
  readonly baseAmount?: string;
  readonly baseCurrency: string;
}

export interface MoneyRow {
  readonly amount: string;
  readonly currency: string;
  readonly convertedAmount: string | null;
  readonly baseCurrency: string;
}

export function money(row: MoneyRow): AgentMoney {
  return compact({
    amount: row.amount,
    currency: row.currency,
    baseAmount: row.convertedAmount ?? undefined,
    baseCurrency: row.baseCurrency,
  });
}

/** How many copies are held of one stamp, by disposition. The markers **overlap** — a duplicate
 *  kept until it sells is in the collection *and* for sale — so they are listed and never summed
 *  (#348), and `unmarked` is counted rather than subtracted for exactly that reason. */
export interface AgentCopyCounts {
  readonly total: number;
  readonly inCollection: number;
  readonly forSale: number;
  readonly forTrade: number;
  readonly unmarked: number;
}

export interface AgentStampIssue {
  readonly issueId: string;
  readonly name?: string;
  readonly year?: number;
  /** The checklists of that issue this stamp is **on**. An issue's other checklists are the stamp
   *  form's business (#531) and say nothing about this stamp. */
  readonly checklists: string[];
}

export interface AgentStampDetail {
  readonly stampId: string;
  readonly name?: string;
  readonly issuedDay?: number;
  readonly issuedMonth?: number;
  readonly issuedYear?: number;
  readonly parentStampId?: string;
  readonly subtype?: string;
  readonly catalogNumbers: string[];
  readonly colnectId?: string;
  readonly area?: string;
  readonly issues: AgentStampIssue[];
  readonly catalogPrice?: AgentMoney;
  /** The headline figure is on a **non-latest** edition of its catalog (#91). */
  readonly catalogPriceStale?: boolean;
  /** The headline figure was **derived** from the single's by a format multiplier rather than
   *  recorded for the shown format (#343) — an estimate, not a catalogue figure. */
  readonly catalogPriceDerived?: boolean;
  readonly denomination?: string;
  readonly perforation?: string;
  readonly color?: string;
  readonly watermark?: string;
  readonly paper?: string;
  readonly printing?: string;
  readonly widthMm?: number;
  readonly heightMm?: number;
  readonly copies: AgentCopyCounts;
  readonly variantCopies: AgentCopyCounts;
  readonly openWants?: number;
  readonly photoUrls: string[];
  readonly path: string;
}

/** The row shape `getStampListItem` states a stamp in, narrowed to what is published. */
export interface StampDetailRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string | null;
  readonly issuedDay: number | null;
  readonly issuedMonth: number | null;
  readonly issuedYear: number | null;
  readonly colnectId: string | null;
  readonly subtype: { readonly name: string; readonly isDefault: boolean } | null;
  readonly issues: readonly {
    readonly issueId: string;
    readonly issueName: string | null;
    readonly issueYear: number | null;
    readonly checklists: readonly { readonly name: string; readonly on: boolean }[];
  }[];
  readonly mainCatalogPrice: MoneyRow | null;
  readonly mainCatalogPriceStale: boolean;
  readonly mainCatalogPriceDerived: boolean;
  readonly photos: readonly { readonly id: string }[];
  readonly copies: AgentCopyCounts;
  readonly variantCopies: AgentCopyCounts;
  readonly wants: { readonly openCount: number } | null;
  readonly attributes: {
    readonly denomination: string | null;
    readonly perforation: string | null;
    readonly color: string | null;
    readonly watermark: string | null;
    readonly paper: string | null;
    readonly printing: string | null;
  };
  readonly size: { readonly widthMm: number | null; readonly heightMm: number | null };
}

export function stampDetail(
  collectionId: string,
  row: StampDetailRow,
  extra: { readonly catalogNumbers: readonly CatalogLabelRow[]; readonly area: string | null; readonly path: string }
): AgentStampDetail {
  return compact({
    stampId: row.id,
    name: row.name ?? undefined,
    issuedDay: row.issuedDay ?? undefined,
    issuedMonth: row.issuedMonth ?? undefined,
    issuedYear: row.issuedYear ?? undefined,
    parentStampId: row.parentId ?? undefined,
    subtype: subtypeName(row.subtype) ?? undefined,
    catalogNumbers: catalogLabels(extra.catalogNumbers),
    colnectId: row.colnectId ?? undefined,
    area: extra.area ?? undefined,
    issues: row.issues.map((issue) =>
      compact({
        issueId: issue.issueId,
        name: issue.issueName ?? undefined,
        year: issue.issueYear ?? undefined,
        checklists: issue.checklists.filter((list) => list.on).map((list) => list.name),
      })
    ),
    catalogPrice: row.mainCatalogPrice ? money(row.mainCatalogPrice) : undefined,
    // `false` would survive `compact`, and a `false` on every stamp is a field that says nothing on
    // all but a few of them — so the flags are published only when they are true.
    catalogPriceStale: row.mainCatalogPriceStale || undefined,
    catalogPriceDerived: row.mainCatalogPriceDerived || undefined,
    // The six attributes are flattened onto the record rather than nested under `attributes`: every
    // one of them is null on most stamps, so a nested object would be a key that is always present
    // and almost always empty (#71, #736).
    denomination: row.attributes.denomination ?? undefined,
    perforation: row.attributes.perforation ?? undefined,
    color: row.attributes.color ?? undefined,
    watermark: row.attributes.watermark ?? undefined,
    paper: row.attributes.paper ?? undefined,
    printing: row.attributes.printing ?? undefined,
    // The stamp's **own** figures. Nothing is resolved through the checklist here: a detail read
    // reports what the record holds, and the borrowed figure belongs to the surfaces that draw
    // boxes with it (#763).
    widthMm: row.size.widthMm ?? undefined,
    heightMm: row.size.heightMm ?? undefined,
    copies: row.copies,
    variantCopies: row.variantCopies,
    openWants: row.wants?.openCount ?? undefined,
    photoUrls: photoUrls(collectionId, row.photos),
    path: extra.path,
  });
}

export interface AgentIssueChecklist {
  readonly checklistId: string;
  readonly name: string;
  readonly stampCount: number;
  readonly catalogTotal?: AgentMoney;
}

export interface AgentIssueDetail {
  readonly issueId: string;
  readonly issueNo: number;
  readonly name?: string;
  readonly year?: number;
  readonly area?: string;
  readonly catalogRanges: string[];
  /** Stamps filed under this issue, its variants included. */
  readonly memberCount: number;
  /** Distinct stamps on any of its checklists — the **union** (#531). With one checklist this is
   *  that checklist's size; with several it is not the sum, a stamp shared by two being counted
   *  once. */
  readonly requiredCount: number;
  readonly checklists: AgentIssueChecklist[];
  readonly photoUrls: string[];
  readonly path: string;
}

export interface IssueDetailRow {
  readonly id: string;
  readonly issueNo: number;
  readonly name: string | null;
  readonly year: number | null;
  readonly memberCount: number;
  readonly requiredCount: number;
  readonly checklists: readonly {
    readonly id: string;
    readonly name: string;
    readonly stampCount: number;
    readonly priceTotal: MoneyRow | null;
  }[];
  readonly photos: readonly { readonly id: string }[];
}

export function issueDetail(
  collectionId: string,
  row: IssueDetailRow,
  extra: { readonly catalogRanges: readonly string[]; readonly area: string | null; readonly path: string }
): AgentIssueDetail {
  return compact({
    issueId: row.id,
    issueNo: row.issueNo,
    name: row.name ?? undefined,
    year: row.year ?? undefined,
    area: extra.area ?? undefined,
    catalogRanges: [...extra.catalogRanges],
    memberCount: row.memberCount,
    requiredCount: row.requiredCount,
    checklists: row.checklists.map((list) =>
      compact({
        checklistId: list.id,
        name: list.name,
        stampCount: list.stampCount,
        // **Per checklist, never over the union** (#531): summing the union would count a stamp on
        // both a basic and a specialized list once, for a total answering neither question.
        catalogTotal: list.priceTotal ? money(list.priceTotal) : undefined,
      })
    ),
    photoUrls: photoUrls(collectionId, row.photos),
    path: extra.path,
  });
}

/** What one copy is worth from the catalogue, with the two things that qualify the figure. */
export interface AgentCopyValue {
  readonly amount?: string;
  readonly currency?: string;
  readonly baseAmount?: string;
  /** No catalogue price matched this copy's condition × certificate × format. */
  readonly unpriced?: boolean;
  /** The copy links to a base stamp with variants, so the figure is the **lowest** of its priced
   *  variants rather than a price for this piece (#238/#616) — an estimate, and marked as one. */
  readonly uncertain?: boolean;
}

export interface CopyValueRow {
  readonly amount: string | null;
  readonly currency: string | null;
  readonly baseAmountDisplay: string | null;
  readonly unpriced: boolean;
  readonly uncertain: boolean;
}

export function copyValue(row: CopyValueRow): AgentCopyValue {
  return compact({
    amount: row.amount ?? undefined,
    currency: row.currency ?? undefined,
    baseAmount: row.baseAmountDisplay ?? undefined,
    unpriced: row.unpriced || undefined,
    uncertain: row.uncertain || undefined,
  });
}

export interface AgentCopyDetail {
  readonly copyId: string;
  readonly itemNo: number;
  readonly stampId: string;
  readonly stamp?: string;
  /** The copy is filed on a base stamp that has variants, so which variant it is has not been
   *  decided (ADR-0007 §2). */
  readonly unknownVariant?: boolean;
  readonly subtype?: string;
  readonly catalogNumbers: string[];
  readonly area?: string;
  readonly issue?: string;
  readonly issueYear?: number;
  readonly condition: string;
  readonly certificate?: string;
  readonly format?: string;
  readonly inCollection: boolean;
  readonly forSale: boolean;
  readonly forTrade: boolean;
  readonly sold?: boolean;
  readonly location?: string;
  readonly locationRef?: string;
  readonly deliveryState: string;
  readonly disposedAt?: string;
  readonly disposalReason?: string;
  readonly catalogValue: AgentCopyValue;
  /** What this copy cost, in the collection's base currency. Absent while it is **pending** — the
   *  copy sits in a purchase lot whose pool has not been split yet (#123) — which is a different
   *  answer from *nothing was paid* and is why it is absent rather than zero. */
  readonly costBasis?: string;
  readonly notes?: string;
  readonly photoUrls: string[];
  readonly path: string;
}

/** The row shape `listItemsPaginated` states a copy in, narrowed to what is published. */
export interface CopyRow {
  readonly id: string;
  readonly itemNo: number;
  readonly stampId: string;
  readonly stampName: string | null;
  readonly unknownVariant: boolean;
  readonly subtype: { readonly name: string; readonly isDefault: boolean } | null;
  readonly sold: boolean;
  readonly catalogNumbers: readonly { readonly catalogVendorId: string; readonly number: string }[];
  readonly areaId: string | null;
  readonly issueId: string | null;
  readonly issueName: string | null;
  readonly issueYear: number | null;
  readonly conditionName: string;
  readonly certificateStatusName: string | null;
  readonly formatName: string | null;
  readonly inCollection: boolean;
  readonly forSale: boolean;
  readonly forTrade: boolean;
  readonly locationId: string | null;
  readonly locationRef: string | null;
  readonly deliveryState: string;
  readonly disposedAt: Date | null;
  readonly disposalReason: string | null;
  readonly costBasis: string | null;
  readonly notes: string | null;
  readonly photos: readonly { readonly id: string }[];
  readonly value: CopyValueRow;
}

/** What a handler resolves for a copy that its row carries only ids for. */
export interface HoldingContext {
  readonly catalogNumbers: readonly CatalogLabelRow[];
  /** The full filing path, root first (`Szafa 1 › Klaser A`). A ref only means anything inside its
   *  location (#421), so the two travel together or neither is an address. */
  readonly location: string | null;
}

/** The two further things a **detail** read resolves, and a list row deliberately does not — see
 *  {@link AgentHolding} for why a row is leaner than a record. */
export interface CopyContext extends HoldingContext {
  readonly area: string | null;
  readonly path: string;
}

export function copyDetail(
  collectionId: string,
  row: CopyRow,
  context: CopyContext
): AgentCopyDetail {
  return compact({
    copyId: row.id,
    itemNo: row.itemNo,
    stampId: row.stampId,
    stamp: row.stampName ?? undefined,
    unknownVariant: row.unknownVariant || undefined,
    subtype: subtypeName(row.subtype) ?? undefined,
    catalogNumbers: catalogLabels(context.catalogNumbers),
    area: context.area ?? undefined,
    issue: row.issueName ?? undefined,
    issueYear: row.issueYear ?? undefined,
    condition: row.conditionName,
    certificate: row.certificateStatusName ?? undefined,
    format: row.formatName ?? undefined,
    inCollection: row.inCollection,
    forSale: row.forSale,
    forTrade: row.forTrade,
    sold: row.sold || undefined,
    location: context.location ?? undefined,
    locationRef: row.locationRef ?? undefined,
    deliveryState: row.deliveryState,
    disposedAt: row.disposedAt ? row.disposedAt.toISOString() : undefined,
    disposalReason: row.disposalReason ?? undefined,
    catalogValue: copyValue(row.value),
    costBasis: row.costBasis ?? undefined,
    notes: row.notes ?? undefined,
    photoUrls: photoUrls(collectionId, row.photos),
    path: context.path,
  });
}

// ── Holdings ─────────────────────────────────────────────────────────────────

/**
 * One held copy, as a holdings list states it.
 *
 * **Leaner than {@link AgentCopyDetail} on purpose.** A list is read twenty-five rows at a time and
 * every field is paid for on each of them, so what survives here is what answers *what is it, in
 * what condition, and where* — the question #710's *Done when* asks. Everything else is one
 * `get_copy` away.
 */
export interface AgentHolding {
  readonly copyId: string;
  readonly itemNo: number;
  readonly stampId: string;
  readonly stamp?: string;
  readonly catalogNumbers: string[];
  readonly issue?: string;
  readonly issueYear?: number;
  readonly condition: string;
  readonly certificate?: string;
  readonly format?: string;
  readonly location?: string;
  readonly locationRef?: string;
  /** `delivered`, `to_sort`, `ordered` or `in_transit`. A copy on its way is bought and is counted
   *  here (ADR-0032 §7), and *you hold it* is still the wrong thing to say about it — which is what
   *  this field is for. */
  readonly deliveryState: string;
  readonly inCollection: boolean;
  readonly forSale: boolean;
  readonly forTrade: boolean;
}

export function holding(row: CopyRow, context: HoldingContext): AgentHolding {
  return compact({
    copyId: row.id,
    itemNo: row.itemNo,
    stampId: row.stampId,
    stamp: row.stampName ?? undefined,
    catalogNumbers: catalogLabels(context.catalogNumbers),
    issue: row.issueName ?? undefined,
    issueYear: row.issueYear ?? undefined,
    condition: row.conditionName,
    certificate: row.certificateStatusName ?? undefined,
    format: row.formatName ?? undefined,
    location: context.location ?? undefined,
    locationRef: row.locationRef ?? undefined,
    deliveryState: row.deliveryState,
    inCollection: row.inCollection,
    forSale: row.forSale,
    forTrade: row.forTrade,
  });
}

/** How many copies the whole matched set holds, in each condition. */
export interface AgentConditionCount {
  readonly condition: string;
  readonly copies: number;
}

/**
 * The condition breakdown, over the **whole match** rather than over the page.
 *
 * This is what lets one call answer *what do I hold from this issue and in what condition* when the
 * match is larger than a page. Without it an agent handed twenty-five of ninety rows can state the
 * total — so it knows it was trimmed — and still has nothing to say about the ninety, which is the
 * half of #706's convention a `total` alone does not reach.
 *
 * Ordered by count, largest first, then by name, so the leading entry is the answer and two reads of
 * one collection cannot come back in different orders.
 */
export function conditionCounts(
  counts: ReadonlyMap<string, number>,
  names: ReadonlyMap<string, string>
): AgentConditionCount[] {
  return [...counts.entries()]
    .map(([conditionId, copies]) => ({ condition: names.get(conditionId) ?? conditionId, copies }))
    .sort((a, b) => b.copies - a.copies || a.condition.localeCompare(b.condition));
}

// ── The valuation summary ────────────────────────────────────────────────────

/**
 * What the catalogue says the copies in scope are worth.
 *
 * **The counts are not decoration and never travel apart from the total** (`valuation.md`). A
 * collection is valued against a catalogue the collector has been filling in by hand, so a figure
 * is worth exactly as much as the share of the copies behind it: `unpriced` is a copy no catalogue
 * row matched, `unconvertible` one priced in a currency with no rate to base, and `uncertain` one
 * whose variant is unknown and whose figure is therefore the lowest of its priced variants (#238).
 * A total stated without them would read as the collection's worth.
 */
export interface AgentCatalogueTotal {
  readonly total: string;
  readonly pricedCount: number;
  readonly unpricedCount: number;
  readonly unconvertibleCount: number;
  readonly uncertainCount: number;
  /** The share of {@link total} contributed by the uncertain copies. */
  readonly uncertainTotal: string;
}

/**
 * What the market has actually paid for copies like these (ADR-0022).
 *
 * **`noEvidenceCount` is the point.** Market value exists only where auction results have been
 * recorded, which on a self-built base is a fraction of a collection, and a copy whose key has no
 * datapoints contributes **nothing** — no catalogue-derived stand-in — because a key with no results
 * has no market value at all. A total built from a tenth of the collection must never read as the
 * collection's worth, and these two counts are what stop it.
 */
export interface AgentMarketTotal {
  readonly total: string;
  readonly valuedCount: number;
  readonly noEvidenceCount: number;
}

/** What the collector actually paid. The three counts partition the copies in scope: a `pending`
 *  copy sits in an open purchase lot whose pool has not been split (#123) and a `none` was never
 *  costed — neither is averaged in at zero, and neither is guessed at. */
export interface AgentCostTotal {
  readonly total: string;
  readonly knownCount: number;
  readonly pendingCount: number;
  readonly noneCount: number;
}

/**
 * The valuation summary over a scope.
 *
 * **Four answers to four different questions, grouped rather than flattened, and that is
 * deliberate.** The catalogue is a published list price, the market is what copies like these have
 * fetched, the cost is what this collector paid, and the write-off is what the copies in scope that
 * are gone had cost. `valuation.md` is emphatic that these must not be blurred; eighteen sibling
 * scalars on one object would invite exactly that, where four named groups make the distinction
 * structural.
 *
 * **The write-off is why the scope here is wider than the holdings list's**, and it is worth stating
 * rather than leaving to be discovered: the underlying read lifts the disposal exclusion on purpose
 * (#396), so this covers the held copies *and* the ones in the same scope that are gone, partitioned
 * into the three totals above and {@link writeOff}. `list_holdings` shows the held ones only, so its
 * `total` and `catalogue.pricedCount` are not meant to agree, and a copy that has left is counted
 * here exactly once.
 */
export interface AgentValuationSummary {
  readonly baseCurrency: string;
  readonly catalogue: AgentCatalogueTotal;
  readonly market: AgentMarketTotal;
  readonly cost: AgentCostTotal;
  readonly writeOff: { readonly cost: AgentCostTotal; readonly copies: number };
}

/** The summary shape `getHoldingsValuation` returns, narrowed to what is published. */
export interface HoldingsSummaryRow {
  readonly baseCurrency: string;
  readonly totalBaseAmount: string;
  readonly pricedCount: number;
  readonly unpricedCount: number;
  readonly unconvertibleCount: number;
  readonly uncertainCount: number;
  readonly uncertainBaseAmount: string;
  readonly market: {
    readonly totalBaseAmount: string;
    readonly valuedCount: number;
    readonly noEvidenceCount: number;
  };
  readonly cost: {
    readonly totalCostBasis: string;
    readonly knownCount: number;
    readonly pendingCount: number;
    readonly noneCount: number;
  };
  readonly writeOff: {
    readonly cost: {
      readonly totalCostBasis: string;
      readonly knownCount: number;
      readonly pendingCount: number;
      readonly noneCount: number;
    };
    readonly count: number;
  };
}

function costTotal(row: HoldingsSummaryRow["cost"]): AgentCostTotal {
  return {
    total: row.totalCostBasis,
    knownCount: row.knownCount,
    pendingCount: row.pendingCount,
    noneCount: row.noneCount,
  };
}

export function valuationSummary(row: HoldingsSummaryRow): AgentValuationSummary {
  return {
    baseCurrency: row.baseCurrency,
    catalogue: {
      total: row.totalBaseAmount,
      pricedCount: row.pricedCount,
      unpricedCount: row.unpricedCount,
      unconvertibleCount: row.unconvertibleCount,
      uncertainCount: row.uncertainCount,
      uncertainTotal: row.uncertainBaseAmount,
    },
    market: {
      total: row.market.totalBaseAmount,
      valuedCount: row.market.valuedCount,
      noEvidenceCount: row.market.noEvidenceCount,
    },
    cost: costTotal(row.cost),
    writeOff: { cost: costTotal(row.writeOff.cost), copies: row.writeOff.count },
  };
}
