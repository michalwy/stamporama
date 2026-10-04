import "server-only";
import type { CatalogPriceMark } from "./catalog-price-mark";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  lotLineRangeOf,
  lotLineValueOf,
  summarizeLotComposition,
  type LotCompositionValue,
  type LotLineValue,
} from "./auction-lot";
import { getOrFetchRate } from "./exchange-rates";
import { valuateItemRows, type ValuationRow } from "./items";
import type { PhotoSummary } from "./photos";
import { getCollectionBaseCurrency } from "./pricing";
import { readCollectionAreas } from "./areas";
import { buildAreaVendorMaps, formatStampCN } from "./area-vendor";
import { loadStampWantSummaries, type StampWantSummary } from "./wants";
import { loadIssuePrefixMap } from "./issue-prefix";
import { isUnknownVariantStamp, subtypeLabel, VARIANT_FLAG_SELECT, type SubtypeLabel } from "./variant-classification";
import {
  lineConditionCandidates,
  lineConditionLabel,
  normalizeLineCondition,
  type LineConditionValue,
  type NamedCondition,
} from "./auction-line-condition";

// **What an auction lot contains, and what that is worth** (#353; ADR-0021 §7).
//
// A composition line is a `stamp × condition × format × quantity`. Structured rather than free text
// because free text makes the catalogue value uncomputable and turns a lost lot — the only price
// datapoint auction tracking actually produces (#24) — into a number attributed to nothing.
//
// Three rules are **reused, never re-decided** here:
//
//   - Pointing a line at an **unknown-variant umbrella** is how "variant unspecified" is expressed,
//     and its value rolls up from the cheapest variant child exactly as the issue list does (#238).
//   - A `formatId` prices the multiple through ADR-0020: an explicit `StampCatalogPrice` for the
//     format wins, else the single's price × the resolved `StampFormatFactor`. A multiple with
//     neither is **unpriced** — never valued at the single's figure.
//   - Quantity multiplies and nothing else does. A multiple is never decomposed (ADR-0020), so two
//     blocks of four are two blocks' worth of the block's price.
//
// All three come free from `valuateItemRows` (`items.ts`), which values a copy by the same rules: a
// line is that shape at a null certificate. It is **batched over every line of every lot** the
// caller is drawing, so the format-factor table and the area tree are loaded once rather than per
// row — the same reason `makeFormatFactorLookup` exists at all.
//
// **Currency.** Catalogue prices are valued into the collection's base currency, like everywhere
// else, and then converted **once per sale currency** into the sale's — because the lot's bid,
// premium and ceiling are all denominated there, and a headroom figure that mixed two currencies
// would be arithmetic on nothing. A base → sale rate that cannot be fetched leaves the line
// *unconvertible*: it has a price and cannot be counted, which is a different fact from having none
// and must not send the collector off to enter a value that already exists.
//
// Ownership is **not** checked here — every entry point is called from `auctions.ts`, which has
// already resolved the lot or the collection for the owner.

/**
 * The fields the anchoring rule reads off a line — **and the whole of why #1168 needed no second
 * one.**
 *
 * It is a `stamp × condition × certificate × format × quantity` with its catalogue value already
 * resolved and stated in the currency being answered in. A composition line is one; so is a line
 * that exists nowhere but in a caller's question — an agent deciding whether an auction is worth
 * looking at holds the auctioneer's description and an opening price, and no `AuctionLot`,
 * `AuctionSale` or `AuctionLotLine` exists for any of it.
 *
 * {@link AuctionLotLineItem} **extends** it rather than merely resembling it, so the fit is a
 * compile error away rather than a coincidence somebody may quietly break.
 */
export interface AnchorableLine {
  stampId: string;
  stampName: string | null;
  /** The leading catalog number, prefix-formatted (`Mi·PL 12`). */
  catalogLabel: string | null;
  /** The condition the line is settled at; **null while it is not** (#1623) — unknown, or one of
   * {@link possibleConditionIds}. */
  conditionId: string | null;
  /** The condition as it is named — `MNH`, or `MNH or MH` / `Condition unknown` while unsettled. */
  conditionName: string;
  conditionAbbreviation: string;
  /** The conditions an unsettled line may be in; empty when settled, and empty when unknown. */
  possibleConditionIds: string[];
  /** Every condition the line may be in, each valued — one entry for a settled line, the
   * collection's every condition for an unknown one (#1623). The anchoring rule is applied to each
   * of them, never to the line's range as a whole. */
  conditions: AnchorableCondition[];
  /** The certificate the line is described as carrying; null is **none**, the unmarked default a
   * copy uses (ADR-0006 §2). Matching is exact — a line with an Attest is unpriced until a price
   * exists at that level, exactly as a copy is. */
  certificateStatusId: string | null;
  /** Null is the single — no such row exists (ADR-0020). */
  formatId: string | null;
  formatName: string | null;
  formatAbbreviation: string | null;
  /** Quantity multiplies and nothing else does: a multiple is never decomposed (ADR-0020). */
  quantity: number;
  /** The currency {@link unitValue} is stated in — a sale's on the lots screen, the one the
   * caller asked to be answered in otherwise. */
  currency: string;
  /** The stamp's primary area, which the realization-ratio ladder is keyed on. */
  areaId: string | null;
  /** The stamp's own year of issue, which that ladder's period bucket is centred on. */
  issuedYear: number | null;
  /** Catalogue value of **one** of them, in {@link currency}, 2-dp — the **low** end of the range
   * while the condition is not settled (#1623). Null when the line contributes nothing, for either
   * of the two reasons below. */
  unitValue: string | null;
  /** The top of that range; equal to {@link unitValue} on a settled line. */
  unitValueHigh: string | null;
  /** The line's condition is unknown or one of several (#1623). */
  conditionUnsettled: boolean;
  /** Possible conditions the catalogue gives no figure for, left out of the range. */
  unpricedConditions: number;
  /** No catalogue price for this stamp at that condition × certificate × format. */
  unpriced: boolean;
  /** Unpriced because the catalogue gives no price on purpose (#1615): said, never asked for. */
  mark: CatalogPriceMark | null;
  /** Priced, but in a currency with no rate to {@link currency}. */
  unconvertible: boolean;
}

/** One condition a line may be in, valued at it (#1623) — what the anchoring rule reads per
 * condition. A settled line has exactly one. */
export interface AnchorableCondition {
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  /** Catalogue value of one at this condition, in the line's currency, 2-dp. */
  unitValue: string | null;
  unpriced: boolean;
  mark: CatalogPriceMark | null;
  unconvertible: boolean;
}

/**
 * One line as the composition editor renders it: what it points at, and what that is worth.
 *
 * **Everything the anchoring rule reads is inherited** (#1168) rather than restated here, so a
 * field going out of step with {@link AnchorableLine} is a compile error rather than a drift. What
 * is added is the line's own identity and the enrichment only a screen wants — its photos, the
 * issue it groups under, the want marker, the catalogue numbers as raw pairs.
 */
export interface AuctionLotLineItem extends AnchorableLine {
  id: string;
  auctionLotId: string;
  /** Raw numbers + vendor, so the client can prefix-format them with the area's vendor map exactly
   * as every other stamp surface does (#357). Ordered **primary vendor first**. */
  catalogNumbers: { catalogVendorId: string; number: string }[];
  /** Owning issue, for the issue sub-grouping the composition view shares with the PO and offer
   * screens; null when the stamp belongs to none. */
  issueId: string | null;
  issueName: string | null;
  issueYear: number | null;
  /** Issue date of the stamp itself, rendered on the row exactly as a copy's is. `issuedYear` is
   * inherited — the ratio ladder's period bucket is centred on it. */
  issuedDay: number | null;
  issuedMonth: number | null;
  /** Colnect Marketplace item id (#247/#290), for the chip beside the catalog numbers. */
  colnectId: string | null;
  subtype: SubtypeLabel | null;
  photos: PhotoSummary[];
  /** The line points at a base stamp that has variants: "one of these, which one is not recorded".
   * Its value is a lowest-child estimate and is rendered as such (#238). */
  unknownVariant: boolean;
  certificateStatusName: string | null;
  certificateStatusAbbreviation: string | null;
  /** `unitValue × quantity`. */
  lineValue: string | null;
  /** `unitValueHigh × quantity` — the top of the line's range (#1623). */
  lineValueHigh: string | null;
  /** The figure is a lowest-variant estimate (#238) — *inferred, not recorded*. */
  uncertain: boolean;
  /** The open wants recorded for this stamp (#532), or null for none. On a lot being bid on this
   *  is the point of the whole record: what is in front of you, and whether you are after it. */
  wants: StampWantSummary | null;
}

/** A lot's composition: its lines and what they add up to, in the sale's currency. */
export interface AuctionLotComposition extends LotCompositionValue {
  lotId: string;
  currency: string;
  lines: AuctionLotLineItem[];
}

/** The line fields a form submits. */
export interface AuctionLotLineInput {
  stampId: string;
  /** The condition the line is settled at, or null while it is not (#1623). */
  conditionId: string | null;
  /** The conditions an unsettled line may be in; empty for unknown. Ignored when
   * {@link conditionId} is set, and a set of one is that condition (`normalizeLineCondition`). */
  possibleConditionIds?: string[];
  /** Null is no certificate (ADR-0006 §2). */
  certificateStatusId: string | null;
  /** Null is the single (ADR-0020). */
  formatId: string | null;
  quantity: number;
}

const LINE_SELECT = {
  id: true,
  auctionLotId: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
  quantity: true,
  possibleConditions: { select: { conditionId: true } },
  certificateStatus: { select: { name: true, abbreviation: true } },
  format: { select: { name: true, abbreviation: true } },
  stamp: {
    select: {
      name: true,
      colnectId: true,
      issuedDay: true,
      issuedMonth: true,
      issuedYear: true,
      catalogNumbers: { select: { catalogVendorId: true, number: true } },
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      issueMemberships: {
        select: { issueId: true, issue: { select: { name: true, year: true } } },
        take: 1,
      },
      photos: { select: { id: true, role: true, title: true, sortOrder: true } },
      variants: { select: VARIANT_FLAG_SELECT },
      ...VARIANT_FLAG_SELECT,
    },
  },
  auctionLot: { select: { auctionSale: { select: { currency: true } } } },
} satisfies Prisma.AuctionLotLineSelect;

/** Photo roles a stamp uses (#137): the single `main` slot, plus the two a copy scan carries. */
function toPhotoSummary(p: { id: string; role: string | null; title: string | null; sortOrder: number }): PhotoSummary {
  return {
    id: p.id,
    role: (p.role === "main" || p.role === "front" || p.role === "back" ? p.role : null) as PhotoSummary["role"],
    title: p.title,
    sortOrder: p.sortOrder,
  };
}

/**
 * Rates from the collection's base currency into each sale currency in play.
 *
 * Per-currency try/catch, mirroring `safeRateMap`: one unreachable pair must leave the other sales
 * priced rather than emptying the whole screen. A missing rate maps to null, which surfaces as
 * *unconvertible* lines rather than as silence.
 */
export async function baseToSaleRates(
  collectionId: string,
  baseCurrency: string,
  saleCurrencies: string[]
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const currency of new Set(saleCurrencies)) {
    if (currency === baseCurrency) {
      out.set(currency, 1);
      continue;
    }
    try {
      out.set(currency, (await getOrFetchRate(collectionId, baseCurrency, currency)).rate);
    } catch {
      out.set(currency, null);
    }
  }
  return out;
}

/** The collection's conditions in their own order — what an unknown condition ranges over and what
 * every label is drawn from. Read once per pass. */
async function readCollectionConditions(collectionId: string): Promise<NamedCondition[]> {
  return prisma.stampCondition.findMany({
    where: { collectionId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, abbreviation: true },
  });
}

/** One line to value at each of its possible conditions. */
interface CandidateLine extends LineConditionValue {
  key: string;
  stampId: string;
  certificateStatusId: string | null;
  formatId: string | null;
  unknownVariant: boolean;
  quantity: number;
}

/** What {@link valueAcrossConditions} hands back for one line. */
interface CandidateLineValue {
  value: LotLineValue;
  conditions: AnchorableCondition[];
  label: { short: string; long: string };
}

/**
 * Value every line at **each of its possible conditions** in one `valuateItemRows` pass (#1623).
 *
 * A settled line is one row, exactly as before; an unsettled one is one row per possible condition,
 * and `lotLineRangeOf` turns those into the line's range. Nothing about valuing a condition is
 * decided here — each row is the same `stamp × condition × certificate × format` a copy is valued as.
 */
async function valueAcrossConditions(
  collectionId: string,
  lines: CandidateLine[],
  rateOf: (line: CandidateLine) => number | null,
  conditions: NamedCondition[]
): Promise<Map<string, CandidateLineValue>> {
  const conditionIds = conditions.map((condition) => condition.id);
  const conditionById = new Map(conditions.map((condition) => [condition.id, condition]));
  const candidates = new Map(lines.map((line) => [line.key, lineConditionCandidates(line, conditionIds)]));
  const valuations = await valuateItemRows(
    collectionId,
    lines.flatMap((line) =>
      candidates.get(line.key)!.map<ValuationRow>((conditionId) => ({
        id: `${line.key}\u0000${conditionId}`,
        stampId: line.stampId,
        conditionId,
        certificateStatusId: line.certificateStatusId,
        formatId: line.formatId,
        unknownVariant: line.unknownVariant,
        carrier: null,
        faultReductionPercent: null,
      }))
    )
  );

  const out = new Map<string, CandidateLineValue>();
  for (const line of lines) {
    const rate = rateOf(line);
    const ids = candidates.get(line.key)!;
    const each = ids.map((conditionId) => valuations.get(`${line.key}\u0000${conditionId}`));
    out.set(line.key, {
      value: lotLineRangeOf(line.quantity, each, rate, line.conditionId === null),
      conditions: ids.map((conditionId, index) => {
        const value = lotLineValueOf(line.quantity, each[index], rate);
        const condition = conditionById.get(conditionId);
        return {
          conditionId,
          conditionName: condition?.name ?? conditionId,
          conditionAbbreviation: condition?.abbreviation ?? "",
          unitValue: value.unitValue === null ? null : value.unitValue.toFixed(2),
          unpriced: value.unpriced,
          mark: value.mark,
          unconvertible: value.unconvertible,
        };
      }),
      label: lineConditionLabel(line, conditions),
    });
  }
  return out;
}

/**
 * Value the composition of every given lot in one pass.
 *
 * Lots with no lines are absent from the result — the caller treats that as an empty composition,
 * which is the normal state of a lot while it is still being bid on.
 */
export async function valuateAuctionLotLines(
  collectionId: string,
  lotIds: string[]
): Promise<Map<string, AuctionLotComposition>> {
  if (lotIds.length === 0) return new Map();

  const rows = await prisma.auctionLotLine.findMany({
    where: { auctionLotId: { in: lotIds }, auctionLot: { auctionSale: { collectionId } } },
    // Stable reading order: a composition is a list the collector built, and the order they built
    // it in is the only one that means anything here.
    orderBy: { id: "asc" },
    select: LINE_SELECT,
  });
  if (rows.length === 0) return new Map();

  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  const [conditions, rates, areas, issuePrefixes, wantsByStamp] = await Promise.all([
    readCollectionConditions(collectionId),
    baseToSaleRates(
      collectionId,
      baseCurrency,
      rows.map((r) => r.auctionLot.auctionSale.currency)
    ),
    // The area tree, once for the page: which vendor leads a line's numbers and how that vendor's
    // numbers are prefixed in that area. The resolution is the *pure* one the client uses
    // (`buildAreaVendorMaps`), so a number reads identically wherever it is printed.
    readCollectionAreas(collectionId),
    // …and the per-issue prefix overrides (#377), likewise once for the page.
    loadIssuePrefixMap(collectionId),
    // The want marker (#532), for every stamp on the page's lines — one read, the same call the
    // catalogue lists make.
    loadStampWantSummaries(collectionId, rows.map((r) => r.stampId)),
  ]);
  const { primaryVendorByArea, vendorMapFor } = buildAreaVendorMaps(areas, issuePrefixes);
  const currencyByLine = new Map(rows.map((row) => [row.id, row.auctionLot.auctionSale.currency]));
  // One batched valuation over every line of every lot, at each condition it may be in — the point
  // of the whole module.
  const valued = await valueAcrossConditions(
    collectionId,
    rows.map<CandidateLine>((row) => ({
      key: row.id,
      stampId: row.stampId,
      conditionId: row.conditionId,
      possibleConditionIds: row.possibleConditions.map((p) => p.conditionId),
      certificateStatusId: row.certificateStatusId,
      formatId: row.formatId,
      unknownVariant: isUnknownVariantStamp(row.stamp),
      quantity: row.quantity,
    })),
    (line) => rates.get(currencyByLine.get(line.key)!) ?? null,
    conditions
  );

  const byLot = new Map<string, { currency: string; lines: AuctionLotLineItem[]; values: LotLineValue[] }>();
  for (const row of rows) {
    const currency = row.auctionLot.auctionSale.currency;
    // Three outcomes, kept apart on purpose: no price at all, a price that cannot be expressed in
    // the sale's currency, and a figure. The rule is `lotLineValueOf` in the pure module and is
    // **not** restated here — a lot-free caller resolves a line the same way (#1168), and two
    // copies of this is how one surface comes to call a line unpriced while the other calls it
    // unconvertible. An unsettled condition is that rule at each possible condition (#1623).
    const quantity = row.quantity;
    const { value, conditions: lineConditions, label } = valued.get(row.id)!;
    const { unpriced, unconvertible, unitValue } = value;
    const unitValueHigh = value.unitValueHigh ?? unitValue;

    const link = row.stamp.stampAreaLinks.find((l) => l.isPrimary) ?? row.stamp.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    const primaryVendorId = areaId ? (primaryVendorByArea.get(areaId) ?? null) : null;
    const catalogNumbers = primaryVendorId
      ? [
          ...row.stamp.catalogNumbers.filter((cn) => cn.catalogVendorId === primaryVendorId),
          ...row.stamp.catalogNumbers.filter((cn) => cn.catalogVendorId !== primaryVendorId),
        ]
      : row.stamp.catalogNumbers;
    // The leading number under its own vendor's prefix for this area — the primary vendor's when
    // the stamp has one, else whichever came first, since naming *some* catalogue beats naming none.
    const leading = catalogNumbers[0] ?? null;
    const membership = row.stamp.issueMemberships[0] ?? null;
    const vendorMap = vendorMapFor(areaId, membership?.issueId ?? null);
    const catalogLabel = leading
      ? formatStampCN(leading.number, vendorMap.get(leading.catalogVendorId))
      : null;

    const entry = byLot.get(row.auctionLotId) ?? { currency, lines: [], values: [] };
    entry.lines.push({
      id: row.id,
      auctionLotId: row.auctionLotId,
      stampId: row.stampId,
      stampName: row.stamp.name,
      catalogNumbers,
      catalogLabel,
      issueId: membership?.issueId ?? null,
      issueName: membership?.issue.name ?? null,
      issueYear: membership?.issue.year ?? null,
      issuedDay: row.stamp.issuedDay,
      issuedMonth: row.stamp.issuedMonth,
      issuedYear: row.stamp.issuedYear,
      colnectId: row.stamp.colnectId,
      areaId,
      subtype: subtypeLabel(row.stamp),
      photos: row.stamp.photos.map(toPhotoSummary).sort((a, b) => a.sortOrder - b.sortOrder),
      unknownVariant: isUnknownVariantStamp(row.stamp),
      wants: wantsByStamp.get(row.stampId) ?? null,
      conditionId: row.conditionId,
      conditionName: label.long,
      conditionAbbreviation: label.short,
      possibleConditionIds: row.conditionId === null ? row.possibleConditions.map((p) => p.conditionId) : [],
      conditions: lineConditions,
      certificateStatusId: row.certificateStatusId,
      certificateStatusName: row.certificateStatus?.name ?? null,
      certificateStatusAbbreviation: row.certificateStatus?.abbreviation ?? null,
      formatId: row.formatId,
      formatName: row.format?.name ?? null,
      formatAbbreviation: row.format?.abbreviation ?? null,
      quantity,
      currency,
      unitValue: unitValue === null ? null : unitValue.toFixed(2),
      unitValueHigh: unitValueHigh === null ? null : unitValueHigh.toFixed(2),
      lineValue: unitValue === null ? null : (unitValue * quantity).toFixed(2),
      lineValueHigh: unitValueHigh === null ? null : (unitValueHigh * quantity).toFixed(2),
      unpriced,
      mark: value.mark,
      unconvertible,
      uncertain: value.uncertain,
      conditionUnsettled: value.conditionUnsettled ?? false,
      unpricedConditions: value.unpricedConditions ?? 0,
    });
    entry.values.push(value);
    byLot.set(row.auctionLotId, entry);
  }

  return new Map(
    [...byLot.entries()].map(([lotId, entry]) => [
      lotId,
      {
        lotId,
        currency: entry.currency,
        lines: entry.lines,
        ...summarizeLotComposition(entry.values),
      },
    ])
  );
}

/** A line as a caller describes one that does not exist here: the same fields an
 * `AuctionLotLine` row carries, and nothing about a lot. */
export interface LineSpec {
  stampId: string;
  /** Null while the condition is not settled (#1623) — one of {@link possibleConditionIds}, or any
   * of the collection's conditions when that is empty. */
  conditionId: string | null;
  possibleConditionIds?: string[];
  /** Null is no certificate (ADR-0006 §2). */
  certificateStatusId: string | null;
  /** Null is the single (ADR-0020). */
  formatId: string | null;
  quantity: number;
}

/**
 * Value lines that exist nowhere — the lot-free half of {@link valuateAuctionLotLines} (#1168).
 *
 * An agent deciding whether an auction is worth looking at has the auctioneer's description and an
 * opening price, and nothing in this collection to point at. **Every rule it needs is already
 * owned by somebody and is called rather than restated**: `valuateItemRows` for the catalogue
 * figure — which is where the unknown-variant rollup (#238), format pricing (ADR-0020) and the
 * strict certificate match all come from — `baseToSaleRates` for the conversion, `lotLineValueOf`
 * for the three outcomes, and `buildAreaVendorMaps` + `formatStampCN` for the number as it is
 * printed everywhere else. There is no valuation decision in this function.
 *
 * **A stamp not in this collection is simply absent from the result**, so the caller can say which
 * ids it asked about and did not get back. Answering short for one is what a caller must not do
 * silently; refusing is its job rather than this module's, because only the caller knows what
 * sentence its reader can act on.
 *
 * Ownership is **not** checked here — the caller has resolved the collection, as everywhere in
 * these modules.
 */
export async function valuateLineSpecs(
  collectionId: string,
  currency: string,
  specs: LineSpec[]
): Promise<AnchorableLine[]> {
  if (specs.length === 0) return [];

  const stampIds = [...new Set(specs.map((spec) => spec.stampId))];
  const [stamps, conditions, formats] = await Promise.all([
    prisma.stamp.findMany({
      where: { id: { in: stampIds }, collectionId },
      select: {
        id: true,
        name: true,
        issuedYear: true,
        catalogNumbers: { select: { catalogVendorId: true, number: true } },
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
        issueMemberships: { select: { issueId: true }, take: 1 },
        variants: { select: VARIANT_FLAG_SELECT },
        ...VARIANT_FLAG_SELECT,
      },
    }),
    readCollectionConditions(collectionId),
    prisma.stampFormat.findMany({
      where: { collectionId },
      select: { id: true, name: true, abbreviation: true },
    }),
  ]);

  const stampById = new Map(stamps.map((stamp) => [stamp.id, stamp]));
  const formatById = new Map(formats.map((row) => [row.id, row]));

  // Only the specs whose stamp is really in this collection. A spec keyed to somebody else's stamp
  // is dropped here and reported by the caller — valuing it would answer about nothing.
  const known = specs.filter((spec) => stampById.has(spec.stampId));
  if (known.length === 0) return [];

  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  const [rates, areas, issuePrefixes] = await Promise.all([
    baseToSaleRates(collectionId, baseCurrency, [currency]),
    readCollectionAreas(collectionId),
    loadIssuePrefixMap(collectionId),
  ]);
  const { primaryVendorByArea, vendorMapFor } = buildAreaVendorMaps(areas, issuePrefixes);
  const rate = rates.get(currency) ?? null;
  // The same batched call the lot path makes, so the format-factor table and the area tree load
  // once for the whole question rather than per line — at each condition a line may be in.
  const valued = await valueAcrossConditions(
    collectionId,
    known.map<CandidateLine>((spec, index) => ({
      key: String(index),
      stampId: spec.stampId,
      ...normalizeLineCondition(spec),
      certificateStatusId: spec.certificateStatusId,
      formatId: spec.formatId,
      unknownVariant: isUnknownVariantStamp(stampById.get(spec.stampId)!),
      quantity: spec.quantity,
    })),
    () => rate,
    conditions
  );

  return known.map((spec, index) => {
    const stamp = stampById.get(spec.stampId)!;
    const condition = normalizeLineCondition(spec);
    const format = spec.formatId === null ? null : (formatById.get(spec.formatId) ?? null);

    const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    const primaryVendorId = areaId ? (primaryVendorByArea.get(areaId) ?? null) : null;
    const ordered = primaryVendorId
      ? [
          ...stamp.catalogNumbers.filter((cn) => cn.catalogVendorId === primaryVendorId),
          ...stamp.catalogNumbers.filter((cn) => cn.catalogVendorId !== primaryVendorId),
        ]
      : stamp.catalogNumbers;
    const leading = ordered[0] ?? null;
    const vendorMap = vendorMapFor(areaId, stamp.issueMemberships[0]?.issueId ?? null);

    const { value, conditions: lineConditions, label } = valued.get(String(index))!;
    const unitValueHigh = value.unitValueHigh ?? value.unitValue;
    return {
      stampId: spec.stampId,
      stampName: stamp.name,
      catalogLabel: leading
        ? formatStampCN(leading.number, vendorMap.get(leading.catalogVendorId))
        : null,
      conditionId: condition.conditionId,
      conditionName: label.long,
      conditionAbbreviation: label.short,
      possibleConditionIds: condition.possibleConditionIds,
      conditions: lineConditions,
      certificateStatusId: spec.certificateStatusId,
      formatId: spec.formatId,
      formatName: format?.name ?? null,
      formatAbbreviation: format?.abbreviation ?? null,
      quantity: spec.quantity,
      currency,
      areaId,
      issuedYear: stamp.issuedYear,
      unitValue: value.unitValue === null ? null : value.unitValue.toFixed(2),
      unitValueHigh: unitValueHigh === null ? null : unitValueHigh.toFixed(2),
      unpriced: value.unpriced,
      mark: value.mark,
      unconvertible: value.unconvertible,
      conditionUnsettled: value.conditionUnsettled ?? false,
      unpricedConditions: value.unpricedConditions ?? 0,
    };
  });
}

/** An empty composition, for a lot nothing has been entered against. Keeps every caller off a
 * null check and keeps `catalogValue: null` meaning "no value", not "not loaded". */
export function emptyComposition(lotId: string, currency: string): AuctionLotComposition {
  return {
    lotId,
    currency,
    lines: [],
    ...summarizeLotComposition([]),
  };
}

/**
 * The issues the lines of a sale's lots belong to — what the detail page loads `IssueHeader`s for,
 * so the composition view's issue groups carry the same header (catalog chips, stamp count) the
 * purchase-order and offer views show. Mirrors `getOfferIssueIds`.
 */
export async function getAuctionSaleIssueIds(saleId: string): Promise<string[]> {
  const rows = await prisma.issueMember.findMany({
    where: { stamp: { auctionLotLines: { some: { auctionLot: { auctionSaleId: saleId } } } } },
    select: { issueId: true },
    distinct: ["issueId"],
  });
  return rows.map((r) => r.issueId);
}
