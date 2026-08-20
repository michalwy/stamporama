-- The partner's read-only link to one trade (#640; ADR-0039 §8).
--
-- `assistant_token`'s shape with the collection swapped for a single trade, and that swap is the
-- whole security argument. An Assistant token acts as the collection's owner across the collection;
-- this one names **one trade**, and every read it authorises — the page, the figures, the scans — is
-- scoped to that trade's own lines. A leaked link therefore exposes exactly the list the collector
-- chose to hand over and nothing beside it.
--
-- **One row per trade.** A second live link is a second thing to remember to revoke, and the
-- collector has no way to tell which of two is in whose hands. Regenerating replaces the row, which
-- is what revocation means.
--
-- Only the SHA-256 hash is stored, exactly as for an Assistant token: the raw value is shown once on
-- the dialog that minted it and cannot be recovered. A collector who loses it regenerates.
CREATE TABLE "trade_share_token" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    -- Figures, or counts only. Off by default: without an agreed catalog the page falls back to the
    -- collector's **own** valuation, so this is the switch that decides whether that reaches the
    -- partner — and a default that discloses is not a choice.
    "showValues" BOOLEAN NOT NULL DEFAULT false,
    -- Null is a link live until revoked, which is the common case: an exchange runs for weeks and a
    -- link that dies mid-negotiation is a phone call.
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- The one signal the collector has that the list was actually read, which is why every serve
    -- bumps it.
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "trade_share_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trade_share_token_tradeId_key" ON "trade_share_token"("tradeId");
-- The lookup every served request makes, and the reason the raw value never has to be stored.
CREATE UNIQUE INDEX "trade_share_token_tokenHash_key" ON "trade_share_token"("tokenHash");

-- CASCADE: a link is an address for a trade and addresses nothing once the trade is gone.
ALTER TABLE "trade_share_token" ADD CONSTRAINT "trade_share_token_tradeId_fkey"
    FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
