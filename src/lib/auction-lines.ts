import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { summarizeLotComposition, type LotCompositionValue, type LotLineValue } from "./auction-lot";
import { getOrFetchRate } from "./exchange-rates";
import { valuateItemRows, type ValuationRow } from "./items";
import type { PhotoSummary } from "./photos";
import { getCollectionBaseCurrency } from "./pricing";
import { readCollectionAreas } from "./areas";
import { buildAreaVendorMaps, formatStampCN } from "./area-vendor";
import { loadIssuePrefixMap } from "./issue-prefix";
import { isUnknownVariantStamp, subtypeLabel, VARIANT_FLAG_SELECT, type SubtypeLabel } from "./variant-classification";

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

/** One line as the composition editor renders it: what it points at, and what that is worth. */
export interface AuctionLotLineItem {
  id: string;
  auctionLotId: string;
  stampId: string;
  stampName: string | null;
  /** Raw numbers + vendor, so the client can prefix-format them with the area's vendor map exactly
   * as every other stamp surface does (#357). Ordered **primary vendor first**. */
  catalogNumbers: { catalogVendorId: string; number: string }[];
  /**
   * The leading number **prefix-formatted** (`Mi·PL 12`), or null when the stamp carries none.
   *
   * Resolved here rather than on the client because the derived lot name (#353) is a server read,
   * and a bare `1-12` does not say which catalogue it is 1–12 of — which is the whole question a
   * lot's numbers answer.
   */
  catalogLabel: string | null;
  /** Owning issue, for the issue sub-grouping the composition view shares with the PO and offer
   * screens; null when the stamp belongs to none. */
  issueId: string | null;
  issueName: string | null;
  issueYear: number | null;
  /** Issue date of the stamp itself, rendered on the row exactly as a copy's is. */
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  /** Colnect Marketplace item id (#247/#290), for the chip beside the catalog numbers. */
  colnectId: string | null;
  /** The stamp's primary area, which is what the client resolves the area name, primary vendor and
   * vendor map from for the quick-price dialog. */
  areaId: string | null;
  subtype: SubtypeLabel | null;
  photos: PhotoSummary[];
  /** The line points at a base stamp that has variants: "one of these, which one is not recorded".
   * Its value is a lowest-child estimate and is rendered as such (#238). */
  unknownVariant: boolean;
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  /** The certificate the lot is described as carrying; null is **none**, the unmarked default a
   * copy uses (ADR-0006 §2). Matching is exact — a lot with an Attest is unpriced until a price
   * exists at that level, exactly as a copy is. */
  certificateStatusId: string | null;
  certificateStatusName: string | null;
  certificateStatusAbbreviation: string | null;
  /** Null is the single — no such row exists (ADR-0020). */
  formatId: string | null;
  formatName: string | null;
  formatAbbreviation: string | null;
  quantity: number;
  /** The sale's currency, which every figure below is in. */
  currency: string;
  /** Catalogue value of **one** of them, or null when the line contributes nothing. */
  unitValue: string | null;
  /** `unitValue × quantity`. */
  lineValue: string | null;
  /** No catalogue price for this stamp at that condition × format. */
  unpriced: boolean;
  /** Priced, but in a currency with no rate to the sale's. */
  unconvertible: boolean;
  /** The figure is a lowest-variant estimate (#238) — *inferred, not recorded*. */
  uncertain: boolean;
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
  conditionId: string;
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
  condition: { select: { name: true, abbreviation: true } },
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
  const [valuations, rates, areas, issuePrefixes] = await Promise.all([
    // One batched valuation over every line of every lot — the point of the whole module.
    valuateItemRows(
      collectionId,
      rows.map<ValuationRow>((row) => ({
        id: row.id,
        stampId: row.stampId,
        conditionId: row.conditionId,
        certificateStatusId: row.certificateStatusId,
        formatId: row.formatId,
        unknownVariant: isUnknownVariantStamp(row.stamp),
      }))
    ),
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
  ]);
  const { primaryVendorByArea, vendorMapFor } = buildAreaVendorMaps(areas, issuePrefixes);

  const byLot = new Map<string, { currency: string; lines: AuctionLotLineItem[]; values: LotLineValue[] }>();
  for (const row of rows) {
    const currency = row.auctionLot.auctionSale.currency;
    const valuation = valuations.get(row.id);
    const rate = rates.get(currency) ?? null;
    // Three outcomes, kept apart on purpose: no price at all, a price that cannot be expressed in
    // the sale's currency, and a figure.
    const unpriced = !valuation || valuation.unpriced || valuation.baseAmount === null;
    const unconvertible = !unpriced && rate === null;
    const unitValue = unpriced || unconvertible ? null : valuation!.baseAmount! * rate!;
    const quantity = row.quantity;

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
      conditionId: row.conditionId,
      conditionName: row.condition.name,
      conditionAbbreviation: row.condition.abbreviation,
      certificateStatusId: row.certificateStatusId,
      certificateStatusName: row.certificateStatus?.name ?? null,
      certificateStatusAbbreviation: row.certificateStatus?.abbreviation ?? null,
      formatId: row.formatId,
      formatName: row.format?.name ?? null,
      formatAbbreviation: row.format?.abbreviation ?? null,
      quantity,
      currency,
      unitValue: unitValue === null ? null : unitValue.toFixed(2),
      lineValue: unitValue === null ? null : (unitValue * quantity).toFixed(2),
      unpriced,
      unconvertible,
      uncertain: valuation?.uncertain ?? false,
    });
    entry.values.push({
      quantity,
      unitValue,
      unpriced,
      unconvertible,
      uncertain: valuation?.uncertain ?? false,
    });
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
