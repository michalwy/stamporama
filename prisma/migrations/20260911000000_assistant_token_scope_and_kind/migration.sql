-- What an Assistant token may do, and what kind of client it was minted for (#707).
--
-- `assistant_token` (#253) was minted for the browser extension and grants full owner rights on one
-- collection. #706 opened `/api/v1` to an agentic client, which is a much wider surface invoked
-- autonomously, so a token now says which of the two it is and how far it reaches. One token model
-- and one Settings screen: per-area scopes (`offers:write`, …) are deliberately out of scope, and
-- `read` / `read_write` widens into them later without a second table.
--
-- **The backfill is the interesting half and it is done in SQL rather than in application code.**
-- Every row that exists when this runs is an extension token doing extension work, and narrowing it
-- would break a working install — so both columns are added `NOT NULL` with the wide value as their
-- default, which is what PostgreSQL writes into the existing rows.
--
-- **Then the defaults are dropped, and that is the point of the second statement.** Once the
-- backfill has happened, a column default would go on quietly granting `read_write` to every future
-- insert that forgot to say otherwise — the widest scope, arrived at by omission. Without one, the
-- generated Prisma client makes both fields required and every mint has to state them, which is a
-- compile-time check standing where a silent over-grant would otherwise be. The two vocabularies are
-- `read` / `read_write` and `extension` / `agent`, held in `src/lib/assistant-token-scope.ts`; they
-- are TEXT with a documented vocabulary rather than a Postgres enum, which is this schema's spelling
-- for every closed set it has (`collection."duplicateCatalogMode"`, `sale."status"`, and the rest).

ALTER TABLE "assistant_token"
    ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'read_write',
    ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'extension';

ALTER TABLE "assistant_token"
    ALTER COLUMN "scope" DROP DEFAULT,
    ALTER COLUMN "kind" DROP DEFAULT;
