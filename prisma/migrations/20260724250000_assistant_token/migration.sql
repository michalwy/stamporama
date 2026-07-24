-- Bearer token for the Stamporama Assistant browser extension (#253, part of #155). Lets the
-- extension call a collection's Colnect matcher endpoints cross-site, where the Better Auth session
-- cookie is not sent. A token authorizes as the collection's owner for that collection; only the
-- SHA-256 hash of the raw token is stored (raw value shown once at creation). Full issuance UX: #252.
CREATE TABLE "assistant_token" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "assistant_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_token_tokenHash_key" ON "assistant_token"("tokenHash");

CREATE INDEX "assistant_token_collectionId_idx" ON "assistant_token"("collectionId");

ALTER TABLE "assistant_token"
    ADD CONSTRAINT "assistant_token_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
