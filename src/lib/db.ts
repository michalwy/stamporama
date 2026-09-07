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
// `pg` defaults `idleTimeoutMillis` to 10 s and keeps the idle socket refed, so a process whose
// last query has returned sits doing nothing for ten seconds and then exits. The integration
// suite is 143 processes, one per file: 135 of them paid that ten seconds. That is a fixed
// ~1,350 seconds of worker time thrown away per run, and removing it took CI's
// `Integration tests` job from **10 min 03 s to 3 min 31 s**. The eight files that were already
// fast were exactly the eight that either never opened the database or happened to call
// `prisma.$disconnect()` in an `after` hook.
const adapter = new PrismaPg({ connectionString, allowExitOnIdle: true });

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
