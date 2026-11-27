import "server-only";
import { prisma, type Db, type DbTransaction } from "./db";

// Who is an administrator of the instance (#2719). Its own small module so that `auth.ts` and
// `route-auth.ts` can ask without importing the panel and the storage layer behind it (`admin.ts`).

/** Thrown when the acting account is not an administrator, or asks for something the panel refuses. */
export class AdminError extends Error {
  readonly code: "forbidden" | "not_found" | "refused";

  constructor(code: AdminError["code"], message: string) {
    super(message);
    this.name = "AdminError";
    this.code = code;
  }
}

/** Whether this account is an administrator. An unknown id is not. */
export async function isAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  return user?.isAdmin === true;
}

/** Refuse anyone who is not an administrator. */
export async function assertAdmin(userId: string): Promise<void> {
  if (!(await isAdmin(userId))) {
    throw new AdminError("forbidden", "Only an administrator of this instance can do this.");
  }
}

/**
 * Make this account an administrator **if the instance has none** — one statement, so two accounts
 * created at the same moment cannot both win. Called when an account is created (`auth.ts`): the
 * first account of a fresh installation is its administrator, the way the migration made the oldest
 * account the administrator of an existing one. Returns whether it was promoted.
 */
export async function claimFirstAdmin(userId: string, db: Db | DbTransaction = prisma): Promise<boolean> {
  const promoted = await db.$executeRaw`
    UPDATE "user" SET "isAdmin" = true
    WHERE "id" = ${userId} AND NOT EXISTS (SELECT 1 FROM "user" WHERE "isAdmin")`;
  return promoted > 0;
}
