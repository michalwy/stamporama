import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { buildDescendantMap } from "./pricing";
import { childIsVariant, VARIANT_FLAG_SELECT } from "./variant-classification";
import { familyUmbrellaId } from "./other-copies-rules";

/**
 * Each stamp's **family** (#2282): its umbrella (`familyUmbrellaId`) and every descendant of that
 * umbrella that acts as a variant, at any depth — ADR-0010 §3's rule as `countVariantDescendantCopies`
 * applies it, so the copies listed under a family are the copies the stamp page counts under the
 * umbrella and its variants. A copy of the umbrella sees its variants' copies, and a copy of a variant
 * sees the umbrella's and its sibling variants'. The umbrella leads; the variants follow in
 * `buildDescendantMap`'s pinned catalogue order. Stamps outside the collection are absent.
 */
export async function loadStampFamilies(
  collectionId: string,
  stampIds: readonly string[]
): Promise<Map<string, string[]>> {
  const families = new Map<string, string[]>();
  const ids = [...new Set(stampIds)];
  if (ids.length === 0) return families;

  // Each stamp's ancestors, nearest first, in one recursive walk up the `parentId` edges.
  const rows = await prisma.$queryRaw<Array<{ origin: string; id: string; depth: number }>>`
    WITH RECURSIVE chain AS (
      SELECT s."id" AS origin, s."id" AS id, s."parentId" AS "parentId", 0 AS depth
      FROM "stamp" s
      WHERE s."id" IN (${Prisma.join(ids)})
        AND s."collectionId" = ${collectionId}
      UNION ALL
      SELECT ch.origin, p."id", p."parentId", ch.depth + 1
      FROM "stamp" p
      JOIN chain ch ON p."id" = ch."parentId"
      WHERE p."collectionId" = ${collectionId}
    )
    SELECT origin, id, depth FROM chain ORDER BY origin, depth
  `;
  const flags = await variantFlags(rows.map((r) => r.id));
  const chains = new Map<string, { id: string; isVariant: boolean }[]>();
  for (const row of rows) {
    const chain = chains.get(row.origin) ?? [];
    chain.push({ id: row.id, isVariant: flags.get(row.id) ?? false });
    chains.set(row.origin, chain);
  }

  const umbrellaOf = new Map([...chains].map(([origin, chain]) => [origin, familyUmbrellaId(chain)]));
  const descendants = await buildDescendantMap(collectionId, new Set(umbrellaOf.values()));
  const descendantFlags = await variantFlags(
    [...descendants.values()].flatMap((set) => [...set])
  );
  for (const [origin, umbrella] of umbrellaOf) {
    const variants = [...(descendants.get(umbrella) ?? [])].filter((id) => descendantFlags.get(id));
    families.set(origin, [umbrella, ...variants]);
  }
  return families;
}

async function variantFlags(stampIds: string[]): Promise<Map<string, boolean>> {
  if (stampIds.length === 0) return new Map();
  const stamps = await prisma.stamp.findMany({
    where: { id: { in: [...new Set(stampIds)] } },
    select: { id: true, ...VARIANT_FLAG_SELECT },
  });
  return new Map(stamps.map((s) => [s.id, childIsVariant(s)]));
}
