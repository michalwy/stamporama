-- A buyer's read-only link to an offer's specification (#1760): `sale_share_token`'s shape (#699)
-- with the sale swapped for one offer.
CREATE TABLE "offer_specification_share_token" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    -- SHA-256 hex of the raw token (prefix "stmpo_"), the only form a lookup touches.
    "tokenHash" TEXT NOT NULL,
    -- The same token sealed (`secret-box.ts`), so the collector can be shown their own link again
    -- (#681). Null on an install with no key: the link still works, and the offer's side says why it
    -- cannot be shown a second time.
    "tokenSealed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- When a buyer last opened it, bumped on every serve of the page.
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "offer_specification_share_token_pkey" PRIMARY KEY ("id")
);

-- One row per offer: regenerating replaces the row, which is what revocation means.
CREATE UNIQUE INDEX "offer_specification_share_token_offerId_key" ON "offer_specification_share_token"("offerId");
-- The lookup every served request makes.
CREATE UNIQUE INDEX "offer_specification_share_token_tokenHash_key" ON "offer_specification_share_token"("tokenHash");

-- CASCADE: a link is an address for an offer and addresses nothing once the offer is gone.
ALTER TABLE "offer_specification_share_token" ADD CONSTRAINT "offer_specification_share_token_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
