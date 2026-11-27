-- #2715: the OAuth 2.1 authorization server in front of `/api/mcp`, so that Stamporama can be added
-- to claude.ai as a connector (ADR-0084). Three new tables and nothing else: no existing table,
-- column or row is touched.
--
-- `oauth_client` is an app that registered itself (RFC 7591); `oauth_authorization_code` the
-- one-time code its consent screen hands back; `oauth_grant` what a collector allowed — one
-- collection, one scope — with the hashes of the tokens currently standing for it.

CREATE TABLE "oauth_client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorizedAt" TIMESTAMP(3),

    CONSTRAINT "oauth_client_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_authorization_code" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "grantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_authorization_code_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_grant" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "previousRefreshTokenHash" TEXT,
    "refreshRotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "oauth_grant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_authorization_code_codeHash_key" ON "oauth_authorization_code"("codeHash");
CREATE INDEX "oauth_authorization_code_expiresAt_idx" ON "oauth_authorization_code"("expiresAt");

CREATE UNIQUE INDEX "oauth_grant_accessTokenHash_key" ON "oauth_grant"("accessTokenHash");
CREATE UNIQUE INDEX "oauth_grant_refreshTokenHash_key" ON "oauth_grant"("refreshTokenHash");
CREATE UNIQUE INDEX "oauth_grant_previousRefreshTokenHash_key" ON "oauth_grant"("previousRefreshTokenHash");
CREATE INDEX "oauth_grant_collectionId_idx" ON "oauth_grant"("collectionId");
CREATE INDEX "oauth_grant_clientId_idx" ON "oauth_grant"("clientId");
CREATE INDEX "oauth_grant_userId_idx" ON "oauth_grant"("userId");

ALTER TABLE "oauth_authorization_code" ADD CONSTRAINT "oauth_authorization_code_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_code" ADD CONSTRAINT "oauth_authorization_code_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_code" ADD CONSTRAINT "oauth_authorization_code_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "oauth_grant" ADD CONSTRAINT "oauth_grant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_grant" ADD CONSTRAINT "oauth_grant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_grant" ADD CONSTRAINT "oauth_grant_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
