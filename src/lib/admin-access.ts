import "server-only";
import { prisma } from "./db";
import { isAdminEmail, parseAdminEmails } from "./admin-rules";

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

/**
 * Whether this account is an administrator: its email is listed in `ADMIN_EMAILS` (#2729, the
 * owner's decision of 2026-11-27 — administrators are named in the instance's configuration, the
 * first account is nobody special). Read on every call, so a changed list takes effect with the
 * container's next start and nothing is cached. An unknown id is not an administrator, and neither
 * is anyone while the variable is unset. `user.isAdmin` (#2719) is no longer read or written.
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const admins = process.env.ADMIN_EMAILS;
  if (parseAdminEmails(admins).size === 0) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return isAdminEmail(user?.email, admins);
}

/** Refuse anyone who is not an administrator. */
export async function assertAdmin(userId: string): Promise<void> {
  if (!(await isAdmin(userId))) {
    throw new AdminError("forbidden", "Only an administrator of this instance can do this.");
  }
}
