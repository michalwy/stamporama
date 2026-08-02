-- The collection's authenticated access to the collector's Allegro account (#476; ADR-0023).
--
-- One row per collection — hence the unique on `collectionId` rather than a plain index — matching
-- the Allegro platform contact (#355) it attaches to and every other platform setting here.
--
-- The client secret and both tokens are stored **sealed** (AES-256-GCM under
-- `STAMPORAMA_SECRET_KEY`), which is why they are plain `TEXT` of unbounded length rather than a
-- sized column: the ciphertext is a self-describing `v1.<iv>.<ct>.<tag>` string whose format is
-- allowed to change without a migration. The client *id* is not a secret and stays readable, so the
-- settings screen can still name the connected application when the key is missing.
--
-- Nothing is backfilled: an existing collection simply has no connection until the collector makes
-- one, and no install is made to set the new environment variable before it does.
CREATE TABLE "allegro_connection" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretSealed" TEXT NOT NULL,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "accessTokenSealed" TEXT,
    "refreshTokenSealed" TEXT,
    "expiresAt" TIMESTAMP(3),
    "accountId" TEXT,
    "accountLogin" TEXT,
    "needsReconnect" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "lastRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allegro_connection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "allegro_connection_collectionId_key" ON "allegro_connection"("collectionId");

ALTER TABLE "allegro_connection"
    ADD CONSTRAINT "allegro_connection_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
