import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { buildLocationPath } from "./location-path";
import {
  locationCodeProblem,
  locationPathNames,
  normalizeLocationCode,
  suggestLocationCode,
} from "./location-code";
import {
  foldLocationRefCounts,
  highestLocationRef,
  nextLocationRef,
  type LocationRefUsage,
} from "./location-ref";

// The shape of a location's ref usage is declared beside the ordering and the counter that build
// it (`location-ref.ts`), because the two dialogs that read it are client code and this module is
// `server-only`. Re-exported here so callers keep asking the module that answers the question.
export type { LocationRefInUse, LocationRefUsage } from "./location-ref";

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
  /** The short code standing in for the path (#2191), upper-cased. */
  code: string;
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
      code: true,
      parentId: true,
      description: true,
      assignable: true,
      _count: { select: { items: true, children: true } },
    },
  });
  return locations.map((l) => ({
    id: l.id,
    name: l.name,
    code: l.code,
    parentId: l.parentId,
    description: l.description,
    assignable: l.assignable,
    itemCount: l._count.items,
    childCount: l._count.children,
  }));
}

/**
 * What refs a location already holds, which card its counter is at, and the next free one
 * (#565/#629).
 *
 * Read whole rather than asked one ref at a time: a location has as many refs as it has cards in
 * it, not as many as it has copies, so the whole set is small — and holding it client-side is what
 * lets the file dialog answer *"`A147` already holds 12 copies"* the instant a ref is typed,
 * without a round trip per keystroke. Blank and null refs are folded away here for the same reason
 * {@link listItemLocationGroups} folds them: "nothing is written on these" is one answer, and the
 * database cannot merge the two into it.
 */
export async function getLocationRefUsage(
  ownerId: string,
  collectionId: string,
  locationId: string
): Promise<LocationRefUsage> {
  await assertCollectionOwner(ownerId, collectionId);
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { collectionId: true },
  });
  if (!location || location.collectionId !== collectionId) {
    throw new Error("Location not found or access denied.");
  }

  const grouped = await prisma.item.groupBy({
    by: ["locationRef"],
    where: { collectionId, locationId, NOT: { locationRef: null } },
    _count: { id: true },
  });

  const refs = foldLocationRefCounts(
    grouped.map((g) => ({ ref: g.locationRef, count: g._count.id }))
  );
  const written = refs.map((r) => r.ref);
  return {
    refs,
    highest: highestLocationRef(written),
    suggestion: nextLocationRef(written),
  };
}

/**
 * The code a location is saved with (#2191): the one the collector typed, normalized and checked,
 * or — when none was typed — the first free one its path suggests. A code another location holds
 * is refused by name, so the collector knows which one to change instead.
 */
async function resolveLocationCode(
  collectionId: string,
  locationId: string | null,
  typed: string | undefined,
  parentId: string | null,
  name: string
): Promise<string> {
  const others = (
    await prisma.location.findMany({
      where: { collectionId },
      select: { id: true, name: true, parentId: true, code: true },
    })
  ).filter((l) => l.id !== locationId);

  const code = typed === undefined ? "" : normalizeLocationCode(typed);
  if (code === "") {
    return suggestLocationCode(
      locationPathNames(others, parentId, name),
      new Set(others.map((l) => l.code))
    );
  }
  const problem = locationCodeProblem(code);
  if (problem) throw new Error(problem);
  const holder = others.find((l) => l.code === code);
  if (holder) throw new Error(codeInUseMessage(code, others, holder.id));
  return code;
}

function codeInUseMessage(
  code: string,
  locations: readonly { id: string; name: string; parentId: string | null }[],
  holderId: string
): string {
  return `Code ${code} is already used by ${buildLocationPath(locations, holderId) ?? "another location"}.`;
}

/** A unique-index refusal on the code, lost to a write that landed between the check and the save,
 * told the same way the check would have told it. */
async function rethrowCodeClash(err: unknown, collectionId: string, code: string): Promise<never> {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const locations = await prisma.location.findMany({
      where: { collectionId },
      select: { id: true, name: true, parentId: true, code: true },
    });
    const holder = locations.find((l) => l.code === code);
    if (holder) throw new Error(codeInUseMessage(code, locations, holder.id));
  }
  throw err;
}

export async function createLocation(
  ownerId: string,
  collectionId: string,
  data: {
    name: string;
    /** Blank or absent: generated from the path (#2191). */
    code?: string;
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
  const code = await resolveLocationCode(
    collectionId,
    null,
    data.code,
    data.parentId ?? null,
    data.name
  );
  const created = await prisma.location
    .create({
      data: {
        collectionId,
        name: data.name,
        code,
        parentId: data.parentId ?? null,
        description: data.description ?? null,
        assignable: data.assignable ?? true,
      },
      select: { id: true },
    })
    .catch((err: unknown) => rethrowCodeClash(err, collectionId, code));
  return { id: created.id };
}

export async function updateLocation(
  ownerId: string,
  locationId: string,
  data: {
    name: string;
    /** Absent: the code is left as it is. Never regenerated — a code is stable (#2191). */
    code?: string;
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

  let code: string | undefined;
  if (data.code !== undefined) {
    code = normalizeLocationCode(data.code);
    const problem = locationCodeProblem(code);
    if (problem) throw new Error(problem);
    code = await resolveLocationCode(
      collectionId,
      locationId,
      code,
      data.parentId ?? null,
      data.name
    );
  }

  await prisma.location
    .update({
      where: { id: locationId },
      data: {
        name: data.name,
        ...(code !== undefined ? { code } : {}),
        parentId: data.parentId ?? null,
        description: data.description ?? null,
        ...(data.assignable !== undefined ? { assignable: data.assignable } : {}),
      },
    })
    .catch((err: unknown) =>
      code === undefined ? Promise.reject(err) : rethrowCodeClash(err, collectionId, code)
    );
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
