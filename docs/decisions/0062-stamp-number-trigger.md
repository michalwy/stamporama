# ADR-0062: A Stamp's Short Number Is Allocated by a Database Trigger

## Status

Accepted. Written by #1574 on 2026-10-03, which gave every stamp a short number of its own.

## Context

Every major record carries a short per-collection number — a copy (#268), an offer (#416), an issue,
a purchase, a sale, an auction lot (#432) and a trade (#646). Each is allocated by
`allocateEntityNumber` (`src/lib/items.ts`): an atomic `UPDATE "collection" SET next… = next… + 1
RETURNING`, never `max + 1`, so a deleted row retires its number. The application calls it inside
the transaction that creates the row, and every `create` names the number it was handed.

#1574 extends the pattern to stamps, variants included. A stamp differs from the others in how it is
written. The application creates stamps in seven places — a single stamp, a variant, a catalogue
range, a variant range, the demo seed — some of them in loops inside one transaction. And the
integration suite writes stamps straight through Prisma in **351 places across 182 files**, as
fixtures. A required number allocated by the application would mean touching every one of them, and
a fixture that guessed a number would collide with the unique index the next test file hit.

## Decision

**The number is allocated by a `BEFORE INSERT` trigger on `stamp`, not by application code.** The
trigger runs the same statement `allocateEntityNumber` runs, against `Collection.nextStampNo`:

- **Every insert gets a number, whatever wrote it.** A nested create, a `createMany`, a fixture, raw
  SQL: none of them has to remember to ask, so *every stamp has a number* is a fact about the
  database, not about each caller's discipline.
- **A number a caller supplies is overwritten.** The counter is the only source; a caller cannot hand
  out a number the counter has already given.
- **The rules are the other numbers' rules.** The `UPDATE` takes the collection row's lock, so
  concurrent inserts into one collection serialise exactly as `allocateEntityNumber`'s do, and a
  rolled-back insert rolls its bump back with it — a failed create burns no number.
- **A second trigger refuses an update that changes the number.** A quoted number must never come to
  mean something else, and the database is where that can be enforced for every writer.

In the Prisma schema the column is `stampNo Int @default(dbgenerated())`. `dbgenerated` only tells
Prisma to leave the column out of an insert and treat it as optional in the create input. The column
has **no SQL default**: it is `NOT NULL`, and the trigger fills it before the constraint is checked.

## Consequences

- This is the first trigger in the schema. It lives in its migration
  (`20261003220000_stamp_short_numbers`) and nowhere in TypeScript, so the comment on `Stamp.stampNo`
  in `schema.prisma` points here. Reading `src/` alone will not show where a stamp's number comes from.
- **The other short numbers stay as they are.** Their writers are few and their fixtures already
  supply numbers. Moving them onto triggers would be churn without a defect behind it. Whether a new
  short number follows this ADR or `allocateEntityNumber` is decided by the same question: how many
  paths write the row.
- Existing stamps were numbered once by the same migration, in catalogue order within each area
  (decided on #1574): areas in tree order, then the primary catalogue sort key, then age.
- A test asserting a specific stamp number must read it back rather than state it, since nothing
  passed in a `create` survives.
