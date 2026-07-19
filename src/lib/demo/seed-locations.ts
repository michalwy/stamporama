import "server-only";
import { PrismaClient } from "@/generated/prisma/client";

// Storage locations demo data (#56): a physical storage tree (cabinets → stockbooks/
// boxes) plus assignment of a fraction of the seeded copies to assignable locations,
// some with an in-location ref. Runs after `seedInventory` (the copies must exist).
//
// Deterministic: a fixed-seed PRNG drives every choice so repeated seeds produce the
// same layout. Copies are read back in `id` order for stability.

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface LocationNode {
  name: string;
  assignable?: boolean;
  children?: LocationNode[];
}

// A collector's physical storage, independent of catalog areas: cabinets and a safe
// (grouping-only) holding stockbooks, albums, and boxes (assignable), plus a desk tray.
const TREE: LocationNode[] = [
  {
    name: "Cabinet 1",
    assignable: false,
    children: [
      { name: "Stockbook Poland A" },
      { name: "Stockbook Poland B" },
      { name: "Stockbook Germany" },
    ],
  },
  {
    name: "Cabinet 2",
    assignable: false,
    children: [
      { name: "Classics album" },
      { name: "Duplicates box" },
    ],
  },
  {
    name: "Safe",
    assignable: false,
    children: [{ name: "Certificates envelope" }],
  },
  { name: "Desk tray" },
];

export async function seedLocations(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  const rng = mulberry32(0x4c4f_4341);

  const assignableIds: string[] = [];

  async function insertNode(
    node: LocationNode,
    parentId: string | null
  ): Promise<void> {
    const assignable = node.assignable ?? true;
    const location = await tx.location.create({
      data: { collectionId, name: node.name, parentId, assignable },
      select: { id: true },
    });
    if (assignable) assignableIds.push(location.id);
    for (const child of node.children ?? []) {
      await insertNode(child, location.id);
    }
  }

  for (const root of TREE) {
    await insertNode(root, null);
  }

  if (assignableIds.length === 0) return;

  const items = await tx.item.findMany({
    where: { collectionId },
    orderBy: { id: "asc" },
    select: { id: true },
  });

  // Assign ~60% of copies to a random assignable location. ~55% of those also get an
  // in-location ref (e.g. a page/pocket like `p.12`). Copies without a ref are grouped
  // per location and updated in bulk; ref'd copies are updated individually.
  const noRefByLocation = new Map<string, string[]>();
  const withRef: { id: string; locationId: string; ref: string }[] = [];

  for (const item of items) {
    if (rng() >= 0.6) continue;
    const locationId = assignableIds[Math.floor(rng() * assignableIds.length)];
    if (rng() < 0.55) {
      const ref = `p.${1 + Math.floor(rng() * 60)}`;
      withRef.push({ id: item.id, locationId, ref });
    } else {
      const arr = noRefByLocation.get(locationId) ?? [];
      arr.push(item.id);
      noRefByLocation.set(locationId, arr);
    }
  }

  for (const [locationId, ids] of noRefByLocation) {
    for (let i = 0; i < ids.length; i += 500) {
      await tx.item.updateMany({
        where: { id: { in: ids.slice(i, i + 500) } },
        data: { locationId },
      });
    }
  }

  for (const a of withRef) {
    await tx.item.update({
      where: { id: a.id },
      data: { locationId: a.locationId, locationRef: a.ref },
    });
  }
}
