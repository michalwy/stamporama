import "server-only";
import type { DbTransaction } from "./db";
import { formatCatalogNumber } from "./catalog-number";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";
import {
  summarizeOwnPrices,
  type UmbrellaPricesPolicy,
  type UmbrellaWithOwnPrices,
} from "./umbrella-prices-question";

/**
 * A write that would turn a priced stamp into an umbrella, refused because the collector has not yet
 * said what becomes of its prices (#1573). Thrown **before** anything is written, so the server
 * action can hand the question back to the screen, and cancelling it leaves nothing behind.
 */
export class UmbrellaPricesUnanswered extends Error {
  constructor(readonly umbrellas: UmbrellaWithOwnPrices[]) {
    super("Say whether the new umbrella keeps its own catalogue prices.");
    this.name = "UmbrellaPricesUnanswered";
  }
}

/**
 * Of `parentIds` — stamps an operation is about to give a variant child — those that would become an
 * umbrella while carrying catalogue prices of their own: no variant child yet (ADR-0010 §3, the rule
 * {@link isUnknownVariantStamp} reads) and at least one `StampCatalogPrice` row. A stamp that is
 * already an umbrella is not asked about again — whatever price it carries was recorded on an
 * umbrella, knowingly — and one without prices has nothing to decide.
 *
 * Answered in the order the ids were given, each once.
 */
export async function findPricedStampsBecomingUmbrellas(
  db: DbTransaction,
  collectionId: string,
  parentIds: readonly string[]
): Promise<UmbrellaWithOwnPrices[]> {
  const ids = [...new Set(parentIds)];
  if (ids.length === 0) return [];
  const rows = await db.stamp.findMany({
    where: { id: { in: ids }, collectionId, catalogPrices: { some: {} } },
    select: {
      id: true,
      variants: { select: VARIANT_FLAG_SELECT },
      catalogNumbers: {
        select: { number: true, catalogVendor: { select: { abbreviation: true } } },
      },
      catalogPrices: {
        select: {
          catalogEditionId: true,
          catalogEdition: { select: { year: true, catalogName: { select: { name: true } } } },
        },
      },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const found: UmbrellaWithOwnPrices[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || isUnknownVariantStamp(row)) continue;
    // The number the question names the stamp by. The dialog asking already says which stamp it is
    // working on, so this only has to tell several apart (a variant tree can make more than one an
    // umbrella at once): every number it has, alphabetically by catalogue, needs no area context.
    const label =
      row.catalogNumbers
        .map((cn) => formatCatalogNumber(cn.catalogVendor.abbreviation, null, cn.number))
        .sort((a, b) => a.localeCompare(b))
        .join(" / ") || null;
    found.push({
      stampId: row.id,
      label,
      ...summarizeOwnPrices(
        row.catalogPrices.map((p) => ({
          catalogEditionId: p.catalogEditionId,
          catalogName: p.catalogEdition.catalogName.name,
          year: p.catalogEdition.year,
        }))
      ),
    });
  }
  return found;
}

/**
 * Apply the collector's answer for the stamps an operation is about to make umbrellas (#1573), inside
 * that operation's transaction and before it writes the variant:
 *
 * - `ask` throws {@link UmbrellaPricesUnanswered} when any of them carries prices of its own, which
 *   rolls the transaction back with nothing written;
 * - `clear` removes **every** price those stamps record of their own — each edition, condition,
 *   certificate and format — so their value rolls up from their variants (#238);
 * - `keep` leaves them, as the umbrella's recorded price, exactly as every write did before.
 *
 * Answers the stamps it found, whatever the policy, so a caller that cannot ask (the agent API) can
 * report them.
 */
export async function settleUmbrellaPrices(
  db: DbTransaction,
  collectionId: string,
  parentIds: readonly string[],
  policy: UmbrellaPricesPolicy
): Promise<UmbrellaWithOwnPrices[]> {
  const umbrellas = await findPricedStampsBecomingUmbrellas(db, collectionId, parentIds);
  if (umbrellas.length === 0) return [];
  if (policy === "ask") throw new UmbrellaPricesUnanswered(umbrellas);
  if (policy === "clear") {
    await db.stampCatalogPrice.deleteMany({
      where: { stampId: { in: umbrellas.map((u) => u.stampId) } },
    });
  }
  return umbrellas;
}

/** The subtype's effective variant flag for a child about to be written with `subtypeId` and
 *  `override` — {@link isUnknownVariantStamp}'s per-child rule, read before the row exists. */
export async function wouldActAsVariant(
  db: DbTransaction,
  subtypeId: string | null,
  override: boolean | null
): Promise<boolean> {
  if (override !== null) return override;
  if (!subtypeId) return false;
  const subtype = await db.stampSubtype.findUnique({
    where: { id: subtypeId },
    select: { actsAsVariant: true },
  });
  return subtype?.actsAsVariant ?? false;
}
