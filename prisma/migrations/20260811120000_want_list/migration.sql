-- Want list (#532; ADR-0032). What the collector is *looking for* — for a stamp not owned yet, and
-- for one owned but wanted in better shape.
--
-- Not a fourth disposition: `inCollection`/`forSale`/`forTrade` live on a copy, and a wanted stamp
-- has no copy (ADR-0007). Each of the three axes is an acceptance *set* in its own table, where
-- **zero rows means "any"** — which is exactly what a nullable column on `want` could not say,
-- because on two of the three axes a null is already a value of its own.

CREATE TABLE "want" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "stampId" TEXT NOT NULL,
    -- Null = open. The `item.disposedAt` idiom: flag and timestamp in one column, so no second
    -- column can disagree with the first. Nothing sets it automatically — a copy arriving surfaces
    -- the wants it could satisfy and the collector closes, narrows or leaves each one.
    "closedAt" TIMESTAMP(3),
    -- Dropped again by `20260811140000_want_drop_max_price` — see that migration for why.
    "maxPrice" DECIMAL(10,2),
    -- high | normal | low.
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "want_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "want_collectionId_idx" ON "want"("collectionId");
-- Every list read narrows to what is still open, so the flag is indexed with the scope.
CREATE INDEX "want_collectionId_closedAt_idx" ON "want"("collectionId", "closedAt");
CREATE INDEX "want_stampId_idx" ON "want"("stampId");

ALTER TABLE "want" ADD CONSTRAINT "want_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "want" ADD CONSTRAINT "want_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Condition acceptance. The one axis with no "none" value to express — `item.conditionId` is
-- required — so a plain composite key is enough and no NULLS NOT DISTINCT index is needed.
CREATE TABLE "want_condition" (
    "wantId" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,

    CONSTRAINT "want_condition_pkey" PRIMARY KEY ("wantId", "conditionId")
);

CREATE INDEX "want_condition_conditionId_idx" ON "want_condition"("conditionId");

ALTER TABLE "want_condition" ADD CONSTRAINT "want_condition_wantId_fkey"
    FOREIGN KEY ("wantId") REFERENCES "want"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "want_condition" ADD CONSTRAINT "want_condition_conditionId_fkey"
    FOREIGN KEY ("conditionId") REFERENCES "stamp_condition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Certificate acceptance. Nullable on purpose: a null `item.certificateStatusId` *is* a value —
-- "no certificate" (ADR-0006 §2) — so "only without a certificate" is a real want, while "don't
-- care" is zero rows. Both meanings have to fit.
CREATE TABLE "want_certificate_status" (
    "id" TEXT NOT NULL,
    "wantId" TEXT NOT NULL,
    "certificateStatusId" TEXT,

    CONSTRAINT "want_certificate_status_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "want_certificate_status_wantId_idx" ON "want_certificate_status"("wantId");
CREATE INDEX "want_certificate_status_certificateStatusId_idx"
    ON "want_certificate_status"("certificateStatusId");

ALTER TABLE "want_certificate_status" ADD CONSTRAINT "want_certificate_status_wantId_fkey"
    FOREIGN KEY ("wantId") REFERENCES "want"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "want_certificate_status" ADD CONSTRAINT "want_certificate_status_certificateStatusId_fkey"
    FOREIGN KEY ("certificateStatusId") REFERENCES "certificate_status"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Without NULLS NOT DISTINCT Postgres treats every null row as distinct from every other, so the
-- "no certificate" member could be added over and over. Same idiom as `stamp_catalog_price_unique`
-- and `stamp_format_factor_unique` (ADR-0006; PostgreSQL 15+).
CREATE UNIQUE INDEX "want_certificate_status_unique"
    ON "want_certificate_status" ("wantId", "certificateStatusId")
    NULLS NOT DISTINCT;

-- Format acceptance, nullable for the same reason: a null `item.formatId` **means single**, so
-- "only singles" is a real want and "any format" is zero rows.
CREATE TABLE "want_format" (
    "id" TEXT NOT NULL,
    "wantId" TEXT NOT NULL,
    "formatId" TEXT,

    CONSTRAINT "want_format_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "want_format_wantId_idx" ON "want_format"("wantId");
CREATE INDEX "want_format_formatId_idx" ON "want_format"("formatId");

ALTER TABLE "want_format" ADD CONSTRAINT "want_format_wantId_fkey"
    FOREIGN KEY ("wantId") REFERENCES "want"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "want_format" ADD CONSTRAINT "want_format_formatId_fkey"
    FOREIGN KEY ("formatId") REFERENCES "stamp_format"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "want_format_unique"
    ON "want_format" ("wantId", "formatId")
    NULLS NOT DISTINCT;
