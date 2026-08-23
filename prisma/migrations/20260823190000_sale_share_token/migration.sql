-- The buyer chooses their own copy through a link (#699; ADR-0013 §7).
--
-- Two things: the link, and the mark that says the answer on a line came from the buyer.
--
-- `trade_share_token`'s shape (ADR-0039 §9) with the trade swapped for a **single sale**, and that
-- swap is the whole security argument here too. The token names one sale, and every read it
-- authorises is about that sale's own lines — the ones nobody has chosen a set for, and the copies
-- those sets hold. A leaked link exposes exactly the question the seller asked and nothing beside
-- it: not the sale's figures, not the collection, not the collector.
--
-- Why ask at all: an offer listed at quantity 3 has three sets and a buyer who takes one has said
-- *one of these*, not *this one* (#697). They are the same thing only as far as the listing was
-- concerned — the centring, a corner perf, the exact shade differ — and the person who is going to
-- own it has an opinion the seller does not.
CREATE TABLE "sale_share_token" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    -- SHA-256 hex of the raw token (prefix "stmps_"), the only form a lookup touches.
    "tokenHash" TEXT NOT NULL,
    -- The same token sealed (`secret-box.ts`), so the seller can be shown their own link again
    -- (#681). Null on an install with no key: the link is still minted and still works, and the
    -- seller's side says why it cannot be shown a second time.
    "tokenSealed" TEXT,
    -- Null is a link live until it is withdrawn, which is the common case: the question closes when
    -- the parcel is packed anyway, and that is a better fence than a date.
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- The one signal the seller has that the question was actually read, which is why every serve
    -- bumps it.
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "sale_share_token_pkey" PRIMARY KEY ("id")
);

-- One row per sale: a second live link is a second thing to remember to revoke, and regenerating
-- replaces the row, which is what revocation means.
CREATE UNIQUE INDEX "sale_share_token_saleId_key" ON "sale_share_token"("saleId");
-- The lookup every served request makes.
CREATE UNIQUE INDEX "sale_share_token_tokenHash_key" ON "sale_share_token"("tokenHash");

-- CASCADE: a link is an address for a sale and addresses nothing once the sale is gone.
ALTER TABLE "sale_share_token" ADD CONSTRAINT "sale_share_token_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- When the **buyer** said which set they wanted, rather than the seller settling it themselves.
--
-- Null on every line recorded or settled the ordinary way, which is nearly all of them. It does two
-- jobs, and it is one column because they are one fact: the seller reads it to know the pick on this
-- line is not their own, and the buyer's page reads it to know which already-settled lines are still
-- theirs to change — a line they answered stays on that page until the parcel is packed, while a
-- line the seller settled leaves it.
--
-- Cleared by any later swap the seller makes (`swapSaleLineSet`): the parcel is theirs to pack, and
-- once they have overridden the pick the line is no longer the buyer's answer.
ALTER TABLE "sale_line" ADD COLUMN "setChosenByBuyerAt" TIMESTAMP(3);
