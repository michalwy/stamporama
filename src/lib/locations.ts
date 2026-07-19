import "server-only";
import { prisma } from "./db";

// Server-side CRUD for storage locations (`Location`), collection-scoped (#56).
// Adjacency-list hierarchy mirroring `CollectionArea` (see areas.ts): grouping-only
// nodes have `assignable = false`, leaf storage that can hold copies has
// `assignable = true`. A copy (`Item`) references at most one assignable location.

async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function resolveLocationCollection(locationId: string): Promise<string> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { collectionId: true },
  });
  if (!location) throw new Error("Location not found.");
  return location.collectionId;
}

export interface LocationData {
  id: string;
  name: string;
  parentId: string | null;
  description: string | null;
  assignable: boolean;
  /** Copies directly assigned to this location (not counting descendants). */
  itemCount: number;
  childCount: number;
}

export async function getLocations(
  ownerId: string,
  collectionId: string
): Promise<LocationData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const locations = await prisma.location.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      parentId: true,
      description: true,
      assignable: true,
      _count: { select: { items: true, children: true } },
    },
  });
  return locations.map((l) => ({
    id: l.id,
    name: l.name,
    parentId: l.parentId,
    description: l.description,
    assignable: l.assignable,
    itemCount: l._count.items,
    childCount: l._count.children,
  }));
}

export async function createLocation(
  ownerId: string,
  collectionId: string,
  data: {
    name: string;
    parentId?: string | null;
    description?: string | null;
    assignable?: boolean;
  }
): Promise<{ id: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  if (data.parentId) {
    const parent = await prisma.location.findUnique({
      where: { id: data.parentId },
      select: { collectionId: true },
    });
    if (!parent || parent.collectionId !== collectionId) {
      throw new Error("Parent location not found.");
    }
  }
  const created = await prisma.location.create({
    data: {
      collectionId,
      name: data.name,
      parentId: data.parentId ?? null,
      description: data.description ?? null,
      assignable: data.assignable ?? true,
    },
    select: { id: true },
  });
  return { id: created.id };
}

export async function updateLocation(
  ownerId: string,
  locationId: string,
  data: {
    name: string;
    parentId?: string | null;
    description?: string | null;
    assignable?: boolean;
  }
): Promise<void> {
  const collectionId = await resolveLocationCollection(locationId);
  await assertCollectionOwner(ownerId, collectionId);

  if (data.parentId) {
    const parent = await prisma.location.findUnique({
      where: { id: data.parentId },
      select: { collectionId: true },
    });
    if (!parent || parent.collectionId !== collectionId) {
      throw new Error("Parent location not found.");
    }
    // Reject cycles: walk up from the proposed parent; the location cannot be its
    // own ancestor.
    let currentId: string | null = data.parentId;
    let depth = 0;
    while (currentId !== null && depth < 50) {
      if (currentId === locationId) {
        throw new Error("Cannot set a location as its own ancestor.");
      }
      const current: { parentId: string | null } | null =
        await prisma.location.findUnique({
          where: { id: currentId },
          select: { parentId: true },
        });
      currentId = current?.parentId ?? null;
      depth++;
    }
  }

  // Making a location non-assignable while copies are filed there would strand them
  // (only assignable locations are valid targets). Block it — detach the copies first.
  if (data.assignable === false) {
    const itemCount = await prisma.item.count({ where: { locationId } });
    if (itemCount > 0) {
      throw new Error(
        "Cannot mark a location non-assignable while copies are stored in it. Move them first."
      );
    }
  }

  await prisma.location.update({
    where: { id: locationId },
    data: {
      name: data.name,
      parentId: data.parentId ?? null,
      description: data.description ?? null,
      ...(data.assignable !== undefined ? { assignable: data.assignable } : {}),
    },
  });
}

export async function deleteLocation(
  ownerId: string,
  locationId: string
): Promise<void> {
  const collectionId = await resolveLocationCollection(locationId);
  await assertCollectionOwner(ownerId, collectionId);

  const counts = await prisma.location.findUniqueOrThrow({
    where: { id: locationId },
    select: { _count: { select: { children: true, items: true } } },
  });

  if (counts._count.children > 0) {
    throw new Error(
      "Cannot delete a location that has child locations. Move or delete them first."
    );
  }
  if (counts._count.items > 0) {
    throw new Error(
      "Cannot delete a location that has stored copies. Move them first."
    );
  }

  await prisma.location.delete({ where: { id: locationId } });
}
