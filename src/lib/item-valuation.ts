import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  buildDescendantMap,
  buildEffectivePrimaryCatalogMap,
  getCollectionBaseCurrency,
  safeRateMap,
} from "./pricing";
import type { RawCatalogPrice } from "./catalog-price";
import { makeFormatFactorLookup, makeStillValidLookup } from "./format-pricing";
import { PIECE_COPY_SELECT, pieceCopyOf, type PieceCopyInput } from "./carrier-value";
import {
  DEFAULT_FRANKING,
  DEFAULT_VALUATION_METHOD,
  PIECE_PRICES,
  inheritedMethod,
  isPiece,
  isPieceKind,
  isValuationMethod,
  mostExpensiveStamp,
  resolveMethod,
  valuePiece,
  type MethodArea,
  type PieceComponent,
  type PieceKind,
  type PiecePrice,
  type ValuationMethod,
} from "./piece-valuation";
import {
  methodRolesOf,
  roleOfPrice,
  type PieceColumn,
  type UnmappedRole,
  type ValuationMethodRoles,
} from "./valuation-method-roles";
import {
  applyFaultReduction,
  applyValueModifier,
  valuateCandidateCopy,
  valuateCopy,
  valuatePiece,
  type CopyValuation,
  type ValueModifier,
} from "./valuation";
import { childIsVariant, isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";
import { parsePriceCellInput } from "./catalog-price-mark";
import { roundAmount } from "./decimal-input";
import type { TypedPiecePrice } from "./piece-price-entry";
import type { StillValidRule } from "./still-valid-postage";

// Split out of `items.ts` so that **market** valuation can reuse it without the two modules
// importing each other: `market-values.ts` values a lot's lines with the very same rule a copy is
// valued by (#456), and `items.ts` in turn needs the market medians for its holdings total (#458).
// One shared module below both is what keeps that from being a cycle.
// ── Copy valuation (ADR-0007 §7) ────────────────────────────────────────────
// Assembles the inputs the pure `valuateCopy` needs (area primary catalog, own +
// descendant-variant prices, currency rates) and delegates the rule to `valuation.ts`.

/**
 * Minimal projection needed to value one thing from the catalog.
 *
 * Nothing here is copy-specific: it is a **stamp × condition × certificate × format**, of which a
 * physical copy is one instance and an auction lot's composition line (#353) is another. `id` is
 * only the key the result map is returned under, so a caller may key by whatever it holds.
 */
export interface ValuationRow {
  id: string;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  /** The copy's physical format (#343); null is the single. */
  formatId: string | null;
  /** True when the copy links to a base stamp that has variants (variant unknown). */
  unknownVariant: boolean;
  /**
   * Non-null exactly when the row is a **copy**: what decides whether it is a **piece** (#2359;
   * ADR-0076) — several stamps on it, or a format of kind *On cover* or *On piece* — and how one is
   * valued, its franking and its own method. A piece is valued by its method from its stamps' prices,
   * never from the leading stamp's cell of the grid.
   *
   * Required rather than optional, and that is the point: every caller has to say whether its row is
   * a copy — an omitted field would quietly value a cover at its leading stamp. A row that is not a
   * copy (an auction lot line, a want key, a trade receive line, a piece's own component) passes
   * `null`. Build it from a copy with {@link copyValuationOf}.
   */
  copy: PieceCopyInput | null;
  /**
   * The percentage this **copy's** faults take off its value (#1560), or null for none — and null for
   * every row that is not a copy. Required for `copy`'s reason: a copy reader that forgot it would
   * quietly value a faulty piece at the full figure. Build both from a copy with
   * {@link copyValuationOf}.
   */
  faultReductionPercent: number | null;
  /**
   * The modifier on this **copy's** catalogue value (#2357) — a percentage, an amount and a note — or
   * null for none and for every row that is not a copy. Applied before `faultReductionPercent`.
   * Required for `copy`'s reason; built from a copy by {@link copyValuationOf}.
   */
  valueModifier: ValueModifier | null;
  /**
   * The copy's **candidate set** (#1651, ADR-0065) — two or more stamps it might be — or null for an
   * ordinary copy and for every row that is not a copy. With a set, the copy is valued over its
   * candidates (`valuateCandidateCopy`) and `stampId` — the set's pointer — is not priced at all.
   * Required for `copy`'s reason; built from a copy by {@link copyValuationOf}.
   */
  candidateStampIds: readonly string[] | null;
}

// Pure, and so living in `carrier-value.ts` where the unit suite can reach them; re-exported so every
// copy reader takes the select and the builder from the module it takes `valuateItemRows` from.
export { PIECE_COPY_SELECT, pieceCopyOf, type PieceCopyInput } from "./carrier-value";

/** The columns {@link copyValuationOf} reads — spread into a copy's `select`: whether it is a piece
 *  and how one is valued (#2359), what the copy's modifier adjusts (#2357) and what its faults take
 *  off (#1560). */
export const COPY_VALUATION_SELECT = {
  ...PIECE_COPY_SELECT,
  faultReductionPercent: true,
  valueModifierPercent: true,
  valueModifierAmount: true,
  valueModifierNote: true,
  candidates: { select: { stampId: true } },
} as const;

/** The two copy-only fields of a {@link ValuationRow}, read off a copy selected with
 *  {@link COPY_VALUATION_SELECT}. Spread into the row, so a copy reader states both in one place. */
export function copyValuationOf(
  row: Parameters<typeof pieceCopyOf>[0] & {
    faultReductionPercent: number | null;
    valueModifierPercent: number | null;
    /** A Prisma `Decimal` as read, or anything else that prints as a number. */
    valueModifierAmount: { toString(): string } | null;
    valueModifierNote: string | null;
    candidates: readonly { stampId: string }[];
  }
): Pick<
  ValuationRow,
  "copy" | "faultReductionPercent" | "valueModifier" | "candidateStampIds"
> {
  return {
    copy: pieceCopyOf(row),
    faultReductionPercent: row.faultReductionPercent,
    valueModifier: valueModifierOf(row),
    candidateStampIds: row.candidates.length > 1 ? row.candidates.map((c) => c.stampId) : null,
  };
}

/** A copy's {@link ValueModifier} read off its three columns (#2357), or null when it has none. */
export function valueModifierOf(row: {
  valueModifierPercent: number | null;
  valueModifierAmount: { toString(): string } | null;
  valueModifierNote: string | null;
}): ValueModifier | null {
  if (row.valueModifierPercent === null && row.valueModifierAmount === null) return null;
  return {
    percent: row.valueModifierPercent,
    amount:
      row.valueModifierAmount === null
        ? null
        : Number(row.valueModifierAmount.toString()).toFixed(2),
    note: row.valueModifierNote,
  };
}

const VALUATION_PRICE_SELECT = {
  price: true,
  mark: true,
  currency: true,
  conditionId: true,
  certificateStatusId: true,
  // Required by `RawCatalogPrice` (ADR-0020): a copy is valued against prices of *its own*
  // format, and omitting the column here would let a block's price stand in for a single's.
  formatId: true,
  catalogEdition: { select: { year: true, catalogNameId: true } },
} as const;

/** Which book each area is read in, when it is not the area's own primary catalog.
 *
 * The one thing a caller may swap out, and only because a trade's **agreed** catalog is a real
 * second answer rather than an override of the first (#638; ADR-0039 §7): the collector's own
 * valuation is always the area's primary catalog with no override of any kind, or the trade screen
 * would quote a different figure for a stamp than the copies list does. Everything else about the
 * rule — the rollup, the format factors, the edition selection, the strict certificate match — is
 * the same rule, which is exactly why this is a map handed in rather than a second valuator.
 *
 * `areaId → catalogNameId | null`; see `buildVendorCatalogMap`. */
export interface ValuationCatalogOverride {
  catalogNameByArea: Map<string, string | null>;
}

/**
 * A piece's stamp prices **typed but not saved** (#2368), valued as though they were on file — so the
 * value and its arithmetic follow the collector's typing before anything is written. Each lands where
 * the save would put it: the stamp's main catalogue at its latest edition, in the condition its
 * column is read from (#2375), single, no certificate. A figure that does not parse is not read.
 */
export type TypedCatalogPrices = readonly TypedPiecePrice[];

/** Value a set of {@link ValuationRow}s. Loads the stamp prices, area primary catalogs, descendant
 * variant prices, format factors and currency rates **once** for the whole set, then applies the
 * pure `valuateCopy` rule — which is why every caller batches rather than valuing row by row.
 * Caller must have already asserted collection ownership. Returns id → valuation.
 *
 * Exported for the auction lot composition (#353), whose lines are the same shape at a null
 * certificate: re-deriving the unknown-variant rollup and the format factors there would be two
 * copies of ADR-0020 and #238 to keep in step. */
export async function valuateItemRows(
  collectionId: string,
  inputRows: ValuationRow[],
  override?: ValuationCatalogOverride,
  typed?: TypedCatalogPrices
): Promise<Map<string, CopyValuation>> {
  if (inputRows.length === 0) return new Map();
  let rows = inputRows;

  const [primaryCatalogByArea, baseCurrency] = await Promise.all([
    override
      ? Promise.resolve(override.catalogNameByArea)
      : buildEffectivePrimaryCatalogMap(collectionId),
    getCollectionBaseCurrency(collectionId),
  ]);

  // The format dictionary's kinds (#2359): which formats make a copy a piece.
  const formats = await prisma.stampFormat.findMany({
    where: { collectionId, pieceKind: { not: null } },
    select: { id: true, pieceKind: true },
  });
  const pieceKindByFormat = new Map<string, PieceKind>();
  for (const f of formats) if (isPieceKind(f.pieceKind)) pieceKindByFormat.set(f.id, f.pieceKind);
  const kindOf = (formatId: string | null) =>
    formatId ? (pieceKindByFormat.get(formatId) ?? null) : null;

  // A format of a kind has no prices of its own (#2359), so a want, a lot line or a trade line in it
  // is valued as a piece of its one stamp (#2375, the collector's call): by its area's method or the
  // collection's, rate-correct, from the conditions the method maps.
  rows = rows.map((r) =>
    r.copy === null && kindOf(r.formatId) !== null
      ? {
          ...r,
          copy: {
            itemId: r.id,
            stampCount: 1,
            franking: DEFAULT_FRANKING,
            method: null,
            draftEntries: [{ stampId: r.stampId, quantity: 1, formatId: null }],
          },
        }
      : r
  );

  // A piece is valued by its method from its stamps' prices (#2359), never as its leading stamp —
  // so its own `stampId` is not priced, its entries are.
  const pieceRows = rows.filter(
    (r) => r.copy !== null && isPiece(r.copy.stampCount, kindOf(r.formatId))
  );
  const pieceIds = new Set(pieceRows.map((r) => r.id));
  const catalogRows = rows.filter((r) => !pieceIds.has(r.id));
  const storedPieces = pieceRows.filter((r) => !r.copy!.draftEntries);
  const draftPieces = pieceRows.filter((r) => r.copy!.draftEntries);
  const [storedEntries, draftStamps] = await Promise.all([
    storedPieces.length
      ? prisma.itemStamp.findMany({
          where: { itemId: { in: storedPieces.map((r) => r.copy!.itemId) } },
          orderBy: [{ itemId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
          select: {
            id: true,
            itemId: true,
            stampId: true,
            quantity: true,
            formatId: true,
            stamp: { select: { variants: { select: VARIANT_FLAG_SELECT } } },
          },
        })
      : [],
    // A piece not yet written (#2353) brings its entries; only whether each stamp is an umbrella is
    // read, so the preview values them exactly as the copy will be.
    draftPieces.length
      ? prisma.stamp.findMany({
          where: {
            collectionId,
            id: { in: draftPieces.flatMap((r) => r.copy!.draftEntries!.map((e) => e.stampId)) },
          },
          select: { id: true, variants: { select: VARIANT_FLAG_SELECT } },
        })
      : [],
  ]);
  const draftStampById = new Map(draftStamps.map((s) => [s.id, s]));
  const entries = [
    ...storedEntries,
    ...draftPieces.flatMap((r) =>
      r.copy!.draftEntries!.flatMap((e, i) => {
        const stamp = draftStampById.get(e.stampId);
        // A stamp outside the collection is not valued — the preview's input is the client's.
        return stamp
          ? [{ id: `${r.copy!.itemId}:${i}`, itemId: r.copy!.itemId, ...e, stamp }]
          : [];
      })
    ),
  ];
  const entriesByItem = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = entriesByItem.get(e.itemId);
    if (list) list.push(e);
    else entriesByItem.set(e.itemId, [e]);
  }

  // A copy with a candidate set (#1651) is valued over its candidates, any of which may be an umbrella
  // itself — so their descendants are read too, and which of them is an umbrella is told by the tree.
  const candidateIds = new Set(catalogRows.flatMap((r) => r.candidateStampIds ?? []));
  const unknownStampIds = new Set([
    ...catalogRows.filter((r) => r.unknownVariant && !r.candidateStampIds).map((r) => r.stampId),
    ...entries.filter((e) => isUnknownVariantStamp(e.stamp)).map((e) => e.stampId),
  ]);
  const descendantsByStamp = await buildDescendantMap(
    collectionId,
    new Set([...unknownStampIds, ...candidateIds])
  );

  // Every stamp whose prices/area we must load: the copies' own stamps, the stamps on every piece,
  // the descendant variants of any unknown-variant one, and the candidates of any set.
  const stampIds = new Set<string>(candidateIds);
  for (const r of catalogRows) stampIds.add(r.stampId);
  for (const e of entries) stampIds.add(e.stampId);
  for (const set of descendantsByStamp.values()) {
    for (const id of set) stampIds.add(id);
  }

  // The Michel method works a still-valid stamp's missing cover price out by Michel's rule (#2358).
  const [stamps, factorLookup, methods, stillValidFor] = await Promise.all([
    prisma.stamp.findMany({
      where: { id: { in: [...stampIds] } },
      select: {
        id: true,
        // Which descendants are **fully identified** (#617) is a fact about the tree's shape: a node
        // with variant children of its own is an umbrella too (ADR-0010 §3), so it is not expected to
        // carry a price. Read as one column here rather than as a `variants` relation per stamp — the
        // whole subtree is already in this result set, so the parent edges are enough.
        parentId: true,
        // Catalogue order, which breaks a tie between two equally cheap candidates (#1651).
        primaryCatalogSortKey: true,
        catalogPrices: { select: VALUATION_PRICE_SELECT },
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
        // The issue anchors a format multiplier (#343) — the narrowest anchor a catalog prints one
        // against. A stamp belongs to at most one issue in practice.
        issueMemberships: { select: { issueId: true }, take: 1 },
        ...VARIANT_FLAG_SELECT,
      },
    }),
    makeFormatFactorLookup(collectionId),
    pieceRows.length ? loadValuationMethods(collectionId) : null,
    pieceRows.length ? makeStillValidLookup(collectionId) : null,
  ]);

  const pricesByStamp = new Map<string, RawCatalogPrice[]>();
  const primaryCatalogByStamp = new Map<string, string | null>();
  const areaByStamp = new Map<string, string | null>();
  const issueByStamp = new Map<string, string | null>();
  const sortKeyByStamp = new Map<string, string | null>();
  // Which descendants count as variants (ADR-0010 §3): only variant-kind children
  // feed the lowest-child price; distinct-entry descendants are excluded.
  const isVariantByStamp = new Map<string, boolean>();
  /** Stamps that have a variant-kind child of their own — the ones no price is expected of (#617). */
  const umbrellaStampIds = new Set<string>();
  const currencies: string[] = [];
  for (const s of stamps) {
    pricesByStamp.set(s.id, s.catalogPrices);
    isVariantByStamp.set(s.id, childIsVariant(s));
    if (s.parentId && childIsVariant(s)) umbrellaStampIds.add(s.parentId);
    for (const p of s.catalogPrices) currencies.push(p.currency);
    const link = s.stampAreaLinks.find((l) => l.isPrimary) ?? s.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    primaryCatalogByStamp.set(
      s.id,
      areaId ? (primaryCatalogByArea.get(areaId) ?? null) : null
    );
    areaByStamp.set(s.id, areaId);
    issueByStamp.set(s.id, s.issueMemberships[0]?.issueId ?? null);
    sortKeyByStamp.set(s.id, s.primaryCatalogSortKey);
  }

  if (typed && typed.length > 0) await applyTypedPrices(typed);

  const rates = await safeRateMap(collectionId, baseCurrency, currencies);

  const result = new Map<string, CopyValuation>();
  for (const r of rows) {
    // A copy's modifier adjusts whichever figure it has (#2357), and then its faults lower it
    // (#1560) — in that order, applied here and nowhere else so that no reader can skip either.
    const modified = applyValueModifier(valuateRow(r), r.valueModifier, baseCurrency, rates);
    result.set(r.id, applyFaultReduction(modified, r.faultReductionPercent));
  }
  return result;

  function valuateRow(r: ValuationRow): CopyValuation {
    if (pieceIds.has(r.id)) return valuateWholePiece(r);
    if (r.candidateStampIds && r.candidateStampIds.length > 1) {
      // Each candidate valued as a copy of it would be — its own area's catalogue, its own issue's
      // format factor, its own variants when it is an umbrella — then the lowest of them (#1651).
      const ordered = [...r.candidateStampIds].sort((a, b) => {
        const ka = sortKeyByStamp.get(a) ?? null;
        const kb = sortKeyByStamp.get(b) ?? null;
        if (ka === kb) return a < b ? -1 : a > b ? 1 : 0;
        if (ka === null) return 1;
        if (kb === null) return -1;
        return ka < kb ? -1 : 1;
      });
      return valuateCandidateCopy(
        ordered.map((stampId) => ({
          stampId,
          valuation: valuateAt(r, stampId, umbrellaStampIds.has(stampId)),
          identified: !umbrellaStampIds.has(stampId),
        })),
        baseCurrency,
        rates
      );
    }
    return valuateAt(r, r.stampId, r.unknownVariant);
  }

  /**
   * A piece by its method (#2359; `piece-valuation.ts`): each stamp on it read in the conditions the
   * method maps (#2375) — its used price at the entry's own format and as a single, and its prices on
   * cover and on piece at the single — no certificate, in the collection currency, then the rule. The
   * copy's own condition steers nothing. The method comes from the most expensive stamp's area, that
   * stamp found by the used price in the condition the **collection's** method maps as used (the
   * collector's call: the method cannot be known before it is chosen).
   */
  function valuateWholePiece(r: ValuationRow): CopyValuation {
    const copy = r.copy!;
    const kind = kindOf(r.formatId);
    const { roles, columns: columnOf } = methods!;
    const entries = entriesByItem.get(copy.itemId) ?? [];
    let uncertain = false;
    const at = (
      stampId: string,
      unknownVariant: boolean,
      formatId: string | null,
      conditionId: string,
      stillValid: StillValidRule | null = null
    ): CopyValuation => {
      const v = valuateAt(
        { ...r, conditionId, certificateStatusId: null, formatId, unknownVariant },
        stampId,
        unknownVariant,
        stillValid
      );
      if (v.uncertain && !v.unpriced) uncertain = true;
      return v;
    };

    const defaultUsed = roles[methods!.collection].used;
    const probe = entries.map((e) => {
      const unknownVariant = isUnknownVariantStamp(e.stamp);
      const single = { ...r, conditionId: defaultUsed ?? "", certificateStatusId: null, formatId: null };
      return {
        stampId: e.stampId,
        usedSingle: defaultUsed
          ? valuateAt({ ...single, unknownVariant }, e.stampId, unknownVariant).baseAmount
          : null,
      };
    });
    const top = mostExpensiveStamp(probe);
    const topArea = top ? (areaByStamp.get(top) ?? null) : null;
    const resolved = resolveMethod(copy.method, methods!.areas, topArea, methods!.collection);
    const method = resolved.method;
    const mapping = roles[method];

    const unmapped: UnmappedRole[] = [];
    const unmappedPrices = new Set<PiecePrice>();
    const columns: Partial<Record<PiecePrice, PieceColumn>> = {};
    const conditionOf = (price: PiecePrice): string | null => {
      const role = roleOfPrice(method, price);
      return role ? (mapping[role] ?? null) : null;
    };
    for (const price of PIECE_PRICES) {
      const role = roleOfPrice(method, price);
      if (!role) continue;
      const conditionId = mapping[role];
      const column = conditionId ? columnOf.get(conditionId) : undefined;
      if (column) columns[price] = column;
      else unmappedPrices.add(price);
    }
    // Michel's rule (#2358), the Michel method's own: it reads the conditions mapped as used and
    // never hinged, and with either unmapped it gives nothing — and says which.
    const usedId = mapping.used;
    const neverHingedId = mapping.never_hinged;
    const rule: StillValidRule | null =
      method === "michel" && usedId && neverHingedId
        ? { usedConditionId: usedId, neverHingedConditionId: neverHingedId }
        : null;
    let ruleWanted = false;

    const components: PieceComponent[] = entries.map((e) => {
      const unknown = isUnknownVariantStamp(e.stamp);
      const derived: PiecePrice[] = [];
      const price = (p: PiecePrice): number | null => {
        const conditionId = conditionOf(p);
        if (!conditionId) return null;
        const v = at(e.stampId, unknown, null, conditionId);
        if (!v.unpriced || v.mark) return v.baseAmount;
        const ruled =
          method === "michel" &&
          p !== "on_piece" &&
          p !== "used" &&
          stillValidFor!(areaByStamp.get(e.stampId) ?? null, issueByStamp.get(e.stampId) ?? null);
        if (!ruled) return null;
        if (!rule) {
          ruleWanted = true;
          return null;
        }
        const byRule = at(e.stampId, unknown, null, rule.usedConditionId, rule);
        if (byRule.baseAmount !== null) derived.push(p);
        return byRule.baseAmount;
      };
      return {
        id: e.id,
        stampId: e.stampId,
        quantity: e.quantity,
        multiple: e.formatId !== null,
        used: usedId ? at(e.stampId, unknown, e.formatId, usedId).baseAmount : null,
        usedSingle:
          usedId && e.formatId !== null ? at(e.stampId, unknown, null, usedId).baseAmount : null,
        coverEf: price("cover_ef"),
        coverMef: price("cover_mef"),
        coverMif: price("cover_mif"),
        onPiece: price("on_piece"),
        ...(derived.length ? { derived } : {}),
      };
    });
    for (const c of components) if (!c.multiple) c.usedSingle = c.used;

    const result = valuePiece({
      kind,
      franking: copy.franking,
      method,
      components,
      unmapped: unmappedPrices,
    });
    for (const price of result.unmapped) {
      const role = roleOfPrice(method, price);
      if (role && !unmapped.some((u) => u.role === role)) unmapped.push({ method, role });
    }
    // The rule was wanted for a stamp it could not price: name the role it lacks.
    if (ruleWanted) {
      for (const role of ["used", "never_hinged"] as const) {
        if (!mapping[role] && !unmapped.some((u) => u.role === role)) unmapped.push({ method, role });
      }
    }
    return valuatePiece(
      result,
      {
        method,
        methodSource: resolved.source,
        inherited: inheritedMethod(methods!.areas, topArea, methods!.collection),
        franking: copy.franking,
        kind,
        components,
        unmapped,
        columns,
      },
      uncertain,
      baseCurrency
    );
  }

  /** Put the typed prices in place of what is on file at their keys ({@link TypedCatalogPrices}). */
  async function applyTypedPrices(prices: TypedCatalogPrices): Promise<void> {
    const catalogIds = new Set<string>();
    for (const p of prices) {
      const id = primaryCatalogByStamp.get(p.stampId);
      if (id) catalogIds.add(id);
    }
    const catalogs = await prisma.catalogName.findMany({
      where: { id: { in: [...catalogIds] } },
      select: {
        id: true,
        currency: true,
        catalogEditions: { select: { year: true }, orderBy: { year: "desc" }, take: 1 },
      },
    });
    const catalogById = new Map(catalogs.map((c) => [c.id, c]));
    for (const p of prices) {
      const own = pricesByStamp.get(p.stampId);
      const catalogNameId = primaryCatalogByStamp.get(p.stampId);
      const catalog = catalogNameId ? catalogById.get(catalogNameId) : undefined;
      const year = catalog?.catalogEditions[0]?.year;
      const cell = parsePriceCellInput(p.amount);
      if (!own || !catalog || year === undefined) continue;
      if (cell.kind !== "amount" && cell.kind !== "mark") continue;
      const sameKey = (q: RawCatalogPrice) =>
        q.catalogEdition.catalogNameId === catalog.id &&
        q.catalogEdition.year === year &&
        q.conditionId === p.conditionId &&
        q.certificateStatusId === null &&
        q.formatId === null;
      pricesByStamp.set(p.stampId, [
        ...own.filter((q) => !sameKey(q)),
        {
          price: cell.kind === "amount" ? new Prisma.Decimal(roundAmount(cell.amount)) : null,
          mark: cell.kind === "mark" ? cell.mark : null,
          currency: catalog.currency,
          conditionId: p.conditionId,
          certificateStatusId: null,
          formatId: null,
          catalogEdition: { year, catalogNameId: catalog.id },
        },
      ]);
      currencies.push(catalog.currency);
    }
  }

  /** `r`'s condition, certificate and format, valued as a copy of `stampId` — by Michel's rule for a
   *  stamp still valid for postage when `stillValid` is given (#2358). */
  function valuateAt(
    r: ValuationRow,
    stampId: string,
    unknownVariant: boolean,
    stillValid: StillValidRule | null = null
  ): CopyValuation {
    const descendants = unknownVariant
      ? [...(descendantsByStamp.get(stampId) ?? new Set<string>())].filter(
          (id) => isVariantByStamp.get(id) ?? false
        )
      : null;
    const formatId = r.formatId;
    const areaId = areaByStamp.get(stampId) ?? null;
    const issueId = issueByStamp.get(stampId) ?? null;
    return valuateCopy({
      conditionId: r.conditionId,
      certificateStatusId: r.certificateStatusId,
      formatId,
      // Resolved against the copy's *own* stamp — a variant child's price, when the rollup uses
      // one, is scaled by the same rule, since it shares the umbrella's issue and area.
      formatFactor: factorLookup(formatId, areaId, issueId, r.conditionId),
      stillValid,
      unknownVariant,
      primaryCatalogNameId: primaryCatalogByStamp.get(stampId) ?? null,
      ownPrices: pricesByStamp.get(stampId) ?? [],
      // Tagged with the variant each array belongs to (#616), so the rollup's answer names the
      // stamp it took its figure from.
      variantPrices: descendants
        ? descendants.map((id) => ({
            stampId: id,
            prices: pricesByStamp.get(id) ?? [],
            // A leaf of the variant tree is fully identified; a node with variants of its own is
            // still an umbrella, whose value is the lowest of its children rather than a price of
            // its own (#617).
            identified: !umbrellaStampIds.has(id),
          }))
        : undefined,
      baseCurrency,
      rates,
    });
  }
}

/** The collection's valuation method and every area's own (#2359), for {@link resolveMethod}, and
 *  which condition plays each role of each method (#2375) with how each mapped one is named. */
async function loadValuationMethods(collectionId: string): Promise<{
  collection: ValuationMethod;
  areas: Map<string, MethodArea>;
  roles: ValuationMethodRoles;
  columns: Map<string, PieceColumn>;
}> {
  const [collection, areas, roleRows] = await Promise.all([
    prisma.collection.findUniqueOrThrow({
      where: { id: collectionId },
      select: { valuationMethod: true },
    }),
    prisma.collectionArea.findMany({
      where: { collectionId },
      select: { id: true, parentId: true, valuationMethod: true, name: true },
    }),
    prisma.valuationMethodRole.findMany({
      where: { collectionId },
      select: {
        method: true,
        role: true,
        conditionId: true,
        condition: { select: { abbreviation: true, symbol: true } },
      },
    }),
  ]);
  return {
    collection: isValuationMethod(collection.valuationMethod)
      ? collection.valuationMethod
      : DEFAULT_VALUATION_METHOD,
    areas: new Map(areas.map((a) => [a.id, a])),
    roles: methodRolesOf(roleRows),
    columns: new Map(
      roleRows.map((r) => [
        r.conditionId,
        { conditionId: r.conditionId, abbreviation: r.condition.abbreviation, symbol: r.condition.symbol },
      ])
    ),
  };
}

/** Value a set of copies by id, resolving each copy's condition, certificate, and
 * unknown-variant flag from the database, then applying the same primary-catalog
 * price-for-condition×certificate rule the Copies screen uses. Returned as id →
 * valuation; ids not found are simply absent. The lot-close flow (#121) reads
 * `baseAmount` off each valuation as the allocation weight (ADR-0009 §3.3). Caller
 * must have already asserted collection ownership. */
export async function valuateItemsByIds(
  collectionId: string,
  itemIds: string[]
): Promise<Map<string, CopyValuation>> {
  if (itemIds.length === 0) return new Map();
  const rows = await prisma.item.findMany({
    where: { id: { in: itemIds }, collectionId },
    select: {
      id: true,
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      ...COPY_VALUATION_SELECT,
      stamp: { select: { parentId: true, variants: { select: VARIANT_FLAG_SELECT } } },
    },
  });
  const valuationRows: ValuationRow[] = rows.map((row) => ({
    id: row.id,
    stampId: row.stampId,
    conditionId: row.conditionId,
    certificateStatusId: row.certificateStatusId,
    formatId: row.formatId,
    unknownVariant:
      isUnknownVariantStamp(row.stamp),
    ...copyValuationOf(row),
  }));
  return valuateItemRows(collectionId, valuationRows);
}
