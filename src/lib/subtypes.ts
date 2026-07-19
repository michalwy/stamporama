import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Default stamp subtypes seeded into every new collection, in display order.
 * See ADR-0010 (#127). Users can add, rename, reorder, and delete these afterwards.
 *
 * `actsAsVariant` is the behavioural switch: a child stamp of an `actsAsVariant`
 * subtype makes its parent an unknown-variant umbrella (lowest-child valuation,
 * any-variant completeness); a non-variant subtype leaves the parent untouched.
 * Exactly one row is `isDefault` — the type assigned to newly created children and
 * the backfill target for existing children.
 *
 * This list is REPLICATED BY HAND in the migration SQL
 * (prisma/migrations/20260719100000_add_stamp_subtype/migration.sql); the two must
 * be kept in sync.
 */
export const DEFAULT_STAMP_SUBTYPES: ReadonlyArray<{
  name: string;
  actsAsVariant: boolean;
  isDefault: boolean;
}> = [
  { name: "Variant", actsAsVariant: true, isDefault: true },
  { name: "Colour variety", actsAsVariant: true, isDefault: false },
  { name: "Perforation variety", actsAsVariant: true, isDefault: false },
  { name: "Paper variety", actsAsVariant: true, isDefault: false },
  { name: "Watermark variety", actsAsVariant: true, isDefault: false },
  { name: "Print variety", actsAsVariant: true, isDefault: false },
  { name: "Error", actsAsVariant: false, isDefault: false },
  { name: "Plate flaw", actsAsVariant: false, isDefault: false },
  { name: "Overprint", actsAsVariant: false, isDefault: false },
];

/**
 * Seeds the default subtype set for a freshly created collection. Runs inside the
 * collection-creation transaction, so it receives the transactional client. Mirrors
 * `seedDefaultConditions`.
 */
export async function seedDefaultSubtypes(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  await tx.stampSubtype.createMany({
    data: DEFAULT_STAMP_SUBTYPES.map((s, i) => ({
      collectionId,
      name: s.name,
      actsAsVariant: s.actsAsVariant,
      isDefault: s.isDefault,
      sortOrder: i,
    })),
  });
}
