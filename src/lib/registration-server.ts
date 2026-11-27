import "server-only";
import { prisma } from "./db";
import { registrationAllowedByEnv } from "./registration";

/**
 * Registration is open when the switch says so, or while the instance has no account yet — the
 * first one has to be created somehow (#2713, `registration.ts`).
 */
export async function isRegistrationOpen(): Promise<boolean> {
  if (registrationAllowedByEnv()) return true;
  return (await prisma.user.count()) === 0;
}
