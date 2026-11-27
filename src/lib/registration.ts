import { APIError, createAuthMiddleware } from "better-auth/api";

/**
 * Whether new accounts may be created on this instance (#2713).
 *
 * The owner closed registration on 2026-11-27. It is an **environment switch, off by default**, so
 * an instance is closed without anyone editing its `.env`, and a self-hoster who wants sign-ups
 * sets `STAMPORAMA_ALLOW_REGISTRATION=true`. **An instance with no account at all is always open**:
 * otherwise a fresh installation could never create its first one. That check needs the database,
 * so it lives in `registration-server.ts`; this module stays pure for the unit suite.
 */
export const REGISTRATION_ENV = "STAMPORAMA_ALLOW_REGISTRATION";

export const REGISTRATION_CLOSED_MESSAGE = "Registration of new accounts is closed on this instance.";

/** True when the switch says `true`, `1`, `yes` or `on` (any case); anything else, unset included, is off. */
export function registrationAllowedByEnv(env: Record<string, string | undefined> = process.env): boolean {
  const value = env[REGISTRATION_ENV]?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

/** Better Auth's path for creating an account with an email and a password. */
export const SIGN_UP_PATH = "/sign-up/email";

/**
 * The server-side half: a Better Auth `before` hook that refuses the sign-up endpoint with 403
 * while registration is closed. Hiding the form is only the courtesy; this is the rule.
 */
export function signUpGuard(isRegistrationOpen: () => Promise<boolean>) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== SIGN_UP_PATH) return;
    if (await isRegistrationOpen()) return;
    throw new APIError("FORBIDDEN", { message: REGISTRATION_CLOSED_MESSAGE });
  });
}
