import "server-only";
import { prisma } from "./db";

// Server-side domain logic for the per-collection Contact address book (ADR-0008,
// #107). A Contact is everyone the collector deals with — sellers, buyers, exchange
// partners, auction houses, platforms. Roles are independent, combinable boolean
// flags (a contact can be several at once), mirroring the `Item` disposition flags
// (ADR-0007 §4). `createContact` may be called with no roles set: create-on-type
// from the acquisition-source autocomplete (#103b) produces a role-less contact and
// the roles are filled in separately. `name` is unique per collection.
//
// All access is collection-owner-scoped; checks live here, server-side.

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

/** Raised when a create would collide with an existing contact name in the same
 * collection (the `(collectionId, name)` unique index). Lets callers surface a
 * friendly message and lets create-on-type fall back to the existing row. */
export class ContactNameTakenError extends Error {
  constructor(name: string) {
    super(`A contact named "${name}" already exists in this collection.`);
    this.name = "ContactNameTakenError";
  }
}

/** The combinable role flags. All default to false; any combination is valid,
 * including none at all. */
export interface ContactRoles {
  buyer: boolean;
  seller: boolean;
  exchangePartner: boolean;
  auctionHouse: boolean;
  platform: boolean;
  other: boolean;
}

export interface ContactData extends ContactRoles {
  id: string;
  collectionId: string;
  name: string;
  notes: string | null;
  email: string | null;
  phone: string | null;
  createdAt: Date;
}

const CONTACT_SELECT = {
  id: true,
  collectionId: true,
  name: true,
  notes: true,
  email: true,
  phone: true,
  buyer: true,
  seller: true,
  exchangePartner: true,
  auctionHouse: true,
  platform: true,
  other: true,
  createdAt: true,
} as const;

export interface ContactCreateInput {
  name: string;
  notes?: string | null;
  email?: string | null;
  phone?: string | null;
  buyer?: boolean;
  seller?: boolean;
  exchangePartner?: boolean;
  auctionHouse?: boolean;
  platform?: boolean;
  other?: boolean;
}

/** Full contact list for a collection, name-ordered. */
export async function listContacts(
  ownerId: string,
  collectionId: string
): Promise<ContactData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.contact.findMany({
    where: { collectionId },
    select: CONTACT_SELECT,
    orderBy: { name: "asc" },
  });
}

/** Case-insensitive name search, capped at 20 rows, for the acquisition-source
 * autocomplete (#103b). An empty query returns the first 20 contacts by name. */
export async function searchContacts(
  ownerId: string,
  collectionId: string,
  query: string
): Promise<ContactData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.contact.findMany({
    where: {
      collectionId,
      name: { contains: query, mode: "insensitive" },
    },
    select: CONTACT_SELECT,
    orderBy: { name: "asc" },
    take: 20,
  });
}

/** Create a contact. `name` is required; roles are optional and independent, so a
 * contact may be created with no roles at all (create-on-type, #103b). Throws
 * {@link ContactNameTakenError} when the name already exists in the collection. */
export async function createContact(
  ownerId: string,
  collectionId: string,
  data: ContactCreateInput
): Promise<ContactData> {
  await assertCollectionOwner(ownerId, collectionId);
  const name = data.name.trim();
  if (!name) throw new Error("Contact name is required.");
  try {
    return await prisma.contact.create({
      data: {
        collectionId,
        name,
        notes: data.notes ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        buyer: data.buyer ?? false,
        seller: data.seller ?? false,
        exchangePartner: data.exchangePartner ?? false,
        auctionHouse: data.auctionHouse ?? false,
        platform: data.platform ?? false,
        other: data.other ?? false,
      },
      select: CONTACT_SELECT,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ContactNameTakenError(name);
    throw err;
  }
}

/** Prisma unique-constraint violation (P2002) narrowing without importing the
 * Prisma error class into this server-only module's public surface. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
