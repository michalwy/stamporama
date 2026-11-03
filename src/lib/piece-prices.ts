import "server-only";
import { prisma } from "./db";
import { buildEffectivePrimaryCatalogMap } from "./pricing";
import { assertCollectionOwner } from "./platform-category";
import { isCoverKind, type CoverKind } from "./cover-kind";
import { parsePriceCellInput } from "./catalog-price-mark";
import { priceCellInput, quickSetCatalogPrices } from "./stamps";
import { getVariantSubtrees, type VariantPriceRow } from "./variant-prices";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";
import { piecePriceKey, type TypedPiecePrice } from "./piece-price-entry";
import type { PiecePrice } from "./piece-valuation";

// A piece's stamp prices typed in place (#2368) — the database half: what each field opens on, and
// the save. Every field is a stamp × price at the piece's condition, no certificate, the latest
// edition of the stamp's main catalogue — the used price at the single, a price on cover or on piece
// at its reserved row (#2356) — which is exactly the price the piece's value reads.

/** One stamp's fields: where its prices land and what is on file there. */
export interface PiecePriceStamp {
  /** The main catalogue's currency, null when the stamp's area has no main catalogue with an edition
   *  — its prices cannot be typed here then. */
  currency: string | null;
  /** True when the stamp has variants of its own: it is priced through them (#2161's rule). */
  isUmbrella: boolean;
}

export interface PiecePriceFields {
  /** Every stamp asked about and every variant of an umbrella among them. */
  stamps: Record<string, PiecePriceStamp>;
  /** What is on file, by {@link piecePriceKey}, as a field shows it (`12.50`, `—`, `?`). */
  recorded: Record<string, string>;
  /** Each umbrella's tree as the variant grid draws it (`subtree`), by the umbrella's id. */
  trees: Record<string, VariantPriceRow[]>;
}

/** The prices typed in place may land on: the single, and the four reserved rows by kind. */
async function coverRows(collectionId: string): Promise<Map<CoverKind, string>> {
  const rows = await prisma.stampFormat.findMany({
    where: { collectionId, coverKind: { not: null } },
    select: { id: true, coverKind: true },
  });
  const byKind = new Map<CoverKind, string>();
  for (const r of rows) if (isCoverKind(r.coverKind)) byKind.set(r.coverKind, r.id);
  return byKind;
}

/** Each stamp's main catalogue at its latest edition — where its prices are typed. */
async function mainCatalogs(
  collectionId: string,
  stampIds: readonly string[]
): Promise<Map<string, { catalogNameId: string; editionId: string; currency: string }>> {
  const [stamps, primaryByArea] = await Promise.all([
    prisma.stamp.findMany({
      where: { id: { in: [...stampIds] }, collectionId },
      select: { id: true, stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } } },
    }),
    buildEffectivePrimaryCatalogMap(collectionId),
  ]);
  const catalogByStamp = new Map<string, string>();
  for (const s of stamps) {
    const link = s.stampAreaLinks.find((l) => l.isPrimary) ?? s.stampAreaLinks[0];
    const catalogNameId = link ? primaryByArea.get(link.collectionAreaId) : null;
    if (catalogNameId) catalogByStamp.set(s.id, catalogNameId);
  }
  const catalogs = await prisma.catalogName.findMany({
    where: { id: { in: [...new Set(catalogByStamp.values())] } },
    select: {
      id: true,
      currency: true,
      catalogEditions: { select: { id: true }, orderBy: { year: "desc" }, take: 1 },
    },
  });
  const byId = new Map(catalogs.map((c) => [c.id, c]));
  const result = new Map<string, { catalogNameId: string; editionId: string; currency: string }>();
  for (const [stampId, catalogNameId] of catalogByStamp) {
    const catalog = byId.get(catalogNameId);
    const edition = catalog?.catalogEditions[0];
    if (catalog && edition) {
      result.set(stampId, { catalogNameId, editionId: edition.id, currency: catalog.currency });
    }
  }
  return result;
}

/**
 * What the fields of a piece's stamps open on (#2368): each stamp's main catalogue and what is on file
 * for it at the piece's condition, and each umbrella's variants — the tree #618's grid draws — with
 * theirs. One read for the whole piece.
 */
export async function getPiecePriceFields(
  ownerId: string,
  collectionId: string,
  input: { conditionId: string; stampIds: readonly string[] }
): Promise<PiecePriceFields> {
  await assertCollectionOwner(ownerId, collectionId);
  const asked = await prisma.stamp.findMany({
    where: { id: { in: [...new Set(input.stampIds)] }, collectionId },
    select: { id: true, variants: { select: VARIANT_FLAG_SELECT } },
  });
  const umbrellaIds = asked.filter((s) => isUnknownVariantStamp(s)).map((s) => s.id);
  const trees = umbrellaIds.length ? await getVariantSubtrees(ownerId, umbrellaIds) : {};
  const umbrellas = new Set(umbrellaIds);
  for (const rows of Object.values(trees)) {
    for (const r of rows) if (!r.identified) umbrellas.add(r.stampId);
  }
  const stampIds = [
    ...new Set([...asked.map((s) => s.id), ...Object.values(trees).flat().map((r) => r.stampId)]),
  ];
  const [catalogs, covers] = await Promise.all([
    mainCatalogs(collectionId, stampIds),
    coverRows(collectionId),
  ]);
  const priceByFormat = new Map<string | null, PiecePrice>([[null, "used"]]);
  for (const [kind, id] of covers) priceByFormat.set(id, kind);

  const prices = await prisma.stampCatalogPrice.findMany({
    where: {
      stampId: { in: [...catalogs.keys()] },
      catalogEditionId: { in: [...new Set([...catalogs.values()].map((c) => c.editionId))] },
      conditionId: input.conditionId,
      certificateStatusId: null,
      OR: [{ formatId: null }, { formatId: { in: [...covers.values()] } }],
    },
    select: { stampId: true, catalogEditionId: true, formatId: true, price: true, mark: true },
  });
  const recorded: Record<string, string> = {};
  for (const p of prices) {
    const price = priceByFormat.get(p.formatId);
    // Another catalogue's latest edition, where two areas' main catalogues differ.
    if (!price || catalogs.get(p.stampId)?.editionId !== p.catalogEditionId) continue;
    recorded[piecePriceKey(p.stampId, price)] = priceCellInput(p);
  }

  const stamps: Record<string, PiecePriceStamp> = {};
  for (const id of stampIds) {
    stamps[id] = { currency: catalogs.get(id)?.currency ?? null, isUmbrella: umbrellas.has(id) };
  }
  return { stamps, recorded, trees };
}

/**
 * Save the prices typed on a piece's stamps (#2368) — each where its field said it lands, and so read
 * by every other piece and copy of that stamp. Every figure is parsed before anything is written, so
 * a typo in the last field leaves the first ones unwritten too; a blank one is not sent at all.
 */
export async function setPiecePrices(
  ownerId: string,
  collectionId: string,
  input: { conditionId: string; prices: readonly TypedPiecePrice[] }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const parsed = input.prices.map((p) => {
    const cell = parsePriceCellInput(p.amount);
    if (cell.kind !== "amount" && cell.kind !== "mark") {
      throw new Error("Enter a valid non-negative amount, - or ?.");
    }
    return { ...p, amount: cell.kind === "amount" ? cell.amount : cell.mark };
  });
  if (parsed.length === 0) return;
  const [catalogs, covers] = await Promise.all([
    mainCatalogs(
      collectionId,
      parsed.map((p) => p.stampId)
    ),
    coverRows(collectionId),
  ]);
  for (const p of parsed) {
    const catalog = catalogs.get(p.stampId);
    if (!catalog) throw new Error("A stamp on this piece has no main catalogue to price it in.");
    const formatId = p.price === "used" ? null : covers.get(p.price);
    if (formatId === undefined) throw new Error("This collection has no row for that price on cover.");
    await quickSetCatalogPrices(
      ownerId,
      p.stampId,
      input.conditionId,
      null,
      [{ catalogNameId: catalog.catalogNameId, amount: p.amount }],
      formatId
    );
  }
}
