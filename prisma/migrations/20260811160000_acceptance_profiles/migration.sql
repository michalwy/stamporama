-- Named acceptance profiles (#533; ADR-0032 §9). A collector uses the same two or three acceptance
-- sets over and over — "any mint", "anything", "a copy for the collection" — and ticking MNG/MH/MNH
-- on every want is the kind of repetition that stops a want list from being maintained.
--
-- A profile carries exactly the three axes a `want` carries, nullable members included, so nothing
-- expressible on a want is inexpressible on a profile.
--
-- Applying one **seeds**: the sets are copied onto the want and the link ends there. Hence no
-- `profileId` column on `want` — the absence *is* the decision, which is why ADR-0032 §9 states it
-- in words. It is `collage_template`'s shape (#308), and the precedent is the reason.

CREATE TABLE "acceptance_profile" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acceptance_profile_pkey" PRIMARY KEY ("id")
);

-- The picker names them, so two profiles called "Any mint" is a dictionary nobody can read.
CREATE UNIQUE INDEX "acceptance_profile_collectionId_name_key"
    ON "acceptance_profile"("collectionId", "name");
CREATE INDEX "acceptance_profile_collectionId_sortOrder_idx"
    ON "acceptance_profile"("collectionId", "sortOrder");

ALTER TABLE "acceptance_profile" ADD CONSTRAINT "acceptance_profile_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Condition members. The one axis with no "none" value to express — `item.conditionId` is
-- required — so a plain composite key is enough, exactly as on `want_condition`.
CREATE TABLE "acceptance_profile_condition" (
    "profileId" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,

    CONSTRAINT "acceptance_profile_condition_pkey" PRIMARY KEY ("profileId", "conditionId")
);

CREATE INDEX "acceptance_profile_condition_conditionId_idx"
    ON "acceptance_profile_condition"("conditionId");

ALTER TABLE "acceptance_profile_condition" ADD CONSTRAINT "acceptance_profile_condition_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "acceptance_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acceptance_profile_condition" ADD CONSTRAINT "acceptance_profile_condition_conditionId_fkey"
    FOREIGN KEY ("conditionId") REFERENCES "stamp_condition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Certificate members. Nullable on purpose: a null `item.certificateStatusId` *is* a value — "no
-- certificate" (ADR-0006 §2) — while "don't care" is zero rows. Both meanings have to fit.
CREATE TABLE "acceptance_profile_certificate_status" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "certificateStatusId" TEXT,

    CONSTRAINT "acceptance_profile_certificate_status_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "acceptance_profile_certificate_status_profileId_idx"
    ON "acceptance_profile_certificate_status"("profileId");
CREATE INDEX "acceptance_profile_certificate_status_certificateStatusId_idx"
    ON "acceptance_profile_certificate_status"("certificateStatusId");

ALTER TABLE "acceptance_profile_certificate_status" ADD CONSTRAINT "acceptance_profile_certificate_status_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "acceptance_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acceptance_profile_certificate_status" ADD CONSTRAINT "acceptance_profile_certificate_status_certificateStatusId_fkey"
    FOREIGN KEY ("certificateStatusId") REFERENCES "certificate_status"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Without NULLS NOT DISTINCT Postgres treats every null row as distinct from every other, so the
-- "no certificate" member could be added over and over. `want_certificate_status_unique`'s idiom
-- (ADR-0006; PostgreSQL 15+).
CREATE UNIQUE INDEX "acceptance_profile_certificate_status_unique"
    ON "acceptance_profile_certificate_status" ("profileId", "certificateStatusId")
    NULLS NOT DISTINCT;

-- Format members, nullable for the same reason: a null `item.formatId` **means single**, so "only
-- singles" is a real profile and "any format" is zero rows.
CREATE TABLE "acceptance_profile_format" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "formatId" TEXT,

    CONSTRAINT "acceptance_profile_format_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "acceptance_profile_format_profileId_idx"
    ON "acceptance_profile_format"("profileId");
CREATE INDEX "acceptance_profile_format_formatId_idx"
    ON "acceptance_profile_format"("formatId");

ALTER TABLE "acceptance_profile_format" ADD CONSTRAINT "acceptance_profile_format_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "acceptance_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acceptance_profile_format" ADD CONSTRAINT "acceptance_profile_format_formatId_fkey"
    FOREIGN KEY ("formatId") REFERENCES "stamp_format"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "acceptance_profile_format_unique"
    ON "acceptance_profile_format" ("profileId", "formatId")
    NULLS NOT DISTINCT;
