import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db";
import { SESSION_OPTIONS } from "./session-lifetime";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  // Being signed in lasts until the collector signs out (#1175). Better Auth's default is seven
  // days; the numbers and the reasoning are in `session-lifetime.ts`, which `src/proxy.ts` reads
  // too — the server-side span is only half of the fix, and the two halves have to agree.
  // `expiresIn` is also the `Max-Age` of the cookie written at sign-in, so it can never exceed
  // 400 days: above that the sign-in itself throws (#1468).
  session: SESSION_OPTIONS,
});
