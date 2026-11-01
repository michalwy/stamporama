-- #2287 (ADR-0075): a **proposal** — an offer prepared for one contact, its lots ordinary offers on
-- the collection's **Direct** platform.
--
--   1. the `proposal` table, numbered per collection like a Facebook post;
--   2. `offer.proposalId`, the proposal an offer is a lot of;
--   3. the Direct module platform in every collection.

-- ── 1. The proposal ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE "collection" ADD COLUMN "nextProposalNo" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "proposal" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "proposalNo" INTEGER NOT NULL,
    "contactId" TEXT NOT NULL,
    -- `preparing` | `sent` | `sold` | `declined`.
    "status" TEXT NOT NULL DEFAULT 'preparing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "proposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_collectionId_proposalNo_key" ON "proposal"("collectionId", "proposalNo");
CREATE INDEX "proposal_collectionId_idx" ON "proposal"("collectionId");
CREATE INDEX "proposal_contactId_idx" ON "proposal"("contactId");

ALTER TABLE "proposal" ADD CONSTRAINT "proposal_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE: a proposal is one person's. The offers it held stay, out of it (below).
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. Its lots ──────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "offer" ADD COLUMN "proposalId" TEXT;

CREATE INDEX "offer_proposalId_idx" ON "offer"("proposalId");

-- SET NULL: a proposal deleted leaves its lots as ordinary Direct offers.
ALTER TABLE "offer" ADD CONSTRAINT "offer_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. The Direct platform ───────────────────────────────────────────────────────────────────────
--
-- A collection that already has a generic platform called Direct (in any case) has it become the
-- module platform, as #1955 did with the contacts that stood for a module: its records and settings
-- stay, and the name becomes the module's. Where two such exist, the one spelled `Direct` is taken.

UPDATE "platform" p
SET "platformModule" = 'direct', "name" = 'Direct'
FROM (
    SELECT DISTINCT ON ("collectionId") "id"
    FROM "platform"
    WHERE "platformModule" IS NULL AND lower(btrim("name")) = 'direct'
    ORDER BY "collectionId", ("name" = 'Direct') DESC, "createdAt"
) chosen
WHERE p."id" = chosen."id"
  AND NOT EXISTS (
      SELECT 1 FROM "platform" o
      WHERE o."collectionId" = p."collectionId" AND o."platformModule" = 'direct'
  )
  AND NOT EXISTS (
      SELECT 1 FROM "platform" o
      WHERE o."collectionId" = p."collectionId" AND o."name" = 'Direct' AND o."id" <> p."id"
  );

-- Every other collection gets one: switched on, since a proposal's lots go nowhere else, in the
-- collection's base currency, selling at a fixed price.
INSERT INTO "platform" ("id", "collectionId", "name", "platformModule", "enabled", "platformCurrency", "defaultListingType")
SELECT gen_random_uuid()::text, col."id", 'Direct', 'direct', true, col."baseCurrency", 'fixed'
FROM "collection" col
WHERE NOT EXISTS (
    SELECT 1 FROM "platform" p WHERE p."collectionId" = col."id" AND p."platformModule" = 'direct'
)
  AND NOT EXISTS (
    SELECT 1 FROM "platform" p WHERE p."collectionId" = col."id" AND p."name" = 'Direct'
);
