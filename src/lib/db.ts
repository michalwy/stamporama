import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { trimWriteArgs, WRITING_OPERATIONS } from "./prisma-text-trim";

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

/**
 * Every write, with the whitespace around the text it carries removed (#1357).
 *
 * The rule belongs here because here is the one place every write passes. A field applying it on
 * blur (`shared/text-input.tsx`) is what the collector sees, but it cannot answer for a form
 * submitted before the field was blurred, for a CSV catalogue import, for a Colnect list or for the
 * agent API — and "one behaviour for every text field, so no field is left out" is the whole point
 * of the issue. What is walked and what is deliberately not is in `prisma-text-trim.ts`; in short,
 * the write payload only, never `where` or any other read-side argument, and never inside a `Json`
 * column's value.
 */
function withTextTrim(client: PrismaClient) {
  return client.$extends({
    name: "trim-typed-text",
    query: {
      $allModels: {
        $allOperations({ operation, args, query }) {
          if (!WRITING_OPERATIONS.has(operation)) return query(args);
          // `trimWriteArgs` walks a plain value and hands back the same shape with its strings
          // trimmed; the operation's own argument type is what it came in as.
          return query(trimWriteArgs(args) as typeof args);
        },
      },
    },
  });
}

/** The client the app uses: a `PrismaClient` with the trimming extension on it. Prefer this over
 *  `PrismaClient` when a helper needs to name the type of the client it is handed. */
export type Db = ReturnType<typeof withTextTrim>;

const globalForPrisma = globalThis as unknown as {
  prisma?: Db;
};

export const prisma: Db = globalForPrisma.prisma ?? withTextTrim(new PrismaClient({ adapter }));

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * The client inside `prisma.$transaction(…)`: the same surface minus the calls a transaction has no
 * business making. Prisma ships `Prisma.TransactionClient` for this, but that name is the *plain*
 * client's transaction type and an extended client is not assignable to it — so helpers that take a
 * transaction take this instead.
 */
export type DbTransaction = Omit<
  Db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
