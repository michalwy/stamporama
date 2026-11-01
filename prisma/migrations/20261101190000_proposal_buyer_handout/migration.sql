-- #2288: what a proposal's buyer is sent — its lots' photos, a document or live link, and a message.
--
--   1. `offer.proposalLotNo`, each lot's number in its proposal, the same in all three;
--   2. `platform.proposalMessageTemplate`, the Direct platform's message template;
--   3. the `proposal_share_token` table, the buyer's live link to the document.

-- ── 1. Lot numbers ───────────────────────────────────────────────────────────────────────────────

ALTER TABLE "offer" ADD COLUMN "proposalLotNo" INTEGER;

-- The lots a proposal already holds are numbered in the order its screen listed them: by offer number.
UPDATE "offer" o
SET "proposalLotNo" = numbered.n
FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "proposalId" ORDER BY "offerNo") AS n
    FROM "offer"
    WHERE "proposalId" IS NOT NULL
) numbered
WHERE o."id" = numbered."id";

-- One lot number per proposal; offers in no proposal carry nulls, which never collide.
CREATE UNIQUE INDEX "offer_proposalId_proposalLotNo_key" ON "offer"("proposalId", "proposalLotNo");

-- ── 2. The message template ──────────────────────────────────────────────────────────────────────

-- Null everywhere: no message until the collector writes one (#1692).
ALTER TABLE "platform" ADD COLUMN "proposalMessageTemplate" TEXT;

-- ── 3. The buyer's link ──────────────────────────────────────────────────────────────────────────
--
-- `facebook_post_preview_token`'s shape (#2212) with the post swapped for one proposal. No contents
-- hash: the link stays live until the proposal closes.
CREATE TABLE "proposal_share_token" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    -- Null once the proposal is gone; the address then says the offer is closed.
    "proposalId" TEXT,
    -- SHA-256 hex of the raw token (prefix "stmpd_"), the only form a lookup touches.
    "tokenHash" TEXT NOT NULL,
    -- The same token sealed (`secret-box.ts`), so the collector can be shown their own link again
    -- (#681). Null on an install with no key.
    "tokenSealed" TEXT,
    -- The proposal's language as last read, for the notice once the proposal is gone.
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "proposal_share_token_pkey" PRIMARY KEY ("id")
);

-- One row per proposal: a new link replaces the row, which is what revocation means.
CREATE UNIQUE INDEX "proposal_share_token_proposalId_key" ON "proposal_share_token"("proposalId");
-- The lookup every served request makes.
CREATE UNIQUE INDEX "proposal_share_token_tokenHash_key" ON "proposal_share_token"("tokenHash");
CREATE INDEX "proposal_share_token_collectionId_idx" ON "proposal_share_token"("collectionId");

-- CASCADE: the link is the collection's and goes with it.
ALTER TABLE "proposal_share_token" ADD CONSTRAINT "proposal_share_token_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL: a deleted proposal leaves an address that says the offer is closed, rather than one that
-- reads as never having existed.
ALTER TABLE "proposal_share_token" ADD CONSTRAINT "proposal_share_token_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
