-- #2557: every share link keeps a visit history — time, IP address and browser.
--
--   1. `share_link`, one row per link ever handed out, found by the same token hash as the live row;
--   2. `share_link_visit`, one row per opening of the link's page;
--   3. a `share_link` row for every link that works today, so its next opening is recorded.

-- ── 1. The links ─────────────────────────────────────────────────────────────────────────────────

CREATE TABLE "share_link" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    -- post_preview | offer_specification | proposal | sale | trade
    "kind" TEXT NOT NULL,
    -- The post, offer, proposal, sale or trade the link was to. No foreign key: five tables.
    "subjectId" TEXT NOT NULL,
    -- SHA-256 hex of the raw token, equal to the live row's while the link works.
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    -- replaced | withdrawn; null while the link is its subject's current one.
    "endReason" TEXT,

    CONSTRAINT "share_link_pkey" PRIMARY KEY ("id")
);

-- How a visit finds its link, live or not.
CREATE UNIQUE INDEX "share_link_tokenHash_key" ON "share_link"("tokenHash");
-- How a dialog finds its subject's links.
CREATE INDEX "share_link_collectionId_kind_subjectId_idx" ON "share_link"("collectionId", "kind", "subjectId");

-- CASCADE: the history is the collection's and goes with it.
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. The visits ────────────────────────────────────────────────────────────────────────────────

CREATE TABLE "share_link_visit" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- As it arrived, with no lookup. A buyer's personal data: removed after 90 days.
    "ipAddress" TEXT,
    "userAgent" TEXT,
    -- Opened by the collection's owner, signed in.
    "own" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "share_link_visit_pkey" PRIMARY KEY ("id")
);

-- A link's history, newest first.
CREATE INDEX "share_link_visit_shareLinkId_at_idx" ON "share_link_visit"("shareLinkId", "at");
-- The sweep's own scan: visits past the retention period.
CREATE INDEX "share_link_visit_at_idx" ON "share_link_visit"("at");

ALTER TABLE "share_link_visit" ADD CONSTRAINT "share_link_visit_shareLinkId_fkey"
    FOREIGN KEY ("shareLinkId") REFERENCES "share_link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. The links that work today ─────────────────────────────────────────────────────────────────
--
-- Each gets its history row now, created when the link was, so it collects visits from here on. No
-- visit is invented: `lastUsedAt` says a link was opened, not by whom, and the history starts empty.
-- A post preview or proposal link whose subject is gone has nobody to show its history to, and is
-- left out.

INSERT INTO "share_link" ("id", "collectionId", "kind", "subjectId", "tokenHash", "createdAt")
SELECT gen_random_uuid()::text, t."collectionId", 'post_preview', t."postId", t."tokenHash", t."createdAt"
FROM "facebook_post_preview_token" t
WHERE t."postId" IS NOT NULL;

INSERT INTO "share_link" ("id", "collectionId", "kind", "subjectId", "tokenHash", "createdAt")
SELECT gen_random_uuid()::text, t."collectionId", 'proposal', t."proposalId", t."tokenHash", t."createdAt"
FROM "proposal_share_token" t
WHERE t."proposalId" IS NOT NULL;

INSERT INTO "share_link" ("id", "collectionId", "kind", "subjectId", "tokenHash", "createdAt")
SELECT gen_random_uuid()::text, o."collectionId", 'offer_specification', t."offerId", t."tokenHash", t."createdAt"
FROM "offer_specification_share_token" t
JOIN "offer" o ON o."id" = t."offerId";

INSERT INTO "share_link" ("id", "collectionId", "kind", "subjectId", "tokenHash", "createdAt")
SELECT gen_random_uuid()::text, s."collectionId", 'sale', t."saleId", t."tokenHash", t."createdAt"
FROM "sale_share_token" t
JOIN "sale" s ON s."id" = t."saleId";

INSERT INTO "share_link" ("id", "collectionId", "kind", "subjectId", "tokenHash", "createdAt")
SELECT gen_random_uuid()::text, tr."collectionId", 'trade', t."tradeId", t."tokenHash", t."createdAt"
FROM "trade_share_token" t
JOIN "trade" tr ON tr."id" = t."tradeId";
