import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://stamporama:stamporama@localhost:5432/stamporama";

// `allowExitOnIdle` unrefs a pooled connection once it goes back to the pool, so the pool is
// never the reason a process stays alive (#880). This is the same rule every background timer in
// `instrumentation-node.ts` already follows — "the timer never keeps the process alive on its
// own" — and it holds for the same reason: what keeps the server up is its HTTP listener, and
// nothing else should have a vote. A client that is *checked out* for a query is still refed, so
// no in-flight work can be cut short by it.
//
// The cost of not having it was the whole of CI's ten minutes. `pg` defaults `idleTimeoutMillis`
// to 10 s and keeps the idle socket refed, so a process whose last query has returned sits doing
// nothing for ten seconds and then exits. The integration suite is 142 processes, one per file:
// 134 of them paid that ten seconds — 92% of the suite's wall clock was processes waiting to be
// allowed to die. The seven files that were fast were exactly the seven that happened to call
// `prisma.$disconnect()` in an `after` hook.
const adapter = new PrismaPg({ connectionString, allowExitOnIdle: true });

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
