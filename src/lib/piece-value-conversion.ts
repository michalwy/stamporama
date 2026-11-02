import "server-only";
import { prisma } from "./db";
import { pieceCopyOf, valuateItemRows, valueModifierOf, type ValuationRow } from "./item-valuation";
import { getCollectionBaseCurrency, safeRateMap } from "./pricing";
import { convertRecordedValue } from "./piece-value-conversion-rules";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";

// Once, at boot (#2359): every value a collector recorded on a piece (#747) moves onto the copy's
// amount modifier (#2357), so that the piece — now valued by its method — is worth on the day exactly
// what it was. The method needs the catalogue read in TypeScript, which a SQL migration cannot do;
// hence a boot pass, as #1800 and #2068 are. Idempotent: a moved row's `explicitValue` is cleared,
// so every later boot costs one query.
//
// A row is left as it is, and said so in the log, when the move cannot keep its value: the method
// prices nothing on the piece, or the recorded currency has no rate. It is tried again on the next
// boot, once prices or rates are there. A figure left on a copy that is no longer a piece was never
// read (#747 read it only while the copy carried several stamps) and is simply cleared.

export interface PieceValueConversion {
  moved: number;
  cleared: number;
  /** Item numbers left recorded, per collection. */
  kept: { collectionId: string; itemNos: number[] }[];
}

export async function convertRecordedPieceValues(): Promise<PieceValueConversion> {
  const rows = await prisma.item.findMany({
    where: { explicitValue: { not: null } },
    select: {
      id: true,
      itemNo: true,
      collectionId: true,
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      stampCount: true,
      franking: true,
      valuationMethod: true,
      explicitValue: true,
      explicitValueCurrency: true,
      valueModifierPercent: true,
      valueModifierAmount: true,
      valueModifierNote: true,
      stamp: { select: { variants: { select: VARIANT_FLAG_SELECT } } },
    },
  });
  const result: PieceValueConversion = { moved: 0, cleared: 0, kept: [] };
  const byCollection = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCollection.get(row.collectionId);
    if (list) list.push(row);
    else byCollection.set(row.collectionId, [row]);
  }

  for (const [collectionId, items] of byCollection) {
    // The method's figure alone: no modifier and no fault reduction, which the move keeps as they are.
    const valuationRows: ValuationRow[] = items.map((row) => ({
      id: row.id,
      stampId: row.stampId,
      conditionId: row.conditionId,
      certificateStatusId: row.certificateStatusId,
      formatId: row.formatId,
      unknownVariant: isUnknownVariantStamp(row.stamp),
      copy: pieceCopyOf(row),
      faultReductionPercent: null,
      valueModifier: null,
      candidateStampIds: null,
    }));
    const baseCurrency = await getCollectionBaseCurrency(collectionId);
    const [valuations, rates] = await Promise.all([
      valuateItemRows(collectionId, valuationRows),
      safeRateMap(
        collectionId,
        baseCurrency,
        items.flatMap((row) => (row.explicitValueCurrency ? [row.explicitValueCurrency] : []))
      ),
    ]);
    const kept: number[] = [];
    for (const row of items) {
      const valuation = valuations.get(row.id);
      const clear = { explicitValue: null, explicitValueCurrency: null };
      if (!valuation?.piece || !row.explicitValueCurrency) {
        await prisma.item.update({ where: { id: row.id }, data: clear });
        result.cleared++;
        continue;
      }
      const conversion = convertRecordedValue({
        recorded: { amount: Number(row.explicitValue!.toString()), currency: row.explicitValueCurrency },
        modifier: valueModifierOf(row),
        computedBase: valuation.baseAmount,
        baseCurrency,
        rates,
      });
      if (conversion.status !== "moved") {
        kept.push(row.itemNo);
        continue;
      }
      await prisma.item.update({
        where: { id: row.id },
        data: {
          ...clear,
          valueModifierPercent: conversion.modifier?.percent ?? null,
          valueModifierAmount: conversion.modifier?.amount ?? null,
          valueModifierNote: conversion.modifier?.note ?? null,
        },
      });
      result.moved++;
    }
    if (kept.length > 0) result.kept.push({ collectionId, itemNos: kept });
  }
  return result;
}
