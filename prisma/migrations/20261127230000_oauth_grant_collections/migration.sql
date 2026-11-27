-- #2728: a connected app reaches several collections, or all of them including ones made later,
-- instead of exactly one (ADR-0084, as amended).
--
-- **Nothing is dropped and no existing row is deleted or rewritten.** A grant gains a flag and a
-- join table; every grant that exists is given one row in that table for the collection it already
-- names, so it goes on reaching exactly what it reaches today. `oauth_grant."collectionId"` and
-- `oauth_authorization_code."collectionId"` stay where they are, now nullable and no longer written:
-- dropping a column is the owner's decision and #2728 does not record it.

ALTER TABLE "oauth_grant" ADD COLUMN "allCollections" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "oauth_grant" ALTER COLUMN "collectionId" DROP NOT NULL;

-- Deleting a collection used to delete the grant that named it. A grant may now reach others
-- besides, so the old column lets go of the collection instead and the join table below loses its
-- one row.
ALTER TABLE "oauth_grant" DROP CONSTRAINT "oauth_grant_collectionId_fkey";
ALTER TABLE "oauth_grant" ADD CONSTRAINT "oauth_grant_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "oauth_grant_collection" (
    "grantId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,

    CONSTRAINT "oauth_grant_collection_pkey" PRIMARY KEY ("grantId","collectionId")
);

CREATE INDEX "oauth_grant_collection_collectionId_idx" ON "oauth_grant_collection"("collectionId");

ALTER TABLE "oauth_grant_collection" ADD CONSTRAINT "oauth_grant_collection_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "oauth_grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_grant_collection" ADD CONSTRAINT "oauth_grant_collection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The backfill: each existing grant reaches the one collection it was made for.
INSERT INTO "oauth_grant_collection" ("grantId", "collectionId")
SELECT "id", "collectionId" FROM "oauth_grant" WHERE "collectionId" IS NOT NULL;

ALTER TABLE "oauth_authorization_code" ADD COLUMN "allCollections" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "oauth_authorization_code" ADD COLUMN "collectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "oauth_authorization_code" ALTER COLUMN "collectionId" DROP NOT NULL;
