-- The stamps a copy carries (ADR-0044, #744).
--
-- A **multi-stamp copy** is an indivisible carrier — a cover, a fragment, a card, an FDC — bearing
-- several different catalogue positions that the catalogue never numbered as a whole. The model had
-- no answer for it: a homogeneous multiple is one copy in one format (ADR-0020 §2) and a se-tenant
-- combination the catalogue numbered is its own `stamp` (§4), but a cover franked with three
-- different stamps is neither, and filing it under one of them makes the collection assert something
-- false — that it holds Mi 200, available to sell, when Mi 200 is glued to a cover that will be sold
-- whole.
--
-- The carrier stays **one** `item` row. Nothing is decomposed, exactly as ADR-0020 §2 refuses to
-- decompose a block of four: `itemNo`, location, cost basis, photos, offers, sale lines and trade
-- lines all describe the thing that is sold, and splitting a cover into three copies would force
-- each of them to answer "which of the three?".
--
-- Two columns and a table, and no user-visible behaviour changes here. The rule this makes
-- expressible — a carrier bearing more than one stamp is a copy of *none* of them, the leading one
-- included — lands in #745, which reads `item."stampCount"`.

CREATE TABLE "item_stamp" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    -- How many of this component the carrier bears. It counts **described components, not sheets of
    -- paper** (ADR-0044 §4): a block of four on the cover is one component of quantity 1 whose
    -- "formatId" is the block format, never four, because ADR-0020 §2 states that a format carries
    -- no unit count and nothing anywhere multiplies or divides by one. A cover bearing Mi 200 twice,
    -- loose, is one entry of quantity 2.
    "quantity" INTEGER NOT NULL DEFAULT 1,
    -- The **component's** format — "a block of four, on this cover" — with NULL meaning single, the
    -- ADR-0020 §3 idiom. Distinct from "item"."formatId", which keeps the meaning it has always had,
    -- *what this physical thing is*, and which for a carrier is the carrier type ("Cover", "FDC") —
    -- an ordinary "stamp_format" row, not a second dictionary (ADR-0044 §5).
    "formatId" TEXT,
    -- The collector's order, because the order stamps sit on a piece is a fact about the piece; it
    -- drives what the `{catalog}` token enumerates (ADR-0044 §8). Deliberately **not** unique per
    -- item: a reorder shifting values along a unique index collides transiently and fails on
    -- whichever row Postgres happens to reach first (see `docs/agents/platform.md`), and nothing
    -- needs the database to enforce a permutation.
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "item_stamp_pkey" PRIMARY KEY ("id")
);

-- Cascade from the copy — an entry describes it and has no life without it.
--
-- **Cascade from the stamp too, and that is not the referential action ADR-0044 asked for.** The ADR
-- says RESTRICT, meaning "a stamp a piece still carries must not be deleted out from under it", and
-- that rule is kept — it is simply enforced one layer up, in `deleteStamp` (`src/lib/stamps.ts`),
-- because as a constraint it cannot work. Measured on PostgreSQL 18 against this schema:
--
--     DELETE FROM "stamp" WHERE id = 's-a';
--     ERROR: update or delete on table "stamp" violates RESTRICT setting of foreign key
--            constraint "item_stamp_stampId_fkey" on table "item_stamp"
--
-- …for a stamp with one perfectly ordinary one-entry copy. RESTRICT is checked **immediately**,
-- before the referential actions queued beside it have run, so the "item"."stampId" cascade that
-- would have emptied "item_stamp" has not happened yet when the check fires. ON DELETE NO ACTION
-- does not rescue it either, and was measured too: the queue is FIFO, so the deferred check still
-- runs before the "item_stamp"."itemId" cascade that the "item" cascade only queues once it
-- executes. The same collision sinks **deleting a collection**, where the cascade into "stamp" is
-- reached before the one into "item" — which would leave a collection undeletable for ever.
--
-- So the constraint gets out of the way and the rule is stated where it can also be explained: a
-- stamp still carried by **another** piece — a cover whose leading stamp is a different one — makes
-- `deleteStamp` refuse, naming the copy to edit first. The cascade here is then only ever reached by
-- a deletion that is taking the whole collection anyway.
ALTER TABLE "item_stamp" ADD CONSTRAINT "item_stamp_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_stamp" ADD CONSTRAINT "item_stamp_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- The format keeps RESTRICT, which is exactly what "item"."formatId" already has and works for the
-- same reason: nothing cascades into "stamp_format" before the copies that reference it are gone,
-- and `deleteStampFormat` refuses a format in use before the constraint ever fires.
ALTER TABLE "item_stamp" ADD CONSTRAINT "item_stamp_formatId_fkey"
    FOREIGN KEY ("formatId") REFERENCES "stamp_format"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "item_stamp_itemId_idx" ON "item_stamp"("itemId");
-- *Which pieces carry Mi 200* is one query precisely because this table holds the leading stamp too
-- (ADR-0044 §2), and this is the index it reads.
CREATE INDEX "item_stamp_stampId_idx" ON "item_stamp"("stampId");
CREATE INDEX "item_stamp_formatId_idx" ON "item_stamp"("formatId");

-- One carrier may hold the same stamp as a single *and* as a block of four, and those are two
-- entries — so the format joins the entry's identity. Without NULLS NOT DISTINCT Postgres treats
-- every null-format row as distinct from every other and the same loose stamp could be entered any
-- number of times; the idiom, and the PostgreSQL 15 floor, are `stamp_catalog_price_unique`'s
-- (ADR-0006 §3). Prisma cannot express it, so it lives here only.
CREATE UNIQUE INDEX "item_stamp_unique"
    ON "item_stamp" ("itemId", "stampId", "formatId")
    NULLS NOT DISTINCT;

-- The summed "quantity" of the entries, materialised rather than joined (ADR-0044 §4). #745 has to
-- enforce "a carrier is a copy of none of its stamps" inside `heldCopiesWhere` and half a dozen
-- counterparts, and three queries answering "how much of this do I have" must not be able to
-- disagree — the reason `copy-counts.ts` already routes them through one predicate. A flat column
-- keeps every one of them a plain `where`, beside `disposedAt IS NULL`.
ALTER TABLE "item" ADD COLUMN "stampCount" INTEGER NOT NULL DEFAULT 1;

-- Backfill: one entry per existing copy, which is what every existing copy is — a carrier of one
-- stamp. "stampCount" stays at its default of 1, so **no existing row changes meaning** and nothing
-- needs re-recording. There is no unique-index hazard here: the table is new and empty, and one row
-- per item cannot collide on ("itemId", "stampId", "formatId").
--
-- `gen_random_uuid()::text` rather than a cuid, matching the other data migrations in this
-- directory: nothing reads the shape of an id.
INSERT INTO "item_stamp" ("id", "itemId", "stampId", "quantity", "formatId", "sortOrder")
SELECT gen_random_uuid()::text, i."id", i."stampId", 1, NULL, 0
FROM "item" i;
