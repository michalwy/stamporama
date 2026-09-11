import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db";
import { SESSION_MAX_AGE_SECONDS, SESSION_REFRESH_AGE_SECONDS } from "./session-lifetime";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  // Being signed in lasts until the collector signs out (#1175). Better Auth's defaults are seven
  // days and a daily refresh; both numbers and the reasoning for replacing them are in
  // `session-lifetime.ts`, which `src/middleware.ts` reads too — the server-side span is only half
  // of the fix, and the two halves have to agree.
  session: {
    expiresIn: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_REFRESH_AGE_SECONDS,
  },
});
