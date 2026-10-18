-- A contact holds several Facebook profiles, and a buyer is recognised by any of them (#2042).
--
-- Some buyers bid from two accounts; with one link per contact the second account was a stranger and
-- a sale to it made a second contact for the same person. The links move to a table of their own, one
-- row per profile. A profile belongs to **one** contact: the unique index is what makes a lookup by
-- link answer with a single person, and what refuses the same link typed onto a second contact.
--
-- The old column was indexed but not unique (#1545), so a link may stand on two contacts. The lookup
-- has always answered such a link with the **oldest** of them (`findFirst … orderBy createdAt asc`),
-- so that contact keeps it and the others lose it — they were never found by it anyway.

CREATE TABLE "contact_facebook_profile" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_facebook_profile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contact_facebook_profile_collectionId_url_key" ON "contact_facebook_profile"("collectionId", "url");

CREATE INDEX "contact_facebook_profile_contactId_idx" ON "contact_facebook_profile"("contactId");

ALTER TABLE "contact_facebook_profile" ADD CONSTRAINT "contact_facebook_profile_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_facebook_profile" ADD CONSTRAINT "contact_facebook_profile_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "contact_facebook_profile" ("id", "collectionId", "contactId", "url", "createdAt")
SELECT DISTINCT ON (c."collectionId", c."facebookProfileUrl")
       gen_random_uuid()::text, c."collectionId", c."id", c."facebookProfileUrl", c."createdAt"
  FROM "contact" c
 WHERE NULLIF(btrim(c."facebookProfileUrl"), '') IS NOT NULL
 ORDER BY c."collectionId", c."facebookProfileUrl", c."createdAt" ASC, c."id" ASC;

DROP INDEX "contact_collectionId_facebookProfileUrl_idx";

ALTER TABLE "contact" DROP COLUMN "facebookProfileUrl";
