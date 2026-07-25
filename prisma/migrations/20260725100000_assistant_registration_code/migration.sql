-- One-time registration code for the Stamporama Assistant browser extension (#252, part of #155).
-- Settings exposes a short-lived, single-use code on the page; the extension reads it on toolbar-icon
-- click and exchanges it for a scoped AssistantToken, so no URL or token is ever typed in. Only the
-- SHA-256 hash of the raw code is stored; redeemed rows keep `usedAt` so a replay fails as "used".
CREATE TABLE "assistant_registration_code" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_registration_code_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_registration_code_codeHash_key" ON "assistant_registration_code"("codeHash");

CREATE INDEX "assistant_registration_code_collectionId_idx" ON "assistant_registration_code"("collectionId");

ALTER TABLE "assistant_registration_code"
    ADD CONSTRAINT "assistant_registration_code_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
