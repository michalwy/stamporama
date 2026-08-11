import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { validateAcceptance, type AcceptanceInput } from "./acceptance";

// Named acceptance profiles (#533; ADR-0032 §9) — the collection's dictionary of reusable
// acceptance sets, "any mint" and "anything" and whatever else this collector keeps re-picking.
//
// Applying one **seeds** a want (`CollageTemplate`'s shape, #308): the sets are copied and the link
// ends there. So there is no reference to follow, no in-use check, and nothing here that a want
// depends on — deleting a profile is an ordinary delete, and editing one changes only what is
// applied *next*.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function resolveProfileCollection(profileId: string): Promise<string> {
  const profile = await prisma.acceptanceProfile.findUnique({
    where: { id: profileId },
    select: { collectionId: true },
  });
  if (!profile) throw new Error("Acceptance profile not found.");
  return profile.collectionId;
}

/** Raised on `@@unique([collectionId, name])`, so the panel can say which half of the save failed
 *  instead of reporting the generic "please try again" a constraint violation otherwise becomes. */
export class AcceptanceProfileNameTakenError extends Error {
  constructor(name: string) {
    super(`A profile called "${name}" already exists.`);
    this.name = "AcceptanceProfileNameTakenError";
  }
}

/** A profile as every screen reads it: a name over the three sets, in the shape the want editor
 *  already speaks (`AcceptanceInput`), so applying one is an assignment rather than a translation. */
export interface AcceptanceProfileData extends AcceptanceInput {
  id: string;
  name: string;
}

export interface AcceptanceProfileInput extends AcceptanceInput {
  name: string;
}

const PROFILE_SELECT = {
  id: true,
  name: true,
  conditions: { select: { conditionId: true } },
  certificateStatuses: { select: { certificateStatusId: true } },
  formats: { select: { formatId: true } },
} satisfies Prisma.AcceptanceProfileSelect;

type ProfileRow = Prisma.AcceptanceProfileGetPayload<{ select: typeof PROFILE_SELECT }>;

function toProfileData(row: ProfileRow): AcceptanceProfileData {
  return {
    id: row.id,
    name: row.name,
    conditionIds: row.conditions.map((c) => c.conditionId),
    certificateStatusIds: row.certificateStatuses.map((c) => c.certificateStatusId),
    formatIds: row.formats.map((f) => f.formatId),
  };
}

/** The collection's profiles in the order they were dragged into, `createdAt` breaking a tie so a
 *  fresh row lands at the end of its `sortOrder` rather than in an order that varies per read. */
export async function listAcceptanceProfiles(
  ownerId: string,
  collectionId: string
): Promise<AcceptanceProfileData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.acceptanceProfile.findMany({
    where: { collectionId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: PROFILE_SELECT,
  });
  return rows.map(toProfileData);
}

/** The three member tables, written as one replacement — the want's own `writeAcceptance` idiom,
 *  and for the same reason: the editor owns all three sets and hands them back whole. */
async function writeProfileAcceptance(
  tx: Prisma.TransactionClient,
  profileId: string,
  acceptance: AcceptanceInput
): Promise<void> {
  await tx.acceptanceProfileCondition.deleteMany({ where: { profileId } });
  await tx.acceptanceProfileCertificateStatus.deleteMany({ where: { profileId } });
  await tx.acceptanceProfileFormat.deleteMany({ where: { profileId } });

  if (acceptance.conditionIds.length) {
    await tx.acceptanceProfileCondition.createMany({
      data: acceptance.conditionIds.map((conditionId) => ({ profileId, conditionId })),
    });
  }
  if (acceptance.certificateStatusIds.length) {
    await tx.acceptanceProfileCertificateStatus.createMany({
      data: acceptance.certificateStatusIds.map((certificateStatusId) => ({
        profileId,
        certificateStatusId,
      })),
    });
  }
  if (acceptance.formatIds.length) {
    await tx.acceptanceProfileFormat.createMany({
      data: acceptance.formatIds.map((formatId) => ({ profileId, formatId })),
    });
  }
}

function rethrowNameClash(err: unknown, name: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new AcceptanceProfileNameTakenError(name);
  }
  throw err;
}

export async function createAcceptanceProfile(
  ownerId: string,
  collectionId: string,
  input: AcceptanceProfileInput
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  const name = input.name.trim();
  if (!name) throw new Error("Name is required.");
  const acceptance = await validateAcceptance(collectionId, input);

  // New rows sort to the end. Read outside the transaction the way the dictionaries' own panels do:
  // this is a single-owner settings screen, and a collision only ever means two profiles sharing a
  // rank, which the `createdAt` tiebreak already orders.
  const count = await prisma.acceptanceProfile.count({ where: { collectionId } });

  try {
    return await prisma.$transaction(async (tx) => {
      const profile = await tx.acceptanceProfile.create({
        data: { collectionId, name, sortOrder: count },
        select: { id: true },
      });
      await writeProfileAcceptance(tx, profile.id, acceptance);
      return profile.id;
    });
  } catch (err) {
    rethrowNameClash(err, name);
  }
}

/**
 * Rename a profile and replace its sets.
 *
 * **Nothing already applied changes** — that is the seed decision (ADR-0032 §9), and it is a
 * property of there being no reference rather than of anything this function is careful about.
 */
export async function updateAcceptanceProfile(
  ownerId: string,
  profileId: string,
  input: AcceptanceProfileInput
): Promise<void> {
  const collectionId = await resolveProfileCollection(profileId);
  await assertCollectionOwner(ownerId, collectionId);
  const name = input.name.trim();
  if (!name) throw new Error("Name is required.");
  const acceptance = await validateAcceptance(collectionId, input);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.acceptanceProfile.update({ where: { id: profileId }, data: { name } });
      await writeProfileAcceptance(tx, profileId, acceptance);
    });
  } catch (err) {
    rethrowNameClash(err, name);
  }
}

/** Deletes a profile. No want references it — a profile seeds rather than being pointed at — so
 *  there is no in-use check to make and nothing prepared already is affected. */
export async function deleteAcceptanceProfile(
  ownerId: string,
  profileId: string
): Promise<void> {
  const collectionId = await resolveProfileCollection(profileId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.acceptanceProfile.delete({ where: { id: profileId } });
}

export async function reorderAcceptanceProfiles(
  ownerId: string,
  collectionId: string,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const existing = await prisma.acceptanceProfile.findMany({
    where: { collectionId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((p) => p.id));
  if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) {
    throw new Error("Reorder list does not match the collection's acceptance profiles.");
  }
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.acceptanceProfile.update({ where: { id }, data: { sortOrder: i } })
    )
  );
}
